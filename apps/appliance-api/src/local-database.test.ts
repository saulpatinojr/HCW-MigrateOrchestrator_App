import { test } from "node:test";
import assert from "node:assert/strict";
import { StaticTokenCredential } from "@amo/azure-auth";
import { isLocalDatabaseUrl } from "./database-url.js";
import { repositoryFromEnv } from "./repository.js";

/** Issue 91: "local" is decided from the parsed host name, not from a substring anywhere in the address. */
const fake = () => ({ async query() { return { rows: [] }; } });

test("local means the host name is localhost, 127.0.0.1, [::1] or the Compose service postgres", () => {
  for (const url of ["postgres://amo@localhost:5432/amo", "postgres://amo@127.0.0.1/amo", "postgres://amo@[::1]:5432/amo", "postgres://amo@postgres:5432/amo?sslmode=disable", "postgres://amo@postgres/amo", "postgres://u:pw@LOCALHOST/amo"]) assert.equal(isLocalDatabaseUrl(url), true, url);
});

test("the word localhost elsewhere in the address does not make it local (failing before the change)", () => {
  for (const url of [
    "postgres://user:secret@db.example.com/amo?application_name=localhost",
    "postgres://localhost@db.example.com/amo",
    "postgres://user@db.example.com/localhost",
    "postgres://user@db.example.com/amo?host=127.0.0.1",
    "postgres://user@db.example.com/amo#localhost",
    "postgres://user@localhost.evil.example/amo",
    "postgres://user@127.0.0.1.evil.example/amo",
    "postgres://user@db.example.com/amo?x=@postgres:5432/",
    "postgres://user@postgres.database.azure.com/amo",
    "postgres://user@mypostgres/amo",
  ]) assert.equal(isLocalDatabaseUrl(url), false, url);
});

test("an address that is not a URL is never local", () => {
  for (const url of ["host=localhost dbname=amo", "localhost", "", "not a url"]) assert.equal(isLocalDatabaseUrl(url), false, JSON.stringify(url));
});

test("a password in a non-local address is refused even when the word localhost appears in it", async () => {
  await assert.rejects(repositoryFromEnv({ DATABASE_URL: "postgres://user:secret@db.example.com/amo?application_name=localhost" }, new StaticTokenCredential(), fake), /must not embed a password/);
});

test("a non-local address needs an Entra credential even when the word localhost appears in it", async () => {
  await assert.rejects(repositoryFromEnv({ DATABASE_URL: "postgres://user@db.example.com/amo?application_name=localhost" }, null, fake), /TokenCredential/);
});

test("the Compose address and a real localhost address still work with no credential", async () => {
  assert.ok(await repositoryFromEnv({ DATABASE_URL: "postgres://amo@postgres:5432/amo?sslmode=disable" }, null, fake));
  assert.ok(await repositoryFromEnv({ DATABASE_URL: "postgres://amo:pw@localhost:5432/amo" }, null, fake));
});
