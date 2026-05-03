#Requires -Version 5.1
<#
.SYNOPSIS
  qBittorrent "Run external program on torrent finished" hook for substitutarr.
  Hardlinks completed media into the Jellyfin library, then notifies substitutarr.
  NEVER touches the original file. Seeding continues unconditionally.

.NOTES
  Invoke from qBit Settings > Downloads > Run external program on torrent finished:
    powershell.exe -ExecutionPolicy Bypass -File "C:\substitutarr\post-dl.ps1" "%F" "%N" "%I" "%L" "%G" "%R"

  Set the HMAC secret as a machine-level env var:
    [Environment]::SetEnvironmentVariable("SUBSTITUTARR_HMAC_SECRET", "...", "Machine")

  The same secret must be set on the substitutarr server as POSTPROCESS_HMAC_SECRET.

.LIMITATION
  Hardlinks are NTFS-local: src + dst MUST be on the same volume. If qBit downloads
  to C:\ and your library is on D:\, change qBit save_path to D:\Downloads first.
  This script logs ERROR and exits if it detects a cross-volume layout.
#>

[CmdletBinding(DefaultParameterSetName='Run')]
param(
  [Parameter(ParameterSetName='Run',  Mandatory=$true)][string]$ContentPath,
  [Parameter(ParameterSetName='Run',  Mandatory=$true)][string]$TorrentName,
  [Parameter(ParameterSetName='Run',  Mandatory=$true)][string]$InfoHash,
  [Parameter(ParameterSetName='Run',  Mandatory=$true)][string]$Category,
  [Parameter(ParameterSetName='Run',  Mandatory=$false)][string]$Tags = "",
  [Parameter(ParameterSetName='Run',  Mandatory=$false)][string]$RootPath = "",

  # Test mode: pings substitutarr's verify-hook endpoint and exits without
  # touching disk. Used by the setup wizard's "Verify hook" step.
  [Parameter(ParameterSetName='Test', Mandatory=$true)][switch]$TestMode,
  [Parameter(ParameterSetName='Test', Mandatory=$true)][string]$VerifyToken
)

# ============================================================================
# 1. CONFIGURATION  — populated by the setup wizard at download time.
#    Placeholders {{...}} are replaced server-side. If you see them literal in
#    this file, you copied the template instead of the configured download.
# ============================================================================
$Config = @{
  MoviesRoot      = '{{MOVIES_ROOT}}'
  TvRoot          = '{{TV_ROOT}}'
  SubstitutarrUrl = '{{SUBSTITUTARR_URL}}/api/post-process'
  VerifyHookUrl   = '{{SUBSTITUTARR_URL}}/api/setup/verify/callback'
  HmacSecret      = '{{HMAC_SECRET}}'
  LogDir          = 'C:\substitutarr\logs'
  QueueDir        = 'C:\substitutarr\queue'
  LogRetainDays   = 30
  HttpTimeoutSec  = 10
  VideoExt        = @('.mkv','.mp4','.avi','.ts','.mov','.m4v','.wmv')
  SubExt          = @('.srt','.ass','.ssa','.vtt','.sub','.idx')
  SkipPatterns    = @('*sample*','*proof*','*screens*','*RARBG*','*.nfo','*.txt','*.jpg','*.png','*.sfv','*.md5')
}

# Use machine-level env var as fallback if the placeholder wasn't substituted
# (e.g. user copied the raw template by mistake).
if ($Config.HmacSecret -eq '{{HMAC_SECRET}}' -and $env:SUBSTITUTARR_HMAC_SECRET) {
  $Config.HmacSecret = $env:SUBSTITUTARR_HMAC_SECRET
}

# ============================================================================
# 2. LOGGING
# ============================================================================
New-Item -ItemType Directory -Path $Config.LogDir   -Force | Out-Null
New-Item -ItemType Directory -Path $Config.QueueDir -Force | Out-Null

$script:LogFile = Join-Path $Config.LogDir ("post-dl-{0}.log" -f (Get-Date -Format 'yyyy-MM-dd'))

function Write-Log {
  param([string]$Level, [string]$Msg)
  $hashShort = if ($InfoHash -and $InfoHash.Length -ge 8) { $InfoHash.Substring(0, 8) } elseif ($InfoHash) { $InfoHash } else { 'verify' }
  $line = "{0} [{1}] [{2}] {3}" -f (Get-Date -Format 'o'), $Level, $hashShort, $Msg
  Add-Content -Path $script:LogFile -Value $line -Encoding UTF8
  if ($Level -in @('ERROR','WARN')) { Write-Host $line }
}

# Rotate logs older than N days
Get-ChildItem $Config.LogDir -Filter 'post-dl-*.log' -ErrorAction SilentlyContinue |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$Config.LogRetainDays) } |
  Remove-Item -Force -ErrorAction SilentlyContinue

try {

# ============================================================================
# 2.5  TEST MODE — handshake with the setup wizard, no disk action
# ============================================================================
if ($PSCmdlet.ParameterSetName -eq 'Test') {
  Write-Log INFO "==> TEST MODE — verifyToken='$VerifyToken'"
  if (-not $Config.HmacSecret -or $Config.HmacSecret -eq '{{HMAC_SECRET}}') {
    Write-Log ERROR "HMAC secret not configured. Re-download the script from /setup."
    Write-Host "ERROR: HMAC secret not configured. Re-download the script from /setup."
    exit 1
  }
  $body = @{ verifyToken = $VerifyToken; ts = (Get-Date -Format 'o') } | ConvertTo-Json -Compress
  $hmac = New-Object System.Security.Cryptography.HMACSHA256
  $hmac.Key = [Text.Encoding]::UTF8.GetBytes($Config.HmacSecret)
  $sig = -join (($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($body))) | ForEach-Object { $_.ToString('x2') })
  try {
    $resp = Invoke-RestMethod -Uri $Config.VerifyHookUrl -Method POST `
              -Body $body -ContentType 'application/json' `
              -Headers @{ 'X-Substitutarr-Signature' = "sha256=$sig" } `
              -TimeoutSec $Config.HttpTimeoutSec
    Write-Log INFO "verify ack: $($resp | ConvertTo-Json -Compress)"
    Write-Host "OK — substitutarr received the ping. You can close this window."
    exit 0
  } catch {
    Write-Log ERROR "verify POST failed: $($_.Exception.Message)"
    Write-Host "ERROR: $($_.Exception.Message)"
    exit 1
  }
}

Write-Log INFO "==> hook fired: name='$TorrentName' cat='$Category' path='$ContentPath'"

# ============================================================================
# 3. PRE-FLIGHT VALIDATION
# ============================================================================
if (-not $Category.StartsWith('substitutarr-')) {
  Write-Log INFO "category '$Category' not managed by substitutarr; ignoring."
  exit 0
}

if (-not (Test-Path -LiteralPath $ContentPath)) {
  Write-Log ERROR "ContentPath does not exist on disk: $ContentPath"
  exit 1
}

function Get-VolumeRoot([string]$p) {
  return [System.IO.Path]::GetPathRoot([System.IO.Path]::GetFullPath($p)).TrimEnd('\')
}
$dlVol     = Get-VolumeRoot $ContentPath
$moviesVol = Get-VolumeRoot $Config.MoviesRoot
$tvVol     = Get-VolumeRoot $Config.TvRoot

if ($dlVol -ne $moviesVol -or $dlVol -ne $tvVol) {
  Write-Log ERROR "Cross-volume detected: dl=$dlVol movies=$moviesVol tv=$tvVol. Hardlinks require same volume — move qBit save_path to the same drive as your Jellyfin library."
  exit 1
}

# ============================================================================
# 4. IDEMPOTENCE MARKER
# ============================================================================
$markerPath = if ((Get-Item -LiteralPath $ContentPath).PSIsContainer) {
  Join-Path $ContentPath ".substitutarr.processed"
} else {
  "$ContentPath.substitutarr.processed"
}
if (Test-Path -LiteralPath $markerPath) {
  Write-Log INFO "marker present, already processed; exit 0"
  exit 0
}

# ============================================================================
# 5. FILE DISCOVERY + FILTER
# ============================================================================
function Test-Skip([string]$name) {
  foreach ($pat in $Config.SkipPatterns) { if ($name -like $pat) { return $true } }
  return $false
}

$item = Get-Item -LiteralPath $ContentPath
$allFiles = if ($item.PSIsContainer) {
  Get-ChildItem -LiteralPath $ContentPath -Recurse -File -ErrorAction SilentlyContinue
} else {
  @($item)
}

$videos = $allFiles | Where-Object {
  ($Config.VideoExt -contains $_.Extension.ToLower()) -and (-not (Test-Skip $_.Name))
}

if (-not $videos -or $videos.Count -eq 0) {
  Write-Log WARN "no video files after filtering; nothing to hardlink. exit 0"
  exit 0
}

$mainFile = $videos | Sort-Object Length -Descending | Select-Object -First 1
Write-Log INFO ("found {0} video(s); main='{1}' ({2:N1} MB)" -f $videos.Count, $mainFile.Name, ($mainFile.Length/1MB))

$videoBaseNames = $videos | ForEach-Object { [IO.Path]::GetFileNameWithoutExtension($_.Name) }
$subs = $allFiles | Where-Object {
  $ext = $_.Extension.ToLower()
  if ($Config.SubExt -notcontains $ext) { return $false }
  $bn  = [IO.Path]::GetFileNameWithoutExtension($_.Name)
  $bnNoLang = $bn -replace '\.(fr|en|eng|fre|fra|spa|es|de|ger|ita|it|jp|ja|jpn)$',''
  return ($videoBaseNames -contains $bn) -or ($videoBaseNames -contains $bnNoLang)
}

# ============================================================================
# 6. ROUTING
# ============================================================================
function Sanitize-Path([string]$s) {
  $invalid = [IO.Path]::GetInvalidFileNameChars() -join ''
  $rx = "[{0}]" -f [Regex]::Escape($invalid)
  return ($s -replace $rx,'').Trim().TrimEnd('.')
}

function Resolve-MovieDest($file, $torrentName) {
  $folder = Sanitize-Path $torrentName
  $dir    = Join-Path $Config.MoviesRoot $folder
  return @{ Dir = $dir; FileName = $file.Name }
}

function Resolve-TvDest($file, $torrentName) {
  $name = $file.BaseName
  $patterns = @(
    @{ Rx = '^(?<show>.+?)[\.\s_-]+S(?<s>\d{2})E(?<e>\d{2})(-E\d{2})?'; Kind = 'std' },
    @{ Rx = '^(?<show>.+?)[\.\s_-]+(?<y>\d{4})\.(?<m>\d{2})\.(?<d>\d{2})';  Kind = 'daily' },
    @{ Rx = '^(?<show>.+?)\s-\s(?<n>\d{2,4})(\s|\.|v\d|\[)';                Kind = 'anime' }
  )

  $show = $null; $season = $null
  foreach ($p in $patterns) {
    $m = [regex]::Match($name, $p.Rx, 'IgnoreCase')
    if ($m.Success) {
      $show = $m.Groups['show'].Value -replace '[\._]+',' '
      $show = $show.Trim()
      switch ($p.Kind) {
        'std'   { $season = [int]$m.Groups['s'].Value }
        'daily' { $season = [int]$m.Groups['y'].Value }
        'anime' { $season = 1 }
      }
      break
    }
  }

  if (-not $show) {
    $show = ($torrentName -split '[Ss]\d{2}[Ee]\d{2}')[0] -replace '[\._]+',' '
    $show = $show.Trim()
    if (-not $show) { $show = $torrentName }
    $season = 1
    Write-Log WARN "no SxxExx pattern in '$($file.Name)'; falling back to '$show' Season 01"
  }

  $showSafe = Sanitize-Path $show
  $seasonDir = "Season {0:D2}" -f $season
  $dir = Join-Path (Join-Path $Config.TvRoot $showSafe) $seasonDir
  return @{ Dir = $dir; FileName = $file.Name }
}

# ============================================================================
# 7. HARDLINK
# ============================================================================
function Invoke-Hardlink {
  param([string]$Src, [string]$Dst)

  if ($Dst.Length -ge 250 -and -not $Dst.StartsWith('\\?\')) {
    $Dst = '\\?\' + $Dst
  }

  $dstDir = Split-Path $Dst -Parent
  if (-not (Test-Path -LiteralPath $dstDir)) {
    New-Item -ItemType Directory -Path $dstDir -Force | Out-Null
  }

  if (Test-Path -LiteralPath $Dst) {
    $srcInfo = Get-Item -LiteralPath $Src
    $dstInfo = Get-Item -LiteralPath $Dst
    if ($srcInfo.Length -eq $dstInfo.Length -and $srcInfo.LastWriteTimeUtc -eq $dstInfo.LastWriteTimeUtc) {
      Write-Log INFO "skip (already linked): $Dst"
      return $true
    }
    Write-Log WARN "dst exists with different content; replacing: $Dst"
    Remove-Item -LiteralPath $Dst -Force -ErrorAction Stop
  }

  try {
    New-Item -ItemType HardLink -Path $Dst -Target $Src -ErrorAction Stop | Out-Null
    Write-Log INFO "linked: $Src -> $Dst"
    return $true
  } catch [System.NotSupportedException] {
    Write-Log ERROR "hardlink not supported (cross-volume?): $Src -> $Dst :: $($_.Exception.Message)"
    return $false
  } catch {
    Write-Log ERROR "hardlink failed: $Src -> $Dst :: $($_.Exception.Message)"
    return $false
  }
}

# ============================================================================
# 8. EXECUTE PER FILE
# ============================================================================
$linked = New-Object System.Collections.Generic.List[hashtable]

foreach ($v in $videos) {
  $dest = if ($Category -eq 'substitutarr-movies') {
    Resolve-MovieDest -file $v -torrentName $TorrentName
  } elseif ($Category -eq 'substitutarr-tv') {
    Resolve-TvDest    -file $v -torrentName $TorrentName
  } else {
    Write-Log WARN "unknown substitutarr-* category '$Category'; skipping $($v.Name)"
    continue
  }

  $dst = Join-Path $dest.Dir $dest.FileName
  if (Invoke-Hardlink -Src $v.FullName -Dst $dst) {
    $linked.Add(@{
      src       = $v.FullName
      dst       = $dst
      sizeBytes = $v.Length
      isMain    = ($v.FullName -eq $mainFile.FullName)
    })
  }
}

foreach ($s in $subs) {
  $bn = [IO.Path]::GetFileNameWithoutExtension($s.Name)
  $bnNoLang = $bn -replace '\.(fr|en|eng|fre|fra|spa|es|de|ger|ita|it|jp|ja|jpn)$',''
  $matchVideo = $videos | Where-Object {
    [IO.Path]::GetFileNameWithoutExtension($_.Name) -in @($bn,$bnNoLang)
  } | Select-Object -First 1
  if (-not $matchVideo) { continue }

  $dest = if ($Category -eq 'substitutarr-movies') {
    Resolve-MovieDest -file $matchVideo -torrentName $TorrentName
  } else {
    Resolve-TvDest    -file $matchVideo -torrentName $TorrentName
  }
  $dst = Join-Path $dest.Dir $s.Name
  if (Invoke-Hardlink -Src $s.FullName -Dst $dst) {
    $linked.Add(@{ src=$s.FullName; dst=$dst; sizeBytes=$s.Length; isMain=$false })
  }
}

if ($linked.Count -eq 0) {
  Write-Log ERROR "no files linked; not posting to substitutarr"
  exit 1
}

# ============================================================================
# 9. NOTIFY SUBSTITUTARR
# ============================================================================
function Send-Substitutarr([hashtable]$payload) {
  $json = $payload | ConvertTo-Json -Depth 6 -Compress
  if (-not $Config.HmacSecret) {
    Write-Log ERROR "SUBSTITUTARR_HMAC_SECRET not set; cannot sign."
    return $false
  }
  $hmac = New-Object System.Security.Cryptography.HMACSHA256
  $hmac.Key = [Text.Encoding]::UTF8.GetBytes($Config.HmacSecret)
  $sigBytes = $hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($json))
  $sigHex   = -join ($sigBytes | ForEach-Object { $_.ToString('x2') })

  try {
    $resp = Invoke-RestMethod -Uri $Config.SubstitutarrUrl -Method POST `
              -Body $json -ContentType 'application/json' `
              -Headers @{ 'X-Substitutarr-Signature' = "sha256=$sigHex" } `
              -TimeoutSec $Config.HttpTimeoutSec
    Write-Log INFO "substitutarr ack: $($resp | ConvertTo-Json -Compress)"
    return $true
  } catch {
    Write-Log WARN "substitutarr POST failed: $($_.Exception.Message); spooling for retry"
    return $false
  }
}

$payload = @{
  qbHash      = $InfoHash
  contentPath = $ContentPath
  category    = $Category
  torrentName = $TorrentName
  files       = $linked.ToArray()
}

$ok = Send-Substitutarr $payload
if (-not $ok) {
  $spool = Join-Path $Config.QueueDir ("$InfoHash.json")
  $payload | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $spool -Encoding UTF8
  Write-Log INFO "queued for retry: $spool  (run drain-queue.ps1 via Task Scheduler)"
}

Set-Content -LiteralPath $markerPath -Value (Get-Date -Format 'o') -Encoding UTF8 -ErrorAction SilentlyContinue
Write-Log INFO "<== done; linked $($linked.Count) file(s); ack=$ok"
exit 0

} catch {
  Write-Log ERROR "FATAL unhandled: $($_.Exception.Message)`n$($_.ScriptStackTrace)"
  exit 1
}
