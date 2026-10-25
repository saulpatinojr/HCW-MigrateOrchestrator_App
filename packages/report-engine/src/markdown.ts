/**
 * Makes text safe to put in one cell of a Markdown table. Backslashes are escaped first: otherwise a backslash in the
 * text would sit in front of the backslash added for a pipe, cancel it, and let the pipe split the row (CodeQL
 * js/incomplete-sanitization).
 */
export const esc = (s: string): string => s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, " ");
