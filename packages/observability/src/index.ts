/**
 * Minimal structured logger with redaction. OpenTelemetry-compatible attribute naming;
 * exporters can be attached later without changing call sites (ADR-0014).
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

const REDACTED = "[REDACTED]";

// Every quantifier below has an upper bound (or a value class that cannot overlap the next token), and the two
// patterns that need a closing part (PEM footer, JWT dots) are written so a failed attempt cannot rescan the input from
// every later start position. That keeps the cost linear in the input length, so a crafted log line cannot stall the
// logger (CodeQL js/polynomial-redos, AMO-13).

// Secrets with no key name in front of them: the whole match is replaced with a fixed marker.
const WHOLE_SECRET_PATTERNS: RegExp[] = [
  // A PEM private key block. The body is anything except the start of the footer (so the "Proc-Type:" header lines of
  // an old encrypted key are covered), capped at 16 KiB. The footer is optional so a key cut off in the middle of a
  // log line is still hidden.
  /-----BEGIN (?:[A-Z]{1,10} ){0,3}PRIVATE KEY-----(?:[^-]|-(?!----END )){0,16384}(?:-----END (?:[A-Z]{1,10} ){0,3}PRIVATE KEY-----)?/g,
  // A JWT: three dot-separated base64url parts, the first starting "eyJ" ({"). The lookbehind means only the start of a
  // run of token characters is tried, so a long run of "eyJeyJ..." is scanned once, not once per "eyJ". The signature
  // part may be empty (an unsigned token).
  /(?<![A-Za-z0-9_])eyJ[A-Za-z0-9_-]{10,2048}\.[A-Za-z0-9_-]{10,16384}\.[A-Za-z0-9_-]{0,4096}/g,
];

// Whitespace between a separator and its value. When the separator is followed by spaces, the next word must not itself
// look like another "key:" or "key=" (the first key then has an empty value): otherwise "api_key= token: s3cr3t" would
// take "token:" as the value and leave the real secret in the output. Both counts are bounded.
const SPACE_THEN_VALUE = String.raw`(?:[ \t]{1,64}(?![^\s;,]{0,64}[=:](?:[ \t]|$)))?`;

// "key=value" secrets: group 1 is the key and separator, which stay readable; only the value is replaced.
const KEYED_SECRET_PATTERNS: RegExp[] = [
  /(AccountKey=)[^;\s]+/gi,
  /(SharedAccessSignature=)[^;\s]+/gi,
  /(sig=)[A-Za-z0-9%+/=]{20,}/gi,
  // An Authorization header, with or without a scheme word: the credential (an opaque token, "user:password" in Basic
  // form, anything) is hidden, to the end of the value however long it is (a length cap would leave the rest of a long credential in
  // the log). The scheme word and the separators are bounded; the value is consumed once, so the cost stays linear.
  new RegExp(String.raw`(\b(?:proxy-)?authorization["']?[ \t]{0,16}[=:]${SPACE_THEN_VALUE}(?:(?:bearer|basic|negotiate|digest|token)[ \t]{1,16})?)[^\s;,"']+`, "gi"),
  // A bare "Bearer <opaque token>", as it appears in an error message that quotes a request.
  // The 20-character floor keeps ordinary prose ("Bearer authentication failed") readable.
  /(\bbearer[ \t]{1,16})[A-Za-z0-9._~+/-]{20,}=*/gi,
  // JSON or object-literal form: "password": "value". The key may carry a prefix or suffix (client_secret, secretKey).
  /("[A-Za-z0-9_.-]{0,64}(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|subscription[_-]?key|private[_-]?key)[A-Za-z0-9_.-]{0,64}"[ \t]{0,16}:[ \t]{0,16}")(?:[^"\\]|\\.)+/gi,
  // key=value or key: value, with the key spelled in any of the usual ways.
  new RegExp(String.raw`((?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|subscription[_-]?key|private[_-]?key)[ \t]{0,64}[=:]${SPACE_THEN_VALUE})[^;\s,]+`, "gi"),
];

export function redact(input: string): string {
  let out = input;
  for (const p of WHOLE_SECRET_PATTERNS) out = out.replace(p, REDACTED);
  for (const p of KEYED_SECRET_PATTERNS) out = out.replace(p, (_match, keyPart: string) => keyPart + REDACTED);
  return out;
}

export interface LogRecord {
  ts: string;
  level: LogLevel;
  msg: string;
  attrs: Record<string, unknown>;
}

export interface Logger {
  log(level: LogLevel, msg: string, attrs?: Record<string, unknown>): void;
  info(msg: string, attrs?: Record<string, unknown>): void;
  warn(msg: string, attrs?: Record<string, unknown>): void;
  error(msg: string, attrs?: Record<string, unknown>): void;
  debug(msg: string, attrs?: Record<string, unknown>): void;
  child(attrs: Record<string, unknown>): Logger;
}

export function createLogger(base: Record<string, unknown> = {}, sink: (r: LogRecord) => void = defaultSink): Logger {
  const log = (level: LogLevel, msg: string, attrs: Record<string, unknown> = {}) => {
    const safe: Record<string, unknown> = {};
    for (const [k, v] of Object.entries({ ...base, ...attrs })) {
      // Never log raw CSV rows or payloads: only scalar, redacted values.
      safe[k] = typeof v === "string" ? redact(v) : typeof v === "object" && v !== null ? "[object]" : v;
    }
    sink({ ts: new Date().toISOString(), level, msg: redact(msg), attrs: safe });
  };
  return {
    log,
    info: (m, a) => log("info", m, a),
    warn: (m, a) => log("warn", m, a),
    error: (m, a) => log("error", m, a),
    debug: (m, a) => log("debug", m, a),
    child: (attrs) => createLogger({ ...base, ...attrs }, sink),
  };
}

function defaultSink(r: LogRecord): void {
  if (process.env.AMO_LOG_SILENT === "1") return;
  process.stderr.write(JSON.stringify(r) + "\n");
}

export const noopLogger: Logger = createLogger({}, () => {});
