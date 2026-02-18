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
  let str;
  if (abs === 0) str = "0.00";
  else if (abs < 0.001) str = abs.toFixed(6);
  else if (abs < 1) str = abs.toFixed(4);
  else str = abs.toFixed(2);
  return (n < 0 ? "-$" : "$") + addCommas(str);
}

/**
 * Format per-unit prices with appropriate precision.
 * Shows 4+ decimals for sub-dollar, 2 for $1+.
 */
export function fmtPrice(n) {
  if (n == null || !isFinite(n)) return DASH;
  const abs = Math.abs(n);
  let str;
  if (abs === 0) str = "0.00";
  else if (abs < 0.001) str = abs.toFixed(6);
  else if (abs < 1) str = abs.toFixed(4);
  else if (abs < 100) str = abs.toFixed(2);
  else str = abs.toFixed(2);
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
