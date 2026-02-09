import React, { useState, useCallback } from 'react'
import { useBinanceWebSocket } from './hooks/useBinanceWebSocket'
import LiveTicker from './components/LiveTicker'
import OptionsSimulator from './components/OptionsSimulator'
import Portfolio from './components/Portfolio'
import MultiChart from './components/MultiChart'

// ─── SYMBOL PRESETS (for simulator live price sync) ──────────────────────────
const SYMBOLS = [
  { id: "BTCUSDT", tvSymbol: "COINBASE:BTCUSD", label: "BTC/USDT", type: "crypto" },
  { id: "ETHUSDT", tvSymbol: "COINBASE:ETHUSD", label: "ETH/USDT", type: "crypto" },
  { id: "SOLUSDT", tvSymbol: "COINBASE:SOLUSD", label: "SOL/USDT", type: "crypto" },
]

export default function App() {
  const [activeTab, setActiveTab] = useState("charts")
  const [activeSymbol, setActiveSymbol] = useState(SYMBOLS[0])
  const [syncPrice, setSyncPrice] = useState(true)

  // Binance WebSocket for live price feed to simulator
  const isCrypto = activeSymbol.type === "crypto"
  const binanceSymbol = isCrypto ? activeSymbol.id.toLowerCase() : null
  const { price, priceChange, volume24h, high24h, low24h, connected } = useBinanceWebSocket(binanceSymbol)
  const livePrice = isCrypto ? price : null

  // Navigate from Portfolio → Charts tab (could also open in multichart)
  const handleNavigateToChart = useCallback((tvSymbol) => {
    setActiveTab("charts")
  }, [])

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "#0a0c10", overflow: "hidden" }}>

      {/* TOP BAR */}
      <div style={{
        height: 44, minHeight: 44, display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 16px", borderBottom: "1px solid #1a1d28", background: "#0d0f15", gap: 12, zIndex: 100,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* Logo */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#3b82f6", boxShadow: "0 0 10px #3b82f680" }} />
            <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 14, fontWeight: 700, color: "#e0e4ec", letterSpacing: "-0.3px" }}>OPTIONS LAB</span>
          </div>
          <div style={{ width: 1, height: 20, background: "#1e2330" }} />

          {/* Tabs */}
          <div style={{ display: "flex", gap: 2, background: "#0a0c10", borderRadius: 6, padding: 2 }}>
            {[
              { id: "charts", label: "Charts", icon: "📊" },
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

          {/* Simulator: live price sync symbol picker */}
          {activeTab === "simulator" && (
            <>
              <div style={{ width: 1, height: 16, background: "#1a1d2860" }} />
              <span style={{ fontSize: 9, color: "#4a5060" }}>Live Price:</span>
              <div style={{ display: "flex", gap: 2 }}>
                {SYMBOLS.map(sym => (
                  <button key={sym.id} onClick={() => setActiveSymbol(sym)} style={{
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
              {isCrypto && (
                <button onClick={() => setSyncPrice(!syncPrice)} style={{
                  padding: "4px 10px", fontSize: 9, fontFamily: "'JetBrains Mono', monospace", cursor: "pointer",
                  border: `1px solid ${syncPrice ? "#22c55e40" : "#1e2330"}`, borderRadius: 4,
                  background: syncPrice ? "#22c55e15" : "transparent", color: syncPrice ? "#22c55e" : "#4a5060",
                }}>
                  {syncPrice ? "● LIVE SYNC" : "○ MANUAL"}
                </button>
              )}
            </>
          )}
        </div>

        {/* Center: Live Ticker (simulator only) */}
        {isCrypto && price > 0 && activeTab === "simulator" && (
          <LiveTicker symbol={activeSymbol.label} price={price} change={priceChange}
            high={high24h} low={low24h} volume={volume24h} connected={connected} />
        )}

        <div />
      </div>

      {/* MAIN CONTENT */}

      {activeTab === "charts" && (
        <div style={{ flex: 1, overflow: "hidden" }}>
          <MultiChart />
        </div>
      )}

      {activeTab === "simulator" && (
        <div style={{ flex: 1, overflow: "auto" }}>
          <OptionsSimulator livePrice={syncPrice ? livePrice : null} livePriceSymbol={syncPrice ? activeSymbol.label : null} />
        </div>
      )}

      {activeTab === "portfolio" && (
        <div style={{ flex: 1, overflow: "auto" }}>
          <Portfolio onNavigateToChart={handleNavigateToChart} />
        </div>
      )}
    </div>
  )
}
