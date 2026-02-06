import React, { memo, useRef, useEffect, useState } from 'react'

/**
 * Compact live price ticker that sits in the top bar.
 * Shows price with flash animation on changes, plus 24h stats.
 */
function LiveTicker({ symbol, price, change, high, low, volume, connected }) {
  const prevPriceRef = useRef(price)
  const [flash, setFlash] = useState(null) // "up" | "down" | null

  useEffect(() => {
    if (price !== prevPriceRef.current && prevPriceRef.current > 0) {
      setFlash(price > prevPriceRef.current ? "up" : "down")
      const timer = setTimeout(() => setFlash(null), 400)
      prevPriceRef.current = price
      return () => clearTimeout(timer)
    }
    prevPriceRef.current = price
  }, [price])

  const fmt = (v, decimals = 2) => {
    if (!v || !isFinite(v)) return "—"
    if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
    if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`
    return `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`
  }

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 16,
      fontFamily: "'JetBrains Mono', monospace",
    }}>
      {/* Connection indicator */}
      <div style={{
        width: 6, height: 6, borderRadius: "50%",
        background: connected ? "#22c55e" : "#ef4444",
        boxShadow: connected ? "0 0 8px #22c55e60" : "0 0 8px #ef444460",
      }} />

      {/* Price */}
      <div style={{
        fontSize: 16, fontWeight: 700, letterSpacing: "-0.3px",
        color: flash === "up" ? "#22c55e" : flash === "down" ? "#ef4444" : "#e0e4ec",
        transition: "color 0.3s",
        textShadow: flash ? `0 0 12px ${flash === "up" ? "#22c55e40" : "#ef444440"}` : "none",
      }}>
        {fmt(price)}
      </div>

      {/* 24h Change */}
      <div style={{
        fontSize: 11, fontWeight: 600,
        color: change >= 0 ? "#22c55e" : "#ef4444",
        padding: "2px 8px", borderRadius: 4,
        background: change >= 0 ? "#22c55e10" : "#ef444410",
      }}>
        {change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(2)}%
      </div>

      {/* 24h Stats */}
      <div style={{ display: "flex", gap: 12, fontSize: 9, color: "#4a5060" }}>
        <span>H <span style={{ color: "#5a6070" }}>{fmt(high)}</span></span>
        <span>L <span style={{ color: "#5a6070" }}>{fmt(low)}</span></span>
        <span>Vol <span style={{ color: "#5a6070" }}>{fmt(volume)}</span></span>
      </div>
    </div>
  )
}

export default memo(LiveTicker)
