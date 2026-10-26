import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { StaticTokenCredential } from "@amo/azure-auth";
import { entraPoolConfig, repositoryFromEnv, type PoolConfig } from "./repository.js";

// Found by the first sandbox apply (2026-10-26): the API container exited at start with "Password returned by client is empty".
// The pool was given a connection string and a password function together; with pg 8.23.1 the connection string replaces the
// function with null. The tests below use the real pg library, because a fake pool cannot show that the function survives.

const AZURE_URL = "postgres://id-amo-sandbox-scus-01@pgsql-amo-sandbox-scus-01.postgres.database.azure.com:5432/amo?sslmode=require";
const credential = new StaticTokenCredential("db-token");

interface PgClientLike { connectionParameters: { password: unknown; host: string; port: number; user: string; database: string; ssl: unknown } }
interface PgLike { Pool: new (cfg: unknown) => { options: Record<string, unknown> }; Client: new (cfg: unknown) => PgClientLike }
const pg = createRequire(import.meta.url)("pg") as PgLike;

test("an Azure address becomes separate fields, with no connection string", async () => {
  const cfg = entraPoolConfig(AZURE_URL, credential);
  assert.equal("connectionString" in cfg, false);
  assert.equal(cfg.host, "pgsql-amo-sandbox-scus-01.postgres.database.azure.com");
  assert.equal(cfg.port, 5432);
  assert.equal(cfg.user, "id-amo-sandbox-scus-01");
  assert.equal(cfg.database, "amo");
  assert.deepEqual(cfg.ssl, { rejectUnauthorized: true });
  assert.equal(typeof cfg.password, "function");
  assert.equal(await cfg.password!(), "db-token");
});

test("the real pg library keeps the password function for that configuration", async () => {
  const pool = new pg.Pool(entraPoolConfig(AZURE_URL, credential));
  const client = new pg.Client(pool.options);
  const p = client.connectionParameters;
  assert.equal(typeof p.password, "function", "pg must still hold the token provider, not null or an empty string");
  assert.equal(await (p.password as () => Promise<string>)(), "db-token");
  assert.equal(p.host, "pgsql-amo-sandbox-scus-01.postgres.database.azure.com");
  assert.equal(p.port, 5432);
  assert.equal(p.user, "id-amo-sandbox-scus-01");
  assert.equal(p.database, "amo");
  assert.ok(p.ssl, "TLS must stay on");
});

test("TLS stays on and verified whatever sslmode the address says", () => {
  for (const url of [AZURE_URL, AZURE_URL.replace("?sslmode=require", "?sslmode=disable"), AZURE_URL.replace("?sslmode=require", "")]) {
    assert.deepEqual(entraPoolConfig(url, credential).ssl, { rejectUnauthorized: true }, url);
  }
});

test("a port that is left out defaults to 5432, and application_name passes through", () => {
  const cfg = entraPoolConfig("postgresql://id-x@db.example.postgres.database.azure.com/amo?application_name=amo-worker", credential);
  assert.equal(cfg.port, 5432);
  assert.equal(cfg.application_name, "amo-worker");
  assert.equal("application_name" in entraPoolConfig(AZURE_URL, credential), false);
});

test("an address that cannot be used is refused without echoing it", () => {
  assert.throws(() => entraPoolConfig("not a url", credential), (e: Error) => /not a valid postgres:\/\/ address/.test(e.message) && !e.message.includes("not a url"));
  assert.throws(() => entraPoolConfig("mysql://id-x@db.example.com/amo", credential), /must start with postgres/);
  assert.throws(() => entraPoolConfig("postgres://db.example.postgres.database.azure.com/amo", credential), /must name a host, a user/);
  assert.throws(() => entraPoolConfig("postgres://id-x@db.example.postgres.database.azure.com/", credential), /must name a host, a user/);
});

test("repositoryFromEnv gives the pool separate fields for an Azure host and keeps the connection string for a local one", async () => {
  const seen: PoolConfig[] = [];
  const fake = (cfg: PoolConfig) => { seen.push(cfg); return { async query() { return { rows: [] }; } }; };
  assert.ok(await repositoryFromEnv({ DATABASE_URL: AZURE_URL }, credential, fake));
  assert.ok(await repositoryFromEnv({ DATABASE_URL: "postgres://amo@postgres:5432/amo?sslmode=disable" }, null, fake));
  const [azure, local] = seen;
  assert.equal("connectionString" in azure, false);
  assert.equal(typeof azure.password, "function");
  assert.equal(local.connectionString, "postgres://amo@postgres:5432/amo?sslmode=disable");
  assert.equal("password" in local, false);
});
