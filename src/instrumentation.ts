/**
 * Next.js instrumentation hook. Runs once at server boot in BOTH runtimes
 * (Edge + Node), so we gate the heavy code behind a NEXT_RUNTIME check and
 * load it from a separate file. Webpack treats the dynamic import as a
 * runtime-only chunk and skips bundling node:* imports for the Edge target.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-server");
  }
}
