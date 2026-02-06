import React, { useState, useCallback } from 'react'
import { useBinanceWebSocket } from './hooks/useBinanceWebSocket'
import TradingViewChart from './components/TradingViewChart'
import LiveTicker from './components/LiveTicker'
import OptionsSimulator from './components/OptionsSimulator'
import Portfolio from './components/Portfolio'

// ─── LAYOUT MODES (for simulator view) ─────────────────────────────────────
const LAYOUTS = {
  split: { label: "Split", icon: "◫" },
  chartTop: { label: "Chart Top", icon: "▤" },
  simOnly: { label: "Simulator", icon: "▢" },
  chartOnly: { label: "Chart", icon: "▣" },
}

// ─── SYMBOL PRESETS ────────────────────────────────────────────────────────
const SYMBOLS = [
  { id: "BTCUSDT", tvSymbol: "BINANCE:BTCUSDT", label: "BTC/USDT", type: "crypto" },
  { id: "ETHUSDT", tvSymbol: "BINANCE:ETHUSDT", label: "ETH/USDT", type: "crypto" },
  { id: "SOLUSDT", tvSymbol: "BINANCE:SOLUSDT", label: "SOL/USDT", type: "crypto" },
  { id: "MSTR",    tvSymbol: "NASDAQ:MSTR",     label: "MSTR",     type: "equity" },
  { id: "COIN",    tvSymbol: "NASDAQ:COIN",      label: "COIN",     type: "equity" },
  { id: "MARA",    tvSymbol: "NASDAQ:MARA",      label: "MARA",     type: "equity" },
  { id: "RIOT",    tvSymbol: "NASDAQ:RIOT",       label: "RIOT",     type: "equity" },
  { id: "SPY",     tvSymbol: "AMEX:SPY",          label: "SPY",      type: "equity" },
]

export default function App() {
  // ─── TOP-LEVEL STATE ────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState("simulator") // "simulator" | "portfolio"
  const [layout, setLayout] = useState("split")
  const [activeSymbol, setActiveSymbol] = useState(SYMBOLS[0])
  const [customSymbol, setCustomSymbol] = useState("")
  const [syncPrice, setSyncPrice] = useState(true)
  const [panelWidth, setPanelWidth] = useState(55)

  // Binance WebSocket — only connects for crypto symbols
  const isCrypto = activeSymbol.type === "crypto"
  const binanceSymbol = isCrypto ? activeSymbol.id.toLowerCase() : null
  const { price, priceChange, volume24h, high24h, low24h, connected } = useBinanceWebSocket(binanceSymbol)

  const livePrice = isCrypto ? price : null

  const handleSymbolChange = useCallback((sym) => {
    setActiveSymbol(sym)
    setCustomSymbol("")
  }, [])

  const handleCustomSymbol = useCallback((e) => {
    if (e.key === "Enter" && customSymbol.trim()) {
      const sym = customSymbol.trim().toUpperCase()
      setActiveSymbol({
        id: sym,
        tvSymbol: sym.includes(":") ? sym : sym,
        label: sym,
        type: sym.includes("USDT") ? "crypto" : "equity",
      })
    }
  }, [customSymbol])

  // Navigate from Portfolio → Chart for a specific symbol
  const handleNavigateToChart = useCallback((tvSymbol) => {
    const parts = tvSymbol.split(":")
    setActiveSymbol({
      id: parts[parts.length - 1],
      tvSymbol,
      label: parts[parts.length - 1],
      type: tvSymbol.includes("BINANCE") ? "crypto" : "equity",
    })
    setActiveTab("simulator")
    setLayout("chartOnly")
  }, [])

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "#0a0c10", overflow: "hidden" }}>

      {/* ═══════════════════════════════════════════════════════════════════════
           TOP BAR
         ═══════════════════════════════════════════════════════════════════════ */}
      <div style={{
        height: 44, minHeight: 44, display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 16px", borderBottom: "1px solid #1a1d28", background: "#0d0f15", gap: 12, zIndex: 100,
      }}>
        {/* Left: Logo + Primary Tabs + Symbol Picker */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* Logo */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#3b82f6", boxShadow: "0 0 10px #3b82f680" }} />
            <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 14, fontWeight: 700, color: "#e0e4ec", letterSpacing: "-0.3px" }}>OPTIONS LAB</span>
          </div>
          <div style={{ width: 1, height: 20, background: "#1e2330" }} />

          {/* Primary tabs: Simulator / Portfolio */}
          <div style={{ display: "flex", gap: 2, background: "#0a0c10", borderRadius: 6, padding: 2 }}>
            {[
              { id: "simulator", label: "Simulator", icon: "⚡" },
              { id: "portfolio", label: "Portfolio", icon: "◉" },
            ].map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
                padding: "5px 14px", fontSize: 11, fontWeight: activeTab === tab.id ? 600 : 400,
                fontFamily: "'JetBrains Mono', monospace", cursor: "pointer", border: "none", borderRadius: 5,
                background: activeTab === tab.id ? "#3b82f618" : "transparent",
                color: activeTab === tab.id ? "#3b82f6" : "#4a5060",
                transition: "all 0.15s", display: "flex", alignItems: "center", gap: 5,
              }}>
                <span style={{ fontSize: 10 }}>{tab.icon}</span> {tab.label}
              </button>
            ))}
          </div>

          {/* Symbol picker — only visible in Simulator mode */}
          {activeTab === "simulator" && (
            <>
              <div style={{ width: 1, height: 16, background: "#1a1d2860" }} />
              <div style={{ display: "flex", gap: 2 }}>
                {SYMBOLS.map(sym => (
                  <button key={sym.id} onClick={() => handleSymbolChange(sym)} style={{
                    padding: "4px 10px", fontSize: 10, fontWeight: activeSymbol.id === sym.id ? 600 : 400,
                    fontFamily: "'JetBrains Mono', monospace", cursor: "pointer", border: "none", borderRadius: 4,
                    background: activeSymbol.id === sym.id ? "#3b82f620" : "transparent",
                    color: activeSymbol.id === sym.id ? "#3b82f6" : "#4a5060",
                    transition: "all 0.15s",
                  }}>
                    {sym.label}
                  </button>
                ))}
              </div>
              <input
                type="text" placeholder="Custom (e.g. BINANCE:BTCUSDT)" value={customSymbol}
                onChange={e => setCustomSymbol(e.target.value)} onKeyDown={handleCustomSymbol}
                style={{
                  width: 180, padding: "4px 8px", fontSize: 10, fontFamily: "'JetBrains Mono', monospace",
                  background: "#12151c", border: "1px solid #1e2330", borderRadius: 4, color: "#c8ccd4", outline: "none",
                }}
              />
            </>
          )}
        </div>

        {/* Center: Live Ticker */}
        {isCrypto && price > 0 && activeTab === "simulator" && (
          <LiveTicker
            symbol={activeSymbol.label} price={price} change={priceChange}
            high={high24h} low={low24h} volume={volume24h} connected={connected}
          />
        )}

        {/* Right: Layout + Sync controls (only in Simulator view) */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {activeTab === "simulator" && (
            <>
              {isCrypto && (
                <button onClick={() => setSyncPrice(!syncPrice)} style={{
                  padding: "4px 10px", fontSize: 9, fontFamily: "'JetBrains Mono', monospace", cursor: "pointer",
                  border: `1px solid ${syncPrice ? "#22c55e40" : "#1e2330"}`, borderRadius: 4,
                  background: syncPrice ? "#22c55e15" : "transparent",
                  color: syncPrice ? "#22c55e" : "#4a5060",
                }}>
                  {syncPrice ? "● LIVE SYNC" : "○ MANUAL"}
                </button>
              )}
              <div style={{ display: "flex", gap: 2 }}>
                {Object.entries(LAYOUTS).map(([key, l]) => (
                  <button key={key} onClick={() => setLayout(key)} title={l.label} style={{
                    padding: "4px 8px", fontSize: 12, cursor: "pointer", border: "none", borderRadius: 3,
                    background: layout === key ? "#3b82f620" : "transparent",
                    color: layout === key ? "#3b82f6" : "#3a4050",
                  }}>
                    {l.icon}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
           MAIN CONTENT
         ═══════════════════════════════════════════════════════════════════════ */}

      {/* ─── PORTFOLIO TAB ─── */}
      {activeTab === "portfolio" && (
        <div style={{ flex: 1, overflow: "auto" }}>
          <Portfolio onNavigateToChart={handleNavigateToChart} />
        </div>
      )}

      {/* ─── SIMULATOR TAB ─── */}
      {activeTab === "simulator" && (
        <>
          {layout === "split" ? (
            <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
              <div style={{ width: `${panelWidth}%`, height: "100%", borderRight: "1px solid #1a1d28", position: "relative" }}>
                <TradingViewChart symbol={activeSymbol.tvSymbol} />
                <div
                  style={{
                    position: "absolute", right: -3, top: 0, bottom: 0, width: 6, cursor: "col-resize", zIndex: 10,
                    background: "transparent",
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    const startX = e.clientX
                    const startW = panelWidth
                    const onMove = (ev) => {
                      const delta = ev.clientX - startX
                      const newW = startW + (delta / window.innerWidth) * 100
                      setPanelWidth(Math.max(20, Math.min(80, newW)))
                    }
                    const onUp = () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp) }
                    document.addEventListener("mousemove", onMove)
                    document.addEventListener("mouseup", onUp)
                  }}
                  onMouseEnter={e => e.target.style.background = "#3b82f640"}
                  onMouseLeave={e => e.target.style.background = "transparent"}
                />
              </div>
              <div style={{ flex: 1, height: "100%", overflow: "auto" }}>
                <OptionsSimulator livePrice={syncPrice ? livePrice : null} livePriceSymbol={syncPrice ? activeSymbol.label : null} />
              </div>
            </div>
          ) : layout === "chartTop" ? (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              <div style={{ height: "40%", minHeight: 200, borderBottom: "1px solid #1a1d28" }}>
                <TradingViewChart symbol={activeSymbol.tvSymbol} />
              </div>
              <div style={{ flex: 1, overflow: "auto" }}>
                <OptionsSimulator livePrice={syncPrice ? livePrice : null} livePriceSymbol={syncPrice ? activeSymbol.label : null} />
              </div>
            </div>
          ) : layout === "chartOnly" ? (
            <div style={{ flex: 1 }}>
              <TradingViewChart symbol={activeSymbol.tvSymbol} />
            </div>
          ) : (
            <div style={{ flex: 1, overflow: "auto" }}>
              <OptionsSimulator livePrice={syncPrice ? livePrice : null} livePriceSymbol={syncPrice ? activeSymbol.label : null} />
            </div>
          )}
        </>
      )}
    </div>
  )
}
