#Requires -Version 5.1
<#
.SYNOPSIS
  One-liner installer for substitutarr on Windows.

.DESCRIPTION
  Bootstraps everything a fresh Windows PC needs to run substitutarr:
    - Installs Node.js LTS via winget if missing
    - Installs Git via winget if missing
    - Clones the repo
    - Prompts for the 2 secrets you have to bring yourself (MongoDB + TMDB)
    - Generates the 3 secrets (HMAC etc) automatically
    - Writes .env.local
    - npm install + npm run build
    - Installs PM2 + sets up a Windows service that survives reboots
    - Schedules the 3 cron tasks in Windows Task Scheduler
    - Opens the browser on the setup wizard

  Idempotent: re-runs upgrade an existing install in place.

.USAGE
  From any PowerShell window:
    irm https://raw.githubusercontent.com/PhytoPlancton/substitutarr/main/scripts/install.ps1 | iex

  Or if you've downloaded it locally:
    powershell.exe -ExecutionPolicy Bypass -File install.ps1
#>

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'  # silences winget/Invoke-WebRequest progress bars in iex piping

function Write-Banner($Text) {
  Write-Host ""
  Write-Host "==> $Text" -ForegroundColor Cyan
}
function Write-Ok($Text) { Write-Host "    OK  $Text" -ForegroundColor Green }
function Write-Warn($Text) { Write-Host "    !!  $Text" -ForegroundColor Yellow }
function Write-Err($Text)  { Write-Host "    XX  $Text" -ForegroundColor Red }

function Test-Command($Name) {
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Refresh-Path {
  # winget installs don't update the current session PATH - read both registries
  $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user    = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = ($machine, $user) -join ';'
}

function Read-Prompt($Label, $Default = $null, [switch]$Mandatory) {
  while ($true) {
    $hint = if ($Default) { " [$Default]" } else { "" }
    $value = Read-Host "$Label$hint"
    if ([string]::IsNullOrWhiteSpace($value)) { $value = $Default }
    if ([string]::IsNullOrWhiteSpace($value) -and $Mandatory) {
      Write-Warn "Required."
      continue
    }
    return $value
  }
}

function New-Secret {
  $b = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  return ([BitConverter]::ToString($b)).Replace('-','').ToLower()
}

# ============================================================================
# 0. WELCOME
# ============================================================================
Clear-Host
Write-Host @"

   ____        __        __  _ __        __
  / __/_ _____/ /__ ___ / /_(_) /___ _____/ /__
 _\ \/ // / -_)__/ -_) __/ / __/ // / __/ '_/
/___/\_,_/\__/  \__/\__/_/\__/\_,_/_/ /_/\_\

  substitutarr installer
"@ -ForegroundColor Magenta

Write-Host ""
Write-Host "  This will install substitutarr on your machine in ~3 minutes." -ForegroundColor Gray
Write-Host "  You'll need:" -ForegroundColor Gray
Write-Host "    - MongoDB connection string (free at cloud.mongodb.com)" -ForegroundColor Gray
Write-Host "    - TMDB API Read Access Token (themoviedb.org/settings/api)" -ForegroundColor Gray
Write-Host ""

if ($PSVersionTable.PSVersion.Major -lt 5) {
  Write-Err "Requires PowerShell 5.1 or higher."
  exit 1
}

# ============================================================================
# 1. PREREQUISITES
# ============================================================================
Write-Banner "Checking prerequisites"

if (-not (Test-Command winget)) {
  Write-Err "winget not available. Install from https://aka.ms/getwinget then re-run."
  exit 1
}
Write-Ok "winget"

if (-not (Test-Command git)) {
  Write-Warn "git missing - installing via winget..."
  winget install --id Git.Git -e --silent --accept-package-agreements --accept-source-agreements | Out-Null
  Refresh-Path
  if (-not (Test-Command git)) {
    Write-Err "git install failed. Close this window, reopen, re-run the installer."
    exit 1
  }
}
Write-Ok "git $(git --version)"

if (-not (Test-Command node)) {
  Write-Warn "Node.js missing - installing LTS via winget..."
  winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements | Out-Null
  Refresh-Path
  if (-not (Test-Command node)) {
    Write-Err "Node.js install failed. Close this window, reopen, re-run the installer."
    exit 1
  }
}
$nodeVer = (node --version)
Write-Ok "Node.js $nodeVer"

# Allow signed local scripts so npm.ps1 works
$currentPolicy = Get-ExecutionPolicy -Scope CurrentUser
if ($currentPolicy -notin @('Bypass','RemoteSigned','Unrestricted')) {
  Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force
  Write-Ok "ExecutionPolicy = RemoteSigned (CurrentUser)"
}

if (-not (Test-Command npm)) {
  Write-Err "npm not found in PATH even after Node install. Reboot and re-run."
  exit 1
}
Write-Ok "npm $(npm --version)"

# ============================================================================
# 2. INSTALL LOCATION
# ============================================================================
Write-Banner "Install location"

# Pick the drive with the most free space among C/D/E/F as the default suggestion
$bestDrive = (Get-PSDrive -PSProvider FileSystem |
              Where-Object { $_.Name -match '^[CDEF]$' -and $_.Free -gt 5GB } |
              Sort-Object Free -Descending | Select-Object -First 1)
$defaultRoot = if ($bestDrive) { "$($bestDrive.Name):\substitutarr" } else { "C:\substitutarr" }

$installRoot = Read-Prompt "Install directory" $defaultRoot -Mandatory
$installRoot = $installRoot.TrimEnd('\')
$appDir = Join-Path $installRoot 'app'
New-Item -ItemType Directory -Path $installRoot -Force | Out-Null

# Detect re-install vs fresh
$isUpdate = Test-Path (Join-Path $appDir '.git')
if ($isUpdate) {
  Write-Ok "Existing install detected at $appDir - will update in place"
} else {
  Write-Ok "Fresh install at $appDir"
}

# ============================================================================
# 3. CLONE OR PULL
# ============================================================================
Write-Banner "Fetching substitutarr"
if ($isUpdate) {
  Push-Location $appDir
  git fetch origin --quiet
  git reset --hard origin/main --quiet
  Pop-Location
} else {
  git clone --depth 1 https://github.com/PhytoPlancton/substitutarr.git $appDir 2>&1 | Out-Null
}
Write-Ok "code at $appDir"

# ============================================================================
# 4. ENV
# ============================================================================
Write-Banner "Configuration"

$envFile = Join-Path $appDir '.env.local'
$existing = @{}
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^([A-Z_][A-Z0-9_]*)=(.*)$') { $existing[$Matches[1]] = $Matches[2] }
  }
  Write-Ok "Existing .env.local found - will keep secrets, re-ask only missing fields"
}

function Get-OrAsk($Key, $Label, $Default = $null, [switch]$Mandatory) {
  if ($existing.ContainsKey($Key) -and $existing[$Key]) {
    return $existing[$Key]
  }
  return (Read-Prompt $Label $Default -Mandatory:$Mandatory)
}

Write-Host ""
Write-Host "  --- MongoDB ---" -ForegroundColor Gray
Write-Host "  Paste your connection string. SRV form (mongodb+srv://...) is fine on" -ForegroundColor DarkGray
Write-Host "  most setups; if it fails later we'll convert to the legacy form automatically." -ForegroundColor DarkGray
$mongoUri = Get-OrAsk 'MONGODB_URI' '  MongoDB URI' -Mandatory

Write-Host ""
Write-Host "  --- TMDB ---" -ForegroundColor Gray
Write-Host "  Visit https://www.themoviedb.org/settings/api and copy the long JWT" -ForegroundColor DarkGray
Write-Host "  labeled 'API Read Access Token (v4 auth)'. Starts with eyJ..." -ForegroundColor DarkGray
$tmdbKey = Get-OrAsk 'TMDB_API_KEY' '  TMDB v4 Read Access Token' -Mandatory

Write-Host ""
Write-Host "  --- Port ---" -ForegroundColor Gray
$port = Read-Prompt "  Local port for substitutarr" "9002"

# Generate / reuse secrets
$cronSecret    = if ($existing['CRON_SECRET'])              { $existing['CRON_SECRET'] }              else { New-Secret }
$hmacSecret    = if ($existing['POSTPROCESS_HMAC_SECRET'])  { $existing['POSTPROCESS_HMAC_SECRET'] }  else { New-Secret }
$pepper        = if ($existing['API_KEY_PEPPER'])           { $existing['API_KEY_PEPPER'] }           else { New-Secret }
$qbitUrl       = Get-OrAsk 'QBIT_URL'      '  qBittorrent URL'  'http://127.0.0.1:8080'
$qbitUser      = Get-OrAsk 'QBIT_USER'     '  qBittorrent user' -Mandatory
$qbitPassword  = Get-OrAsk 'QBIT_PASSWORD' '  qBittorrent password' -Mandatory
$jellyfinUrl   = Get-OrAsk 'JELLYFIN_URL'  '  Jellyfin URL' 'http://127.0.0.1:8096'
$jellyfinKey   = Get-OrAsk 'JELLYFIN_API_KEY' '  Jellyfin API key' -Mandatory

@"
# substitutarr config - generated by install.ps1 on $(Get-Date -Format 'o')
# Don't share this file - it contains your secrets.

MONGODB_URI=$mongoUri

# Clerk : leave empty for dev mode (single-user, no auth)
CLERK_SECRET_KEY=
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=

TMDB_API_KEY=$tmdbKey

CRON_SECRET=$cronSecret
POSTPROCESS_HMAC_SECRET=$hmacSecret
API_KEY_PEPPER=$pepper

QBIT_URL=$qbitUrl
QBIT_USER=$qbitUser
QBIT_PASSWORD=$qbitPassword

JELLYFIN_URL=$jellyfinUrl
JELLYFIN_API_KEY=$jellyfinKey
"@ | Set-Content -LiteralPath $envFile -Encoding UTF8

Write-Ok ".env.local written"

# ============================================================================
# 5. INSTALL + BUILD
# ============================================================================
Write-Banner "Installing dependencies (this is the slow part - ~1-3 min)"
Push-Location $appDir
& npm install --no-audit --no-fund --silent 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Err "npm install failed"; exit 1 }
Write-Ok "$(((Get-ChildItem 'node_modules' -ErrorAction SilentlyContinue) | Measure-Object).Count) packages installed"

Write-Banner "Building production bundle"
& npm run build 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Err "npm run build failed - run 'npm run build' manually to see the error"; exit 1 }
Write-Ok "build complete"
Pop-Location

# ============================================================================
# 6. PM2 + WINDOWS SERVICE
# ============================================================================
Write-Banner "Installing service manager (PM2)"
if (-not (Test-Command pm2)) {
  & npm install -g pm2 pm2-windows-startup --silent 2>&1 | Out-Null
}
Write-Ok "pm2"

$ecoFile = Join-Path $appDir 'ecosystem.config.cjs'
@"
module.exports = {
  apps: [{
    name: "substitutarr",
    cwd: "$($appDir -replace '\\','/')",
    script: "node_modules/next/dist/bin/next",
    args: "start -p $port",
    env: { NODE_ENV: "production" },
    autorestart: true,
    max_memory_restart: "1G",
  }],
};
"@ | Set-Content -LiteralPath $ecoFile -Encoding UTF8

# Restart cleanly if already running, else fresh start
& pm2 delete substitutarr 2>&1 | Out-Null
Push-Location $appDir
& pm2 start ecosystem.config.cjs 2>&1 | Out-Null
& pm2 save 2>&1 | Out-Null
Pop-Location
Write-Ok "substitutarr running on http://127.0.0.1:$port"

# pm2-startup is interactive on Windows; only run once on fresh installs
if (-not $isUpdate -and (Test-Command pm2-startup)) {
  & pm2-startup install 2>&1 | Out-Null
  Write-Ok "PM2 auto-starts at boot"
}

# ============================================================================
# 7. SCHEDULED TASKS (CRONS)
# ============================================================================
Write-Banner "Scheduling background jobs"

function New-CronTask {
  param([string]$Name, [string]$Url, [string]$Schedule)
  $taskName = "substitutarr-$Name"
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  $action = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument "-NoProfile -WindowStyle Hidden -Command `"& { try { Invoke-WebRequest -Uri '$Url' -UseBasicParsing -TimeoutSec 300 | Out-Null } catch {} }`""
  $trigger = $Schedule
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd -RestartInterval (New-TimeSpan -Minutes 5) -RestartCount 2
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -User $env:USERNAME -RunLevel Limited | Out-Null
}

$base = "http://127.0.0.1:$port"
$key = $cronSecret
# Sweep every 15 min
New-CronTask -Name 'sweep'     -Url "$base/api/cron?key=$key"                  -Schedule (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Minutes 15))
# Disk reconcile + retention nightly at 3am
New-CronTask -Name 'reconcile' -Url "$base/api/cron/reconcile-disk?key=$key"   -Schedule (New-ScheduledTaskTrigger -Daily -At 3am)
New-CronTask -Name 'retention' -Url "$base/api/cron/retention?key=$key"        -Schedule (New-ScheduledTaskTrigger -Daily -At 3:30am)
# Webhook queue drain every 5 min
New-CronTask -Name 'webhooks'  -Url "$base/api/webhooks/process?key=$key"      -Schedule (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(3) -RepetitionInterval (New-TimeSpan -Minutes 5))
Write-Ok "4 scheduled tasks registered (sweep, reconcile, retention, webhooks)"

# ============================================================================
# 8. HEALTH CHECK + OPEN BROWSER
# ============================================================================
Write-Banner "Health check"
Start-Sleep -Seconds 4

$healthy = $false
for ($i = 0; $i -lt 8; $i++) {
  try {
    $res = Invoke-WebRequest -Uri "http://127.0.0.1:$port/api/health" -UseBasicParsing -TimeoutSec 5
    if ($res.StatusCode -eq 200) { $healthy = $true; break }
  } catch { Start-Sleep -Seconds 2 }
}

if ($healthy) { Write-Ok "substitutarr is responding" }
else          { Write-Warn "substitutarr may still be starting - run 'pm2 logs substitutarr' to check" }

Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
Write-Host "  Installed at      : $appDir" -ForegroundColor Gray
Write-Host "  Web UI            : http://127.0.0.1:$port" -ForegroundColor Gray
Write-Host "  Service           : pm2 (auto-starts at boot)" -ForegroundColor Gray
Write-Host "  Logs              : pm2 logs substitutarr" -ForegroundColor Gray
Write-Host "  Update later      : run this same script again" -ForegroundColor Gray
Write-Host "================================================================" -ForegroundColor Green
Write-Host ""

# Open the setup wizard
try {
  Start-Process "http://127.0.0.1:$port/setup"
  Write-Ok "Setup wizard opened in your browser"
} catch {
  Write-Warn "Could not auto-open browser. Visit http://127.0.0.1:$port/setup manually."
}
