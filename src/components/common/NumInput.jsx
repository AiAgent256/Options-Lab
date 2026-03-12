import React from "react";

/**
 * Labeled numeric input field.
 * Works with useNumInput/useOptNumInput hooks.
 */
export default function NumInput({ label, input, step, min, max, placeholder, style }) {
  return (
    <div className="input-group" style={style}>
      <span className="input-label">{label}</span>
      <input
        type="number"
        value={input.raw}
        onChange={input.onChange}
        step={step}
        min={min}
        max={max}
        placeholder={placeholder}
      />
    </div>
  );
}
