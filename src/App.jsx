import React, { useState, useCallback } from 'react'
import Portfolio from './components/portfolio/Portfolio'
import PokemonMarket from './components/PokemonMarket'
import MultiChart from './components/MultiChart'
import ErrorBoundary from './components/common/ErrorBoundary'
import { COLORS, FONTS } from './utils/constants'

export default function App() {
  const [activeTab, setActiveTab] = useState("portfolio")

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
          <span style={{ fontFamily: FONTS.ui, fontSize: 13, fontWeight: 700, letterSpacing: "0.08em", color: COLORS.text.primary }}>OPTIONS LAB</span>
          <div style={{ width: 1, height: 20, background: COLORS.border.primary }} />

          {/* Tabs — flat underline style */}
          <div style={{ display: "flex", gap: 0, height: 44, alignItems: "stretch" }}>
            {[
              { id: "charts", label: "Charts" },
              { id: "portfolio", label: "Portfolio" },
              { id: "pokemon", label: "Pokemon" },
            ].map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
                padding: "8px 14px", fontSize: 11, fontWeight: 500,
                fontFamily: FONTS.ui, cursor: "pointer", border: "none",
                borderBottom: activeTab === tab.id ? `2px solid ${COLORS.accent.blue}` : "2px solid transparent",
                background: "none", borderRadius: 0,
                color: activeTab === tab.id ? COLORS.text.primary : COLORS.text.muted,
                transition: "all 0.15s",
              }}>
                {tab.label}
              </button>
            ))}
          </div>
        </div>

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

      {activeTab === "portfolio" && (
        <ErrorBoundary label="Portfolio">
          <div style={{ flex: 1, overflow: "auto" }}>
            <Portfolio onNavigateToChart={handleNavigateToChart} />
          </div>
        </ErrorBoundary>
      )}

      {activeTab === "pokemon" && (
        <ErrorBoundary label="Pokemon Market">
          <div style={{ flex: 1, overflow: "auto" }}>
            <PokemonMarket />
          </div>
        </ErrorBoundary>
      )}
    </div>
  )
}
