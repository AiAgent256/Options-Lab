import React, { useState, useEffect, useRef, memo, useCallback } from "react"

// ─── TRADINGVIEW CHART (CORRECT EMBED FORMAT) ──────────────────────────────
const TVChart = memo(function TVChart({ symbol, interval = "60" }) {
  const ref = useRef(null)

  useEffect(() => {
    if (!ref.current) return
    ref.current.innerHTML = ""

    // TradingView embed format: config JSON goes as textContent of the script tag
    const container = document.createElement("div")
    container.className = "tradingview-widget-container"
    container.style.height = "100%"
    container.style.width = "100%"

    const widgetDiv = document.createElement("div")
    widgetDiv.className = "tradingview-widget-container__widget"
    widgetDiv.style.height = "100%"
    widgetDiv.style.width = "100%"
    container.appendChild(widgetDiv)

    // Config MUST be textContent of the same script tag that loads the embed JS
    const script = document.createElement("script")
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js"
    script.type = "text/javascript"
    script.async = true
    script.textContent = JSON.stringify({
      symbol,
      autosize: true,
      theme: "dark",
      style: "1",
      timezone: "Etc/UTC",
      interval,
      range: "3M",
      allow_symbol_change: true,
      save_image: false,
      hide_volume: false,
      support_host: "https://www.tradingview.com",
      hide_top_toolbar: false,
      hide_side_toolbar: true,
      hide_legend: false,
      withdateranges: false,
      details: false,
      hotlist: false,
      calendar: false,
      show_popup_button: true,
      popup_width: "1000",
      popup_height: "650",
      backgroundColor: "rgba(8, 10, 15, 1)",
      gridColor: "rgba(30, 35, 50, 0.4)",
    })
    container.appendChild(script)

    ref.current.appendChild(container)
    return () => { if (ref.current) ref.current.innerHTML = "" }
  }, [symbol, interval])

  return <div ref={ref} style={{ height: "100%", width: "100%", overflow: "hidden" }} />
})

// ─── STORAGE ─────────────────────────────────────────────────────────────────
const STORAGE_KEY = "optlab:multicharts"
const DEFAULT_CHARTS = [
  { id: 1, symbol: "COINBASE:BTCUSD" },
  { id: 2, symbol: "COINBASE:ETHUSD" },
  { id: 3, symbol: "NASDAQ:MSTR" },
  { id: 4, symbol: "NASDAQ:AAOI" },
]

function loadCharts() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved ? JSON.parse(saved) : DEFAULT_CHARTS
  } catch { return DEFAULT_CHARTS }
}

// ─── PRESETS ─────────────────────────────────────────────────────────────────
const QUICK_SYMBOLS = [
  { label: "BTC", sym: "COINBASE:BTCUSD", cat: "crypto" },
  { label: "ETH", sym: "COINBASE:ETHUSD", cat: "crypto" },
  { label: "SOL", sym: "COINBASE:SOLUSD", cat: "crypto" },
  { label: "HYPE", sym: "COINBASE:HYPEUSD", cat: "crypto" },
  { label: "ZRO", sym: "COINBASE:ZROUSD", cat: "crypto" },
  { label: "MSTR", sym: "NASDAQ:MSTR", cat: "equity" },
  { label: "SMR", sym: "NYSE:SMR", cat: "equity" },
  { label: "AAOI", sym: "NASDAQ:AAOI", cat: "equity" },
  { label: "COIN", sym: "NASDAQ:COIN", cat: "equity" },
  { label: "MARA", sym: "NASDAQ:MARA", cat: "equity" },
  { label: "RIOT", sym: "NASDAQ:RIOT", cat: "equity" },
  { label: "SPY", sym: "AMEX:SPY", cat: "index" },
  { label: "QQQ", sym: "NASDAQ:QQQ", cat: "index" },
  { label: "NVDA", sym: "NASDAQ:NVDA", cat: "equity" },
  { label: "TSLA", sym: "NASDAQ:TSLA", cat: "equity" },
]

// ─── MULTICHART COMPONENT ───────────────────────────────────────────────────
export default function MultiChart() {
  const [charts, setCharts] = useState(loadCharts)
  const [cols, setCols] = useState(() => {
    try { return parseInt(localStorage.getItem("optlab:multichart-cols")) || 2 } catch { return 2 }
  })
  const [nextId, setNextId] = useState(() => Math.max(0, ...charts.map(c => c.id)) + 1)
  const [editingId, setEditingId] = useState(null)
  const [editSymbol, setEditSymbol] = useState("")
  const [customAdd, setCustomAdd] = useState("")

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
      let fullSym = sym
      if (!sym.includes(":")) {
        if (sym.endsWith("USD") || sym.endsWith("USDT")) fullSym = `COINBASE:${sym}`
        else fullSym = `NASDAQ:${sym}`
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
    if (e.key === "Escape") { setEditingId(null); setEditSymbol("") }
  }, [editSymbol, updateSymbol])

  const catColor = (cat) => {
    if (cat === "crypto") return "#f7931a"
    if (cat === "index") return "#22c55e"
    return "#3b82f6"
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "#080a0f", overflow: "hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600&family=DM+Sans:wght@400;500;600;700&display=swap');
        .mc-chip {
          padding: 4px 10px; font-size: 10px; font-family: 'JetBrains Mono', monospace;
          cursor: pointer; border-radius: 3px; border: 1px solid rgba(255,255,255,0.06);
          background: rgba(255,255,255,0.02); color: #5a6070; transition: all 0.15s;
          letter-spacing: 0.03em; font-weight: 500; white-space: nowrap;
        }
        .mc-chip:hover { border-color: rgba(255,255,255,0.12); color: #b0b8c8; background: rgba(255,255,255,0.04); }
        .mc-chip-active { background: rgba(59,130,246,0.08); border-color: rgba(59,130,246,0.25); color: #3b82f6; }
        .mc-sym-chip:hover { border-color: rgba(247,147,26,0.3); color: #e0e4ec; }
        .mc-input {
          background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06);
          color: #c8ccd8; padding: 5px 10px; border-radius: 3px;
          font-family: 'JetBrains Mono', monospace; font-size: 10px; outline: none;
          letter-spacing: 0.03em;
        }
        .mc-input:focus { border-color: rgba(59,130,246,0.4); background: rgba(59,130,246,0.03); }
        .mc-input::placeholder { color: #2a3040; }
        .mc-close-btn {
          width: 18px; height: 18px; display: flex; align-items: center; justify-content: center;
          font-size: 11px; background: rgba(239,68,68,0.06); border: 1px solid rgba(239,68,68,0.15);
          border-radius: 2px; color: rgba(239,68,68,0.5); cursor: pointer; line-height: 1;
          transition: all 0.15s;
        }
        .mc-close-btn:hover { background: rgba(239,68,68,0.15); color: #ef4444; border-color: rgba(239,68,68,0.3); }
        .mc-edit-btn {
          padding: 2px 8px; font-size: 9px; font-family: 'JetBrains Mono', monospace;
          background: rgba(0,0,0,0.6); border: 1px solid rgba(255,255,255,0.06);
          border-radius: 2px; color: #5a6070; cursor: pointer; backdrop-filter: blur(8px);
          transition: all 0.15s; letter-spacing: 0.03em;
        }
        .mc-edit-btn:hover { border-color: rgba(255,255,255,0.15); color: #b0b8c8; }
        .mc-add-slot {
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          background: rgba(255,255,255,0.01); cursor: pointer; min-height: 200;
          transition: all 0.2s; border: 1px solid rgba(255,255,255,0.03);
        }
        .mc-add-slot:hover { background: rgba(59,130,246,0.03); border-color: rgba(59,130,246,0.1); }
      `}</style>

      {/* ─── TOOLBAR ─── */}
      <div style={{
        padding: "7px 14px", display: "flex", alignItems: "center", gap: 8,
        borderBottom: "1px solid rgba(255,255,255,0.04)", background: "#0b0d13",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
          <span style={{ fontSize: 9, color: "#2a3040", marginRight: 2, fontFamily: "'DM Sans', sans-serif", fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase" }}>Grid</span>
          {[1, 2, 3, 4].map(n => (
            <button key={n} className={`mc-chip ${cols === n ? "mc-chip-active" : ""}`}
              onClick={() => setCols(n)} style={{ padding: "3px 9px", fontSize: 10, fontWeight: 600 }}>
              {n}
            </button>
          ))}
        </div>

        <div style={{ width: 1, height: 18, background: "rgba(255,255,255,0.04)", flexShrink: 0 }} />

        <div style={{ display: "flex", alignItems: "center", gap: 3, overflow: "auto", flex: 1 }}>
          {QUICK_SYMBOLS.map(qs => (
            <button key={qs.sym} className="mc-chip mc-sym-chip" onClick={() => addChart(qs.sym)}
              style={{
                padding: "3px 9px", fontSize: 9,
                borderColor: catColor(qs.cat) + "15",
                color: catColor(qs.cat) + "90",
              }}>
              {qs.label}
            </button>
          ))}
        </div>

        <div style={{ width: 1, height: 18, background: "rgba(255,255,255,0.04)", flexShrink: 0 }} />

        <input className="mc-input" type="text" placeholder="AAPL, COINBASE:BTCUSD…"
          value={customAdd} onChange={e => setCustomAdd(e.target.value)}
          onKeyDown={handleCustomAdd}
          style={{ width: 190, flexShrink: 0 }} />

        <span style={{ fontSize: 9, color: "#1e2535", fontFamily: "'JetBrains Mono', monospace", whiteSpace: "nowrap" }}>
          {16 - charts.length} slots
        </span>
      </div>

      {/* ─── CHART GRID ─── */}
      <div style={{
        flex: 1, display: "grid",
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gridAutoRows: "1fr",
        gap: "1px", background: "rgba(255,255,255,0.03)", overflow: "hidden",
      }}>
        {charts.map(chart => (
          <div key={chart.id} style={{ position: "relative", background: "#080a0f", overflow: "hidden", minHeight: 0 }}>
            <div style={{
              position: "absolute", top: 4, right: 4, zIndex: 10,
              display: "flex", alignItems: "center", gap: 3,
            }}>
              {editingId === chart.id ? (
                <input className="mc-input" autoFocus value={editSymbol}
                  onChange={e => setEditSymbol(e.target.value)}
                  onKeyDown={e => handleEditKeyDown(e, chart.id)}
                  onBlur={() => { setEditingId(null); setEditSymbol("") }}
                  style={{ width: 170, fontSize: 10 }}
                  placeholder="COINBASE:BTCUSD" />
              ) : (
                <button className="mc-edit-btn" onClick={() => startEdit(chart)}>
                  {chart.symbol.split(":").pop()}
                </button>
              )}
              <button className="mc-close-btn" onClick={() => removeChart(chart.id)} title="Remove">×</button>
            </div>
            <TVChart symbol={chart.symbol} />
          </div>
        ))}

        {charts.length < 16 && (
          <div className="mc-add-slot" onClick={() => addChart("COINBASE:BTCUSD")}>
            <div style={{ fontSize: 28, color: "rgba(255,255,255,0.06)", marginBottom: 4, fontWeight: 300 }}>+</div>
            <div style={{ fontSize: 10, color: "#1e2535", fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.05em" }}>Add Chart</div>
          </div>
        )}
      </div>
    </div>
  )
}
