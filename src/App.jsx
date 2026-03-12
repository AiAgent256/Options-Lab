import React, { useState, useCallback } from 'react'
import { useBinanceWebSocket } from './hooks/useBinanceWebSocket'
import LiveTicker from './components/LiveTicker'
import OptionsSimulator from './components/OptionsSimulator'
import Portfolio from './components/portfolio/Portfolio'
import MultiChart from './components/MultiChart'
import ErrorBoundary from './components/common/ErrorBoundary'
import { LIVE_SYMBOLS, COLORS, FONTS } from './utils/constants'

export default function App() {
  const [activeTab, setActiveTab] = useState("charts")
  const [activeSymbol, setActiveSymbol] = useState(LIVE_SYMBOLS[0])
  const [syncPrice, setSyncPrice] = useState(true)

  // Binance WebSocket for live price feed to simulator
  const isCrypto = activeSymbol.type === "crypto"
  const binanceSymbol = isCrypto ? activeSymbol.id.toLowerCase() : null
  const { price, priceChange, volume24h, high24h, low24h, connected } = useBinanceWebSocket(binanceSymbol)
  const livePrice = isCrypto ? price : null

  // Navigate from Portfolio → Charts tab
  const handleNavigateToChart = useCallback((tvSymbol) => {
    setActiveTab("charts")
  }, [])

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: COLORS.bg.primary, overflow: "hidden" }}>

      {/* TOP BAR */}
      <div style={{
        height: 44, minHeight: 44, display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 16px", borderBottom: `1px solid ${COLORS.border.primary}`, background: COLORS.bg.secondary, gap: 12, zIndex: 100,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* Logo */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: COLORS.accent.blue, boxShadow: `0 0 10px ${COLORS.accent.blue}80` }} />
            <span style={{ fontFamily: FONTS.display, fontSize: 14, fontWeight: 700, color: COLORS.text.primary, letterSpacing: "-0.3px" }}>OPTIONS LAB</span>
          </div>
          <div style={{ width: 1, height: 20, background: COLORS.border.secondary }} />

          {/* Tabs */}
          <div style={{ display: "flex", gap: 2, background: COLORS.bg.primary, borderRadius: 6, padding: 2 }}>
            {[
              { id: "charts", label: "Charts", icon: "📊" },
              { id: "simulator", label: "Simulator", icon: "⚡" },
              { id: "portfolio", label: "Portfolio", icon: "◉" },
            ].map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
                padding: "5px 14px", fontSize: 11, fontWeight: activeTab === tab.id ? 600 : 400,
                fontFamily: FONTS.mono, cursor: "pointer", border: "none", borderRadius: 5,
                background: activeTab === tab.id ? COLORS.accent.blueBg : "transparent",
                color: activeTab === tab.id ? COLORS.accent.blue : COLORS.text.dim,
                transition: "all 0.15s", display: "flex", alignItems: "center", gap: 5,
              }}>
                <span style={{ fontSize: 10 }}>{tab.icon}</span> {tab.label}
              </button>
            ))}
          </div>

          {/* Simulator: live price sync symbol picker */}
          {activeTab === "simulator" && (
            <>
              <div style={{ width: 1, height: 16, background: COLORS.border.subtle }} />
              <span style={{ fontSize: 9, color: COLORS.text.dim }}>Live Price:</span>
              <div style={{ display: "flex", gap: 2 }}>
                {LIVE_SYMBOLS.map(sym => (
                  <button key={sym.id} onClick={() => setActiveSymbol(sym)} style={{
                    padding: "4px 10px", fontSize: 10, fontWeight: activeSymbol.id === sym.id ? 600 : 400,
                    fontFamily: FONTS.mono, cursor: "pointer", border: "none", borderRadius: 4,
                    background: activeSymbol.id === sym.id ? COLORS.accent.blueHover : "transparent",
                    color: activeSymbol.id === sym.id ? COLORS.accent.blue : COLORS.text.dim,
                    transition: "all 0.15s",
                  }}>
                    {sym.label}
                  </button>
                ))}
              </div>
              {isCrypto && (
                <button onClick={() => setSyncPrice(!syncPrice)} style={{
                  padding: "4px 10px", fontSize: 9, fontFamily: FONTS.mono, cursor: "pointer",
                  border: `1px solid ${syncPrice ? COLORS.positive.border : COLORS.border.secondary}`, borderRadius: 4,
                  background: syncPrice ? COLORS.positive.bg : "transparent",
                  color: syncPrice ? COLORS.positive.text : COLORS.text.dim,
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
        <ErrorBoundary label="Charts">
          <div style={{ flex: 1, overflow: "hidden" }}>
            <MultiChart />
          </div>
        </ErrorBoundary>
      )}

      {activeTab === "simulator" && (
        <ErrorBoundary label="Options Simulator">
          <div style={{ flex: 1, overflow: "auto" }}>
            <OptionsSimulator livePrice={syncPrice ? livePrice : null} livePriceSymbol={syncPrice ? activeSymbol.label : null} />
          </div>
        </ErrorBoundary>
      )}

      {activeTab === "portfolio" && (
        <ErrorBoundary label="Portfolio">
          <div style={{ flex: 1, overflow: "auto" }}>
            <Portfolio onNavigateToChart={handleNavigateToChart} />
          </div>
        </ErrorBoundary>
      )}
    </div>
  )
}
