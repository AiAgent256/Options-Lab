/**
 * Formatting utilities for financial display.
 * Pure functions — no side effects.
 */

const DASH = "—";

export function fmt(n, d = 2) {
  return n != null && isFinite(n) ? Number(n).toFixed(d) : DASH;
}

export function fmtPct(n) {
  return n != null && isFinite(n) ? (n * 100).toFixed(1) + "%" : DASH;
}

export function addCommas(s) {
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function fmtDollar(n) {
  if (n == null || !isFinite(n)) return DASH;
  const abs = Math.abs(n);
  const str = abs < 0.01 && abs > 0 ? abs.toFixed(4) : abs.toFixed(2);
  return (n < 0 ? "-$" : "$") + addCommas(str);
}

export function fmtPnl(n) {
  if (n == null || !isFinite(n)) return DASH;
  return (n >= 0 ? "+" : "-") + "$" + addCommas(Math.abs(n).toFixed(2));
}

export function fmtPnlPct(n) {
  if (n == null || !isFinite(n)) return DASH;
  return (n >= 0 ? "+" : "") + (n * 100).toFixed(1) + "%";
}
