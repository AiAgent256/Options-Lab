import React, { useState, useEffect, useRef, memo, useCallback } from "react"

// ─── MINI TRADINGVIEW CHART ──────────────────────────────────────────────────
const TVChart = memo(function TVChart({ symbol, interval = "60", showToolbar = true }) {
  const ref = useRef(null)

  useEffect(() => {
    if (!ref.current) return
    ref.current.innerHTML = ""

    const widgetContainer = document.createElement("div")
    widgetContainer.className = "tradingview-widget-container__widget"
    widgetContainer.style.height = "100%"
    widgetContainer.style.width = "100%"
    ref.current.appendChild(widgetContainer)

    const script = document.createElement("script")
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js"
    script.type = "text/javascript"
    script.async = true
    script.innerHTML = JSON.stringify({
      symbol,
      width: "100%",
      height: "100%",
      autosize: true,
      theme: "dark",
      style: "1",
      colorTheme: "dark",
      backgroundColor: "rgba(10, 12, 16, 1)",
      gridColor: "rgba(26, 29, 40, 0.6)",
      timezone: "Etc/UTC",
      interval,
      range: "3M",
      allow_symbol_change: true,
      save_image: false,
      hide_volume: false,
      support_host: "https://www.tradingview.com",
      hide_top_toolbar: !showToolbar,
      hide_side_toolbar: true,
      hide_legend: false,
      studies: ["STD;Volume"],
      withdateranges: false,
      details: false,
      hotlist: false,
      calendar: false,
      show_popup_button: true,
      popup_width: "1000",
      popup_height: "650",
    })

    ref.current.appendChild(script)
    return () => { if (ref.current) ref.current.innerHTML = "" }
  }, [symbol, interval, showToolbar])

  return <div ref={ref} style={{ height: "100%", width: "100%", overflow: "hidden", background: "#0a0c10" }} />
})

// ─── STORAGE ─────────────────────────────────────────────────────────────────
const STORAGE_KEY = "optlab:multicharts"
const DEFAULT_CHARTS = [
  { id: 1, symbol: "COINBASE:BTCUSD" },
]

function loadCharts() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved ? JSON.parse(saved) : DEFAULT_CHARTS
  } catch { return DEFAULT_CHARTS }
}

// ─── PRESETS ─────────────────────────────────────────────────────────────────
const QUICK_SYMBOLS = [
  { label: "BTC", sym: "COINBASE:BTCUSD" },
  { label: "ETH", sym: "COINBASE:ETHUSD" },
  { label: "SOL", sym: "COINBASE:SOLUSD" },
  { label: "HYPE", sym: "COINBASE:HYPEUSD" },
  { label: "MSTR", sym: "NASDAQ:MSTR" },
  { label: "SMR", sym: "NYSE:SMR" },
  { label: "AAOI", sym: "NASDAQ:AAOI" },
  { label: "COIN", sym: "NASDAQ:COIN" },
  { label: "MARA", sym: "NASDAQ:MARA" },
  { label: "RIOT", sym: "NASDAQ:RIOT" },
  { label: "SPY", sym: "AMEX:SPY" },
  { label: "QQQ", sym: "NASDAQ:QQQ" },
  { label: "NVDA", sym: "NASDAQ:NVDA" },
  { label: "TSLA", sym: "NASDAQ:TSLA" },
]

const GRID_LAYOUTS = [
  { id: "1", label: "1", cols: 1, icon: "▣" },
  { id: "2", label: "2", cols: 2, icon: "◫" },
  { id: "3", label: "3", cols: 3, icon: "▦" },
  { id: "4", label: "4", cols: 4, icon: "⊞" },
]

// ─── MULTICHART COMPONENT ────────────────────────────────────────────────────
export default function MultiChart() {
  const [charts, setCharts] = useState(loadCharts)
  const [cols, setCols] = useState(() => {
    try { return parseInt(localStorage.getItem("optlab:multichart-cols")) || 2 } catch { return 2 }
  })
  const [nextId, setNextId] = useState(() => Math.max(0, ...charts.map(c => c.id)) + 1)
  const [editingId, setEditingId] = useState(null)
  const [editSymbol, setEditSymbol] = useState("")
  const [customAdd, setCustomAdd] = useState("")

  // Persist
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(charts))
      localStorage.setItem("optlab:multichart-cols", cols.toString())
    } catch {}
  }, [charts, cols])

  const addChart = useCallback((symbol = "COINBASE:BTCUSD") => {
    setCharts(prev => [...prev, { id: nextId, symbol }])
    setNextId(p => p + 1)
  }, [nextId])

  const handleCustomAdd = useCallback((e) => {
    if (e.key === "Enter" && customAdd.trim()) {
      const sym = customAdd.trim().toUpperCase()
      // Auto-prefix: if no colon, guess exchange
      let fullSym = sym
      if (!sym.includes(":")) {
        if (sym.endsWith("USD") || sym.endsWith("USDT")) fullSym = `COINBASE:${sym}`
        else fullSym = `NASDAQ:${sym}` // assume equity
      }
      addChart(fullSym)
      setCustomAdd("")
    }
  }, [customAdd, addChart])

  const removeChart = useCallback((id) => {
    setCharts(prev => prev.filter(c => c.id !== id))
  }, [])

  const updateSymbol = useCallback((id, symbol) => {
    setCharts(prev => prev.map(c => c.id === id ? { ...c, symbol } : c))
    setEditingId(null)
    setEditSymbol("")
  }, [])

  const startEdit = useCallback((chart) => {
    setEditingId(chart.id)
    setEditSymbol(chart.symbol)
  }, [])

  const handleEditKeyDown = useCallback((e, id) => {
    if (e.key === "Enter" && editSymbol.trim()) {
      const sym = editSymbol.trim().toUpperCase()
      updateSymbol(id, sym.includes(":") ? sym : sym)
    }
    if (e.key === "Escape") {
      setEditingId(null)
      setEditSymbol("")
    }
  }, [editSymbol, updateSymbol])

  const slotsRemaining = 16 - charts.length

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "#0a0c10", overflow: "hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap');
        .mc-btn { padding: 4px 10px; font-size: 10px; font-family: 'JetBrains Mono', monospace; cursor: pointer; border-radius: 4px; border: 1px solid #1e2330; background: #12151c; color: #6a7080; transition: all 0.15s; }
        .mc-btn:hover { border-color: #3b82f6; color: #c8ccd4; }
        .mc-btn-active { background: #3b82f620; border-color: #3b82f640; color: #3b82f6; }
        .mc-input { background: #0a0c10; border: 1px solid #1e2330; color: #e0e4ec; padding: 4px 8px; border-radius: 4px; font-family: 'JetBrains Mono', monospace; font-size: 10px; outline: none; width: 100%; }
        .mc-input:focus { border-color: #3b82f6; }
      `}</style>

      {/* ─── TOOLBAR ─── */}
      <div style={{
        padding: "6px 12px", display: "flex", alignItems: "center", gap: 10,
        borderBottom: "1px solid #1a1d28", background: "#0d0f15", minHeight: 36,
      }}>
        {/* Grid layout selector */}
        <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
          <span style={{ fontSize: 9, color: "#4a5060", marginRight: 4 }}>Columns:</span>
          {GRID_LAYOUTS.map(g => (
            <button key={g.id} className={`mc-btn ${cols === g.cols ? "mc-btn-active" : ""}`}
              onClick={() => setCols(g.cols)} style={{ padding: "3px 8px", fontSize: 11 }}>
              {g.label}
            </button>
          ))}
        </div>

        <div style={{ width: 1, height: 16, background: "#1e2330" }} />

        {/* Quick add buttons */}
        <div style={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "nowrap", overflow: "auto" }}>
          {QUICK_SYMBOLS.map(qs => (
            <button key={qs.sym} className="mc-btn" onClick={() => addChart(qs.sym)}
              style={{ padding: "2px 8px", fontSize: 9, whiteSpace: "nowrap" }}>
              {qs.label}
            </button>
          ))}
        </div>

        <div style={{ width: 1, height: 16, background: "#1e2330" }} />

        {/* Custom symbol input */}
        <input className="mc-input" type="text" placeholder="Add: AAPL, COINBASE:BTCUSD, etc."
          value={customAdd} onChange={e => setCustomAdd(e.target.value)}
          onKeyDown={handleCustomAdd}
          style={{ width: 220, flexShrink: 0 }} />

        <div style={{ flex: 1 }} />

        {/* Slot counter */}
        <span style={{ fontSize: 9, color: "#3a4050", whiteSpace: "nowrap" }}>
          {slotsRemaining} of 16 slots remaining
        </span>
      </div>

      {/* ─── CHART GRID ─── */}
      <div style={{
        flex: 1, display: "grid",
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gridAutoRows: "1fr",
        gap: 1, background: "#1a1d28", overflow: "hidden",
      }}>
        {charts.map(chart => (
          <div key={chart.id} style={{ position: "relative", background: "#0a0c10", overflow: "hidden", minHeight: 0 }}>
            {/* Chart overlay header */}
            <div style={{
              position: "absolute", top: 0, left: 0, right: 0, zIndex: 10,
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "3px 6px", background: "linear-gradient(180deg, rgba(10,12,16,0.9) 0%, transparent 100%)",
              pointerEvents: "none",
            }}>
              <div style={{ pointerEvents: "auto", display: "flex", alignItems: "center", gap: 4 }}>
                {editingId === chart.id ? (
                  <input className="mc-input" autoFocus value={editSymbol}
                    onChange={e => setEditSymbol(e.target.value)}
                    onKeyDown={e => handleEditKeyDown(e, chart.id)}
                    onBlur={() => { setEditingId(null); setEditSymbol("") }}
                    style={{ width: 160, fontSize: 10 }}
                    placeholder="COINBASE:BTCUSD or NASDAQ:MSTR" />
                ) : (
                  <button onClick={() => startEdit(chart)}
                    style={{ padding: "1px 6px", fontSize: 9, fontFamily: "'JetBrains Mono', monospace",
                      background: "#12151c80", border: "1px solid #1e233060", borderRadius: 3,
                      color: "#6a7080", cursor: "pointer" }}
                    title="Click to change symbol">
                    ✏️ {chart.symbol.split(":").pop()}
                  </button>
                )}
              </div>
              <div style={{ pointerEvents: "auto", display: "flex", gap: 2 }}>
                <button onClick={() => removeChart(chart.id)}
                  style={{ padding: "1px 5px", fontSize: 10, background: "#ef444420", border: "1px solid #ef444430",
                    borderRadius: 3, color: "#ef4444", cursor: "pointer", lineHeight: 1 }}
                  title="Remove chart">×</button>
              </div>
            </div>

            <TVChart symbol={chart.symbol} />
          </div>
        ))}

        {/* Add Chart Slot */}
        {charts.length < 16 && (
          <div style={{
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            background: "#0a0c10", border: "2px dashed #1e2330", borderRadius: 0,
            cursor: "pointer", minHeight: 200,
          }}
            onClick={() => addChart("COINBASE:BTCUSD")}
          >
            <div style={{ fontSize: 32, color: "#1e2330", marginBottom: 8 }}>＋</div>
            <div style={{ fontSize: 11, color: "#3a4050", fontFamily: "'JetBrains Mono', monospace" }}>Add Chart</div>
            <div style={{ fontSize: 9, color: "#2a3040", marginTop: 4 }}>{slotsRemaining} of 16 slots remaining</div>
          </div>
        )}
      </div>
    </div>
  )
}
