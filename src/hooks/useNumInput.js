import { useState, useCallback } from "react";

/**
 * Safe numeric input hook — handles intermediate typing states
 * like empty string, lone minus sign, or decimal point without NaN.
 * 
 * @param {number} initial  - Default value
 * @param {number} fallback - Value to use when input is empty/invalid
 * @returns {{ raw: string, value: number, onChange: Function, set: Function }}
 */
export function useNumInput(initial, fallback = 0) {
  const [raw, setRaw] = useState(String(initial));
  const parsed = raw === "" || raw === "-" || raw === "." ? fallback : Number(raw);
  const value = isFinite(parsed) ? parsed : fallback;
  const onChange = useCallback((e) => setRaw(e.target.value), []);
  const set = useCallback((v) => setRaw(String(v)), []);
  return { raw, value, onChange, set };
}

/**
 * Optional numeric input — value is null when empty.
 * Used for override fields where "no value" is meaningful.
 * 
 * @param {number|null} initial
 * @returns {{ raw: string, value: number|null, onChange: Function, set: Function }}
 */
export function useOptNumInput(initial = null) {
  const [raw, setRaw] = useState(initial != null ? String(initial) : "");
  const parsed = raw === "" ? null : Number(raw);
  const value = parsed != null && isFinite(parsed) ? parsed : null;
  const onChange = useCallback((e) => setRaw(e.target.value), []);
  const set = useCallback((v) => setRaw(v != null ? String(v) : ""), []);
  return { raw, value, onChange, set };
}
