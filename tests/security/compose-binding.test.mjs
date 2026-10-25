import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * docker-compose.appliance.yml is for local development. Its API port used to be published on every network interface of
 * the machine ("8081:8081"), so anyone on the same network could reach the API's public routes, and the local database
 * is configured with trust authentication. Review of pull request 79, finding F8.
 */
const compose = readFileSync("docker-compose.appliance.yml", "utf8").replace(/\r\n/g, "\n");

test("every published port in the local composition is bound to the loopback address", () => {
  const published = [...compose.matchAll(/^\s*ports:\s*\[(.*)\]\s*$/gm)].flatMap((m) => [...m[1].matchAll(/"([^"]+)"/g)].map((p) => p[1]));
  assert.ok(published.length > 0, "expected the API port to be published");
  for (const p of published) assert.match(p, /^127\.0\.0\.1:\d+:\d+$/, `port mapping ${JSON.stringify(p)} is not bound to 127.0.0.1`);
});

test("the local composition tells the API which Host names are its own", () => {
  assert.match(compose, /AMO_ALLOWED_HOSTS: "\$\{AMO_ALLOWED_HOSTS:-localhost:8081,127\.0\.0\.1:8081,\[::1\]:8081\}"/);
});
