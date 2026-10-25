/** The only host names that count as a local database: this machine, and the Compose service called postgres. */
const LOCAL_DATABASE_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "postgres"]);

/**
 * True when the database address points at this machine or at the Compose service `postgres`, decided from the parsed host
 * name of the URL and nothing else (issue 91). The earlier test looked for "localhost" anywhere in the text, so
 * `postgres://u:secret@db.example.com/amo?application_name=localhost` counted as local and skipped the two rules for a real
 * server (no password in the address; an Entra credential is required). An address that cannot be parsed as a URL (for
 * example a libpq `host=... dbname=...` string) is never local: the stricter rules apply.
 */
export function isLocalDatabaseUrl(url: string): boolean {
  try {
    return LOCAL_DATABASE_HOSTS.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * True when DATABASE_URL carries a password: a `password=` option, or a `user:password@` part in the address.
 *
 * This replaces the expression `:\/\/[^/]*:[^@]+@`, which CodeQL flagged (js/polynomial-redos): on a value with many
 * colons it rescanned the rest of the string from every colon. The loops below visit each character a bounded number
 * of times and accept exactly what that expression accepted: after a `://`, a colon before the next `/`, followed by
 * at least one character that is not `@`, with an `@` somewhere after that character.
 */
export function embedsPassword(url: string): boolean {
  if (url.includes("password=")) return true;
  const lastAt = url.lastIndexOf("@");
  if (lastAt === -1) return false;
  for (let scheme = url.indexOf("://"); scheme !== -1; scheme = url.indexOf("://", scheme + 3)) {
    for (let i = scheme + 3; i < url.length && url.charCodeAt(i) !== 47; i++) {
      if (url.charCodeAt(i) !== 58) continue;
      if (i + 1 < url.length && url.charCodeAt(i + 1) !== 64 && lastAt >= i + 2) return true;
    }
  }
  return false;
}
