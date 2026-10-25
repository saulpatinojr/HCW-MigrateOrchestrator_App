/**
 * Last-resort guard for the API process (ticket #44 review). An error that nothing caught means the process is in a state
 * nobody checked, so it is not swallowed: it writes one content-free line (the kind of event only, never the message or a
 * stack, which can carry request data) and exits non-zero, and the platform restarts the container. The request handler
 * catches what it can (a malformed request target answers 400); this only covers what was not foreseen.
 */
export interface FatalProcess {
  on(event: "uncaughtException" | "unhandledRejection", listener: () => void): unknown;
  exit(code: number): unknown;
  stderr: { write(text: string): unknown };
}

export function installFatalHandlers(proc: FatalProcess = process as unknown as FatalProcess): void {
  for (const kind of ["uncaughtException", "unhandledRejection"] as const) {
    proc.on(kind, () => {
      proc.stderr.write(`${JSON.stringify({ msg: "fatal: unhandled error, exiting", kind, edition: "enterprise" })}\n`);
      proc.exit(1);
    });
  }
}
