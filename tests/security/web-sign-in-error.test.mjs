import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";

/**
 * Ticket #46 (ADR-0031): the appliance web has no test harness of its own, so the message mapping lives in a pure module
 * (apps/appliance-web/src/sign-in-error.ts) that is compiled here with esbuild and exercised directly, and the wiring in
 * auth.ts and App.tsx is checked on the source. This does not run a browser or a real Entra redirect.
 */
const src = readFileSync("apps/appliance-web/src/sign-in-error.ts", "utf8");
const js = transformSync(src, { loader: "ts", format: "esm" }).code;
const { describeSignInError, NO_ROLE_MESSAGE } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

test("AADSTS50105 (no role assigned) becomes a plain instruction, however the error is shaped", () => {
  const aad = "AADSTS50105: Your administrator has configured the application to block users unless they are specifically granted access. Trace ID: 0000 Correlation ID: 1111 Timestamp: 2026-10-25 12:00:00Z";
  assert.equal(describeSignInError({ errorCode: "access_denied", errorMessage: aad }), NO_ROLE_MESSAGE);
  assert.equal(describeSignInError(new Error(aad)), NO_ROLE_MESSAGE);
  assert.equal(describeSignInError(aad), NO_ROLE_MESSAGE);
  assert.equal(describeSignInError({ message: "x", subError: "aadsts50105" }), NO_ROLE_MESSAGE);
  assert.match(NO_ROLE_MESSAGE, /administrator/);
  assert.match(NO_ROLE_MESSAGE, /role/);
});

test("other errors keep Entra's first line without trace or correlation ids; empty errors still say something", () => {
  const m = describeSignInError({ errorMessage: "AADSTS700016: Application not found in the directory. Trace ID: 1 Correlation ID: 2 Timestamp: 3" });
  assert.equal(m, "Sign-in failed: AADSTS700016: Application not found in the directory.");
  assert.ok(!/Trace ID|Correlation ID/.test(m));
  for (const empty of [null, undefined, {}, "", 42]) assert.match(describeSignInError(empty), /^Sign-in failed/);
});

test("the redirect error is caught and shown instead of silently re-showing the sign-in button", () => {
  const auth = readFileSync("apps/appliance-web/src/auth.ts", "utf8");
  assert.match(auth, /handleRedirectPromise\(\)\)[\s\S]*\.catch\(\(e\) => \{ signInError = describeSignInError\(e\); \}\)/);
  const app = readFileSync("apps/appliance-web/src/App.tsx", "utf8");
  assert.match(app, /if \(signInError\) setError\(signInError\)/);
  const signedOut = app.slice(app.indexOf("if (!account()) return ("), app.indexOf("</main>", app.indexOf("if (!account()) return (")));
  assert.match(signedOut, /\{error && <p role="alert"/, "the signed-out page must show the error");
});
