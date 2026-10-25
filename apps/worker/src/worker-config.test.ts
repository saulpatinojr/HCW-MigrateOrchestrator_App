import { test } from "node:test";
import assert from "node:assert/strict";
import { workerConfigFromEnv } from "./index.js";

/**
 * The worker has no web interface, so it has no use for the browser allow-list (AMO_ALLOWED_ORIGINS) or the host
 * allow-list (AMO_ALLOWED_HOSTS). It used to parse both through the API's configuration, so one badly written value in an
 * environment shared with the API stopped the worker too (review of pull request 79, finding F10).
 */
test("the worker starts even when the API-only variables are malformed", () => {
  const cfg = workerConfigFromEnv({ AMO_ALLOWED_ORIGINS: "*", AMO_ALLOWED_HOSTS: "http://not-a-host/path" });
  assert.deepEqual(cfg.allowedOrigins, []);
});

test("the worker still refuses what it must refuse: a client secret", () => {
  assert.throws(() => workerConfigFromEnv({ AMO_CLIENT_SECRET: "x" }), /client secret/);
});

test("the worker's configuration carries no host allow-list either", () => {
  assert.deepEqual(workerConfigFromEnv({ AMO_ALLOWED_HOSTS: "localhost:8081" }).allowedHosts, []);
});
