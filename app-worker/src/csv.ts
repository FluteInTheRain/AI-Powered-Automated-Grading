/** Excel reads a UTF-8 file as UTF-8 only when it starts with a BOM; without it Vietnamese names turn to mojibake. */
export const CSV_BOM = "﻿";

/**
 * One CSV cell. Text starting with = + - @ (or a tab/CR, which Excel also treats as a formula lead-in) gets a leading
 * apostrophe so Excel shows it as text instead of running it. Numbers and null never need the guard: a negative
 * number is a number, not a formula. Cells with a comma, quote or line break are quoted, with quotes doubled.
 */
export function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** BOM + CRLF-separated rows (Excel's native line ending). */
export function toCsv(rows: (string | number | null)[][]): string {
  return CSV_BOM + rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
