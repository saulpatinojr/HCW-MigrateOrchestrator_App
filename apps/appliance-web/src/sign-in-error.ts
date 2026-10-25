/**
 * Turns an error from the Microsoft Entra sign-in redirect into a sentence for the person looking at the screen
 * (ticket #46, ADR-0031). With "assignment required" switched on, Entra refuses to sign in a user who has no app role and
 * answers with AADSTS50105; before this, the redirect error was swallowed and the page simply showed the sign-in button
 * again. Pure on purpose, so a test can load it without a browser.
 */
export const NO_ROLE_MESSAGE =
  "Your account has not been given a role on this application. Ask an administrator to assign you one of the Migration roles in Microsoft Entra (Enterprise applications, then Users and groups; Migration.Read is the lowest), then sign in again.";

export function describeSignInError(e: unknown): string {
  const parts: string[] = [];
  if (typeof e === "string") parts.push(e);
  else if (e && typeof e === "object") {
    for (const k of ["errorCode", "errorMessage", "message", "subError"] as const) {
      const v = (e as Record<string, unknown>)[k];
      if (typeof v === "string") parts.push(v);
    }
  }
  const text = parts.join(" ");
  if (/AADSTS50105/i.test(text)) return NO_ROLE_MESSAGE;
  // Keep what Entra said, minus the trace and correlation ids, which are not for the reader.
  const short = text.split(/\r?\n/)[0].replace(/\s*(Trace ID|Correlation ID|Timestamp):.*$/i, "").trim();
  return short ? `Sign-in failed: ${short}` : "Sign-in failed. Try again, or ask an administrator.";
}
