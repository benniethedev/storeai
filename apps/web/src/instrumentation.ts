/**
 * Next.js runs this once per Node process on boot (both `dev` and `start`).
 * We install global handlers so that an error anywhere — a stray
 * unhandledRejection, a socket hang-up mid-stream, a bad request that
 * throws in middleware — logs instead of killing the process.
 *
 * This does NOT hide real bugs: errors are still logged with full stack.
 * It just stops a single bad actor (a port scanner, a malformed header,
 * a transient Redis blip) from taking the entire server down.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  if (!(process as unknown as { __storeai_handlers?: true }).__storeai_handlers) {
    (process as unknown as { __storeai_handlers?: true }).__storeai_handlers = true;

    process.on("uncaughtException", (err) => {
      console.error("[uncaughtException]", err);
    });

    process.on("unhandledRejection", (reason) => {
      if (reason instanceof Error) {
        console.error("[unhandledRejection]", reason.message, reason.stack);
      } else {
        console.error("[unhandledRejection]", reason);
      }
    });

    // Node emits `warning` for things like MaxListenersExceededWarning — log them
    // but never let them crash the process.
    process.on("warning", (warning) => {
      console.warn("[node-warning]", warning.name, warning.message);
    });
  }
}
