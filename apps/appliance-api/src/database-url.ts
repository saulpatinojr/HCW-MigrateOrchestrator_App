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
