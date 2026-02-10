import React, { useState, useEffect, useMemo, useCallback, useRef, memo } from "react"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart, ReferenceLine, Legend, ComposedChart, PieChart, Pie, Cell } from "recharts"
import { fetchTickers, fetchAllKlines, normalizeSymbol, isCryptoSymbol, isTrackedSymbol } from "../hooks/useMarketData"

// ─── CONSTANTS ───────────────────────────────────────────────────────────────
const COLORS = ["#3b82f6", "#8b5cf6", "#22c55e", "#f59e0b", "#ef4444", "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#a855f7", "#14b8a6", "#e11d48"]
const STORAGE_KEY = "optlab:portfolio"

const ASSET_TYPES = [
  { value: "crypto_spot", label: "Crypto (Spot)" },
  { value: "crypto_perp", label: "Crypto (Perp/Futures)" },
  { value: "equity", label: "Equity" },
  { value: "option_long", label: "Option (Long)" },
  { value: "option_short", label: "Option (Short)" },
  { value: "other", label: "Other" },
]

// TradingView symbol mappings for equities
const EQUITY_TV_MAP = {
  MSTR: "NASDAQ:MSTR", COIN: "NASDAQ:COIN", MARA: "NASDAQ:MARA", RIOT: "NASDAQ:RIOT",
  CLSK: "NASDAQ:CLSK", HUT: "NASDAQ:HUT", BITF: "NASDAQ:BITF", SPY: "AMEX:SPY",
  QQQ: "NASDAQ:QQQ", AAPL: "NASDAQ:AAPL", TSLA: "NASDAQ:TSLA", NVDA: "NASDAQ:NVDA",
  AAOI: "NASDAQ:AAOI", COHR: "NASDAQ:COHR", SMR: "NYSE:SMR",
}

const DEFAULT_HOLDINGS = []

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const fmtDollar = (v) => {
  if (v == null || !isFinite(v)) return "—"
  if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(2)}M`
  if (Math.abs(v) >= 1e4) return `$${(v / 1e3).toFixed(1)}K`
  return `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
const fmtPct = (v) => v == null || !isFinite(v) ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(2)}%`
const fmtPnl = (v) => v == null || !isFinite(v) ? "—" : `${v >= 0 ? "+" : ""}${fmtDollar(v).replace("$", "$")}`

// ─── TRADINGVIEW MINI CHART WIDGET ───────────────────────────────────────────
const TvMiniChart = memo(({ symbol, width = "100%", height = 160 }) => {
  const ref = useRef(null)
  useEffect(() => {
    if (!ref.current) return
    ref.current.innerHTML = ""
    const container = document.createElement("div")
    container.className = "tradingview-widget-container__widget"
    container.style.height = "100%"
    ref.current.appendChild(container)
    const script = document.createElement("script")
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-mini-symbol-overview.js"
    script.async = true
    script.innerHTML = JSON.stringify({
      symbol, width: "100%", height, locale: "en", dateRange: "12M",
      colorTheme: "dark", isTransparent: true, autosize: false,
      largeChartUrl: "", noTimeScale: false, chartOnly: false,
      trendLineColor: "rgba(59, 130, 246, 0.6)", underLineColor: "rgba(59, 130, 246, 0.1)",
      underLineBottomColor: "rgba(59, 130, 246, 0)", backgroundColor: "rgba(0,0,0,0)",
    })
    ref.current.appendChild(script)
    return () => { if (ref.current) ref.current.innerHTML = "" }
  }, [symbol, height])
  return <div ref={ref} style={{ width, height, overflow: "hidden" }} />
})

// ─── CLOSE POSITION FORM ──────────────────────────────────────────────────
function ClosePositionForm({ holding, onClose, onCancel }) {
  const [exitPrice, setExitPrice] = useState(holding.currentPrice || "")
  const [exitDate, setExitDate] = useState(new Date().toISOString().split("T")[0])

  const previewPnl = (() => {
    const ep = parseFloat(exitPrice) || 0
    if (ep <= 0) return null
    if (holding.isLeveraged) {
      return (ep - holding.costBasis) * holding.quantity * (holding.direction || 1)
    } else {
      return (ep - holding.costBasis) * holding.quantity
    }
  })()

  return (
    <div style={{ margin: "0 0 10px", padding: "10px 12px", background: "#0a0c10", borderRadius: 6, borderLeft: "3px solid #f59e0b" }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: "#f59e0b", marginBottom: 8, textTransform: "uppercase", letterSpacing: "1px" }}>Close Position</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div>
          <div style={{ fontSize: 8, color: "#4a5060", marginBottom: 2 }}>Exit Price</div>
          <input className="pf-input" type="number" step="any" value={exitPrice}
            onChange={e => setExitPrice(e.target.value)} style={{ fontSize: 11, padding: "4px 6px" }}
            placeholder={`Current: ${holding.currentPrice?.toFixed(2) || "?"}`} />
        </div>
        <div>
          <div style={{ fontSize: 8, color: "#4a5060", marginBottom: 2 }}>Exit Date</div>
          <input className="pf-input" type="date" value={exitDate}
            onChange={e => setExitDate(e.target.value)} style={{ fontSize: 11, padding: "4px 6px" }} />
        </div>
      </div>
      {previewPnl !== null && (
        <div style={{ marginTop: 6, fontSize: 10, color: "#5a6070" }}>
          Realized P&L: <span style={{ fontWeight: 600, color: previewPnl >= 0 ? "#22c55e" : "#ef4444" }}>
            {previewPnl >= 0 ? "+" : ""}{previewPnl.toLocaleString("en-US", { style: "currency", currency: "USD" })}
          </span>
          {holding.margin > 0 && <span> ({((previewPnl / holding.margin) * 100).toFixed(1)}%)</span>}
        </div>
      )}
      <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
        <button className="pf-btn" style={{ padding: "4px 12px", fontSize: 10, background: "#f59e0b20", borderColor: "#f59e0b40", color: "#f59e0b" }}
          onClick={() => onClose(holding.id, exitPrice, exitDate)}>
          Confirm Close
        </button>
        <button className="pf-btn" style={{ padding: "4px 12px", fontSize: 10 }} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

// ─── PORTFOLIO COMPONENT ─────────────────────────────────────────────────────
export default function Portfolio({ onNavigateToChart }) {
  const [holdings, setHoldings] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      return saved ? JSON.parse(saved) : DEFAULT_HOLDINGS
    } catch { return DEFAULT_HOLDINGS }
  })
  const [nextId, setNextId] = useState(() => Math.max(0, ...holdings.map(h => h.id)) + 1)
  const [editingId, setEditingId] = useState(null)
  const [liveData, setLiveData] = useState({}) // { BTCUSDT: { price, change, ... } }
  const [historicalData, setHistoricalData] = useState({}) // { BTCUSDT: [{ date, close }] }
  const [historyLoading, setHistoryLoading] = useState(false)
  const [viewMode, setViewMode] = useState("cards") // "cards" | "table"
  const [chartRange, setChartRange] = useState("ALL")
  const [customFrom, setCustomFrom] = useState("")
  const [customTo, setCustomTo] = useState(new Date().toISOString().split("T")[0])
  const [showAddForm, setShowAddForm] = useState(false)
  const [closingId, setClosingId] = useState(null) // ID of position being closed

  // New holding form state
  const [newHolding, setNewHolding] = useState({
    symbol: "", name: "", type: "crypto_spot", quantity: 0, costBasis: 0,
    leverage: 1, margin: 0, direction: 1, tradeDate: new Date().toISOString().split("T")[0], notes: "",
    status: "open", exitPrice: 0, exitDate: "",
  })

  // Persist holdings
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(holdings)) } catch {}
  }, [holdings])

  // ─── RESOLVE TRACKED HOLDINGS (crypto + equity) ────────────────────────
  const trackedHoldings = useMemo(() => {
    return holdings.filter(h => isTrackedSymbol(h.symbol, h.type))
  }, [holdings])

  // Earliest trade date per normalized key
  const earliestDates = useMemo(() => {
    const map = {}
    trackedHoldings.forEach(h => {
      const key = normalizeSymbol(h.symbol)
      const t = new Date(h.tradeDate).getTime()
      if (!map[key] || t < map[key]) map[key] = t
    })
    return map
  }, [trackedHoldings])

  // ─── POLL LIVE PRICES (Coinbase / Phemex / Yahoo Finance) ────────────
  useEffect(() => {
    if (trackedHoldings.length === 0) return
    let active = true
    const poll = async () => {
      const tickers = await fetchTickers(trackedHoldings)
      if (active) setLiveData(tickers)
    }
    poll()
    const interval = setInterval(poll, 8000)
    return () => { active = false; clearInterval(interval) }
  }, [trackedHoldings])

  // ─── FETCH HISTORICAL KLINES ────────────────────────────────────────────
  useEffect(() => {
    if (trackedHoldings.length === 0) return
    let active = true
    setHistoryLoading(true)

    // Always fetch from earliest trade date
    const allTradeDates = Object.values(earliestDates)
    const rangeStart = allTradeDates.length > 0 ? Math.min(...allTradeDates) : Date.now() - 30 * 86400000

    const seen = new Set()
    const requests = []
    trackedHoldings.forEach(h => {
      const key = normalizeSymbol(h.symbol)
      if (seen.has(key)) return
      seen.add(key)
      const tradeStart = earliestDates[key] || rangeStart
      requests.push({ symbol: h.symbol, type: h.type, startTime: Math.min(tradeStart, rangeStart) })
    })

    console.log(`[Portfolio] kline requests:`, requests.map(r => `${r.symbol}(${r.type})`))
    console.log(`[Portfolio] trackedHoldings:`, trackedHoldings.map(h => `${h.symbol}(${h.type})`))

    fetchAllKlines(requests).then(data => {
      if (active) { setHistoricalData(data); setHistoryLoading(false) }
    })
    return () => { active = false }
  }, [trackedHoldings])

  // ─── ENRICH HOLDINGS WITH LIVE DATA ─────────────────────────────────────
  const enrichedHoldings = useMemo(() => {
    return holdings.map((h, i) => {
      const tracked = isTrackedSymbol(h.symbol, h.type)
      const assetKey = tracked ? normalizeSymbol(h.symbol) : null
      const live = assetKey ? liveData[assetKey] : null
      const isClosed = h.status === "closed"

      // For closed positions, use the exit price; for open, use live price
      const currentPrice = isClosed
        ? (h.exitPrice || h.costBasis)
        : (live ? live.price : (h.currentPrice || h.costBasis))
      const change24h = isClosed ? 0 : (live ? live.change : 0)

      const isLeveraged = (h.type === "crypto_perp" || h.type === "option_long" || h.type === "option_short") && (h.leverage || 1) > 1
      const direction = h.type === "option_short" ? -1 : 1 // short = inverse P&L

      // ── POSITION MATH ──
      // Notional = full position size at market
      const notional = h.quantity * currentPrice
      const entryNotional = h.quantity * h.costBasis

      let margin, equity, pnl, pnlPct, portfolioValue

      if (isLeveraged) {
        // Leveraged position: user puts up margin, P&L is amplified
        // margin = what you actually deposited (user can override, else calculated)
        margin = h.margin > 0 ? h.margin : (entryNotional / (h.leverage || 1))
        // unrealized P&L on the full notional
        pnl = (currentPrice - h.costBasis) * h.quantity * direction
        // equity = your actual money right now
        equity = margin + pnl
        // P&L% relative to your margin (real money at risk)
        pnlPct = margin > 0 ? pnl / margin : 0
        // Portfolio contribution: closed = 0 (realized, no longer active)
        portfolioValue = isClosed ? 0 : equity
      } else {
        // Spot / equity: straightforward
        margin = h.quantity * h.costBasis // "margin" = total cost for spot
        equity = h.quantity * currentPrice
        pnl = equity - margin
        pnlPct = margin > 0 ? pnl / margin : 0
        // Portfolio contribution: closed = 0 (realized, no longer active)
        portfolioValue = isClosed ? 0 : equity
      }

      // Days held — for closed positions, count entry to exit
      const tradeDate = new Date(h.tradeDate)
      const endDate = isClosed && h.exitDate ? new Date(h.exitDate) : new Date()
      const daysHeld = Math.max(0, Math.round((endDate.getTime() - tradeDate.getTime()) / 86400000))

      // TradingView symbol — match the exchange we're actually getting data from
      let tvSymbol
      if (h.type === "equity") {
        tvSymbol = EQUITY_TV_MAP[h.symbol.toUpperCase()] || h.symbol.toUpperCase()
      } else if (h.type === "crypto_perp") {
        tvSymbol = `PHEMEX:${assetKey}USDT`
      } else if (assetKey) {
        tvSymbol = `COINBASE:${assetKey}USD`
      } else {
        tvSymbol = EQUITY_TV_MAP[h.symbol.toUpperCase()] || h.symbol
      }

      return {
        ...h, currentPrice, change24h, cryptoKey: assetKey, tvSymbol, daysHeld, direction,
        isLeveraged, isClosed, margin, notional, entryNotional, equity, pnl, pnlPct, portfolioValue,
        color: COLORS[i % COLORS.length],
      }
    })
  }, [holdings, liveData])

  // ─── PORTFOLIO AGGREGATES ───────────────────────────────────────────────
  const portfolio = useMemo(() => {
    const openHoldings = enrichedHoldings.filter(h => !h.isClosed)
    const closedHoldings = enrichedHoldings.filter(h => h.isClosed)

    const totalMargin = openHoldings.reduce((s, h) => s + h.margin, 0)
    const totalEquity = openHoldings.reduce((s, h) => s + h.portfolioValue, 0)
    const unrealizedPnl = openHoldings.reduce((s, h) => s + h.pnl, 0)
    const realizedPnl = closedHoldings.reduce((s, h) => s + h.pnl, 0)
    const totalPnl = unrealizedPnl + realizedPnl
    const totalCost = totalMargin + closedHoldings.reduce((s, h) => s + h.margin, 0)
    const totalPnlPct = totalCost > 0 ? totalPnl / totalCost : 0
    const totalNotional = openHoldings.reduce((s, h) => s + h.notional, 0)

    // Allocation based on portfolio value (equity), not notional — open positions only
    const allocation = openHoldings.map(h => ({
      name: h.symbol, value: Math.max(0, h.portfolioValue), color: h.color,
      pct: totalEquity > 0 ? Math.max(0, h.portfolioValue) / totalEquity : 0,
    }))

    // Best / worst performers by P&L% — all positions
    const sorted = [...enrichedHoldings].sort((a, b) => b.pnlPct - a.pnlPct)
    const best = sorted[0]
    const worst = sorted[sorted.length - 1]

    return { totalMargin, totalEquity, unrealizedPnl, realizedPnl, totalPnl, totalPnlPct, totalNotional, allocation, best, worst, openCount: openHoldings.length, closedCount: closedHoldings.length }
  }, [enrichedHoldings])

  // ─── HISTORICAL PORTFOLIO VALUE CHART ───────────────────────────────────
  const portfolioChart = useMemo(() => {
    const hdKeys = Object.keys(historicalData)
    const hdCounts = Object.fromEntries(hdKeys.map(k => [k, historicalData[k].length]))
    console.log(`[Chart] historicalData keys:`, hdKeys, `counts:`, hdCounts)
    console.log(`[Chart] enriched cryptoKeys:`, enrichedHoldings.map(h => `${h.symbol}→${h.cryptoKey}`))

    if (hdKeys.length === 0) return []

    // Build unified date axis
    const allDates = new Set()
    Object.values(historicalData).forEach(klines => klines.forEach(k => allDates.add(k.date)))
    let sortedDates = [...allDates].sort()
    console.log(`[Chart] raw dates: ${sortedDates.length} (${sortedDates[0]} → ${sortedDates[sortedDates.length - 1]})`)

    // Filter dates by range
    if (chartRange === "CUSTOM" && customFrom) {
      const fromKey = customFrom + "T00"
      const toKey = (customTo || new Date().toISOString().split("T")[0]) + "T23"
      sortedDates = sortedDates.filter(d => d >= fromKey && d <= toKey)
    } else if (chartRange !== "ALL") {
      const rangeDays = { "1D": 1, "1W": 7, "1M": 30, "3M": 90, "6M": 180, "1Y": 365 }[chartRange] || 180
      const cutoff = new Date(Date.now() - rangeDays * 86400000).toISOString().slice(0, 13)
      sortedDates = sortedDates.filter(d => d >= cutoff)
    }

    console.log(`[Chart] filtered dates (${chartRange}): ${sortedDates.length}`)

    const chartData = sortedDates.map(date => {
      let totalEquity = 0
      let totalMargin = 0
      let active = 0

      enrichedHoldings.forEach(h => {
        // String comparison works for YYYY-MM-DD format
        if (date < h.tradeDate) return

        // For closed positions, stop contributing after exit date
        if (h.isClosed && h.exitDate && date > h.exitDate + "T23") {
          return // no longer in portfolio — skip entirely
        }

        const klines = historicalData[h.cryptoKey]
        if (!klines || klines.length === 0) {
          // No kline data — use margin as flat value
          totalEquity += h.margin
          totalMargin += h.margin
          active++
          return
        }

        // Find closest kline ≤ date (reverse scan)
        let kline = null
        for (let i = klines.length - 1; i >= 0; i--) {
          if (klines[i].date <= date) { kline = klines[i]; break }
        }
        if (!kline) kline = klines[0] // fallback to first

        if (kline) {
          if (h.isLeveraged) {
            const uPnl = (kline.close - h.costBasis) * h.quantity * (h.direction || 1)
            totalEquity += h.margin + uPnl
          } else {
            totalEquity += kline.close * h.quantity
          }
          totalMargin += h.margin
          active++
        }
      })

      return { date, totalEquity, totalMargin, pnl: totalEquity - totalMargin, active }
    }).filter(d => d.active > 0)

    console.log(`[Chart] final points: ${chartData.length}`, chartData.slice(0, 3))
    return chartData
  }, [historicalData, enrichedHoldings, chartRange, customFrom, customTo])

  // ─── INDIVIDUAL HOLDING CHART DATA ──────────────────────────────────────
  const holdingChartData = useCallback((holding) => {
    const klines = historicalData[holding.cryptoKey]
    if (!klines || klines.length === 0) return []
    const exitKey = holding.isClosed && holding.exitDate ? holding.exitDate + "T23" : null
    return klines
      .filter(k => k.date >= holding.tradeDate && (!exitKey || k.date <= exitKey))
      .map(k => {
        let equity, pnl
        if (holding.isLeveraged) {
          pnl = (k.close - holding.costBasis) * holding.quantity * holding.direction
          equity = holding.margin + pnl
        } else {
          equity = k.close * holding.quantity
          pnl = equity - holding.margin
        }
        return {
          date: k.date,
          price: k.close,
          equity,
          pnl,
          pnlPct: holding.margin > 0 ? pnl / holding.margin : 0,
        }
      })
  }, [historicalData])

  // ─── CRUD ───────────────────────────────────────────────────────────────
  const addHolding = () => {
    if (!newHolding.symbol.trim()) return
    const h = { ...newHolding, id: nextId, currentPrice: 0, symbol: newHolding.symbol.toUpperCase() }
    // Default status for new holdings
    if (!h.status) h.status = "open"
    setHoldings(prev => [...prev, h])
    setNextId(p => p + 1)
    setNewHolding({ symbol: "", name: "", type: "crypto_spot", quantity: 0, costBasis: 0, leverage: 1, margin: 0, direction: 1, tradeDate: new Date().toISOString().split("T")[0], notes: "", status: "open", exitPrice: 0, exitDate: "" })
    setShowAddForm(false)
  }

  const removeHolding = (id) => setHoldings(prev => prev.filter(h => h.id !== id))

  const updateHolding = (id, field, value) => {
    setHoldings(prev => prev.map(h => h.id === id ? { ...h, [field]: value } : h))
  }

  const closeHolding = (id, exitPrice, exitDate) => {
    setHoldings(prev => prev.map(h =>
      h.id === id ? { ...h, status: "closed", exitPrice: parseFloat(exitPrice) || 0, exitDate: exitDate || new Date().toISOString().split("T")[0] } : h
    ))
    setClosingId(null)
  }

  const reopenHolding = (id) => {
    setHoldings(prev => prev.map(h =>
      h.id === id ? { ...h, status: "open", exitPrice: 0, exitDate: "" } : h
    ))
  }

  // ─── RENDER ─────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: "20px 28px", maxWidth: 1440, margin: "0 auto", fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap');
        .pf-card { background: #0f1118; border: 1px solid #1a1d28; border-radius: 10px; padding: 20px; }
        .pf-metric { background: #12151c; border: 1px solid #1a1d28; border-radius: 8px; padding: 12px 16px; }
        .pf-label { font-size: 10px; text-transform: uppercase; letter-spacing: 1.5px; color: #4a5060; margin-bottom: 4px; font-weight: 500; }
        .pf-value { font-size: 18px; font-weight: 600; color: #e0e4ec; }
        .pf-btn { padding: 6px 14px; font-size: 11px; font-family: 'JetBrains Mono', monospace; cursor: pointer; border-radius: 6px; border: 1px solid #1e2330; background: #12151c; color: #8890a0; transition: all 0.15s; }
        .pf-btn:hover { border-color: #3b82f6; color: #c8ccd4; }
        .pf-btn-primary { background: #3b82f6; border-color: #3b82f6; color: #fff; }
        .pf-btn-primary:hover { background: #2563eb; }
        .pf-btn-danger { border-color: #ef444440; color: #ef4444; }
        .pf-btn-danger:hover { background: #ef444415; }
        .pf-input { background: #12151c; border: 1px solid #1e2330; color: #e0e4ec; padding: 8px 12px; border-radius: 6px; font-family: 'JetBrains Mono', monospace; font-size: 12px; width: 100%; outline: none; }
        .pf-input:focus { border-color: #3b82f6; }
        .pf-input::placeholder { color: #3a4050; }
        .pf-table { width: 100%; border-collapse: collapse; font-size: 12px; }
        .pf-table th { text-align: right; padding: 8px 12px; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #4a5060; border-bottom: 1px solid #1a1d28; font-weight: 500; }
        .pf-table th:first-child { text-align: left; }
        .pf-table td { text-align: right; padding: 6px 12px; border-bottom: 1px solid #111320; }
        .pf-table td:first-child { text-align: left; }
        .pf-table tr:hover td { background: #12151c; }
      `}</style>

      {/* ─── PORTFOLIO HEADER ─── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "2px", color: "#4a5060", marginBottom: 4 }}>Portfolio Equity</div>
          <div style={{ fontSize: 32, fontWeight: 700, color: "#e0e4ec", fontFamily: "'Space Grotesk', sans-serif", letterSpacing: "-1px" }}>
            {fmtDollar(portfolio.totalEquity)}
          </div>
          <div style={{ display: "flex", gap: 16, marginTop: 4, fontSize: 12 }}>
            <span style={{ color: portfolio.totalPnl >= 0 ? "#22c55e" : "#ef4444", fontWeight: 600 }}>
              {fmtPnl(portfolio.totalPnl)}
            </span>
            <span style={{ color: portfolio.totalPnl >= 0 ? "#22c55e80" : "#ef444480" }}>
              {fmtPct(portfolio.totalPnlPct)}
            </span>
            <span style={{ color: "#3a4050" }}>·</span>
            <span style={{ color: "#4a5060" }}>Margin: {fmtDollar(portfolio.totalMargin)}</span>
            {portfolio.totalNotional !== portfolio.totalEquity && (
              <span style={{ color: "#3a4050" }}>Notional: {fmtDollar(portfolio.totalNotional)}</span>
            )}
            <span style={{ color: "#4a5060" }}>{portfolio.openCount} open{portfolio.closedCount > 0 ? ` · ${portfolio.closedCount} closed` : ""}</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ display: "flex", gap: 2 }}>
            {["cards", "table"].map(m => (
              <button key={m} className={`pf-btn ${viewMode === m ? "pf-btn-primary" : ""}`} onClick={() => setViewMode(m)}>
                {m === "cards" ? "Cards" : "Table"}
              </button>
            ))}
          </div>
          <button className="pf-btn" onClick={() => {
            const data = JSON.stringify(holdings, null, 2)
            const blob = new Blob([data], { type: "application/json" })
            const a = document.createElement("a")
            a.href = URL.createObjectURL(blob)
            a.download = `portfolio-${new Date().toISOString().split("T")[0]}.json`
            a.click()
          }}>↓ Export</button>
          <button className="pf-btn" onClick={() => {
            const input = document.createElement("input")
            input.type = "file"
            input.accept = ".json"
            input.onchange = (e) => {
              const file = e.target.files[0]
              if (!file) return
              const reader = new FileReader()
              reader.onload = (ev) => {
                try {
                  const imported = JSON.parse(ev.target.result)
                  if (Array.isArray(imported)) {
                    const maxId = Math.max(0, ...holdings.map(h => h.id), ...imported.map(h => h.id || 0))
                    const withIds = imported.map((h, i) => ({ ...h, id: h.id || maxId + i + 1, currentPrice: h.currentPrice || 0 }))
                    setHoldings(prev => [...prev, ...withIds])
                    setNextId(Math.max(0, ...holdings.map(h => h.id), ...withIds.map(h => h.id)) + 1)
                  }
                } catch { alert("Invalid portfolio JSON file") }
              }
              reader.readAsText(file)
            }
            input.click()
          }}>↑ Import</button>
          <button className="pf-btn pf-btn-primary" onClick={() => setShowAddForm(!showAddForm)}>
            {showAddForm ? "Cancel" : "+ Add Position"}
          </button>
        </div>
      </div>

      {/* ─── ADD FORM ─── */}
      {showAddForm && (
        <div className="pf-card" style={{ marginBottom: 16, borderTop: "2px solid #3b82f6" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
            <div>
              <div className="pf-label">Symbol</div>
              <input className="pf-input" type="text" placeholder="BTC, MSTR, CC, etc." value={newHolding.symbol}
                onChange={e => setNewHolding(p => ({ ...p, symbol: e.target.value }))} />
            </div>
            <div>
              <div className="pf-label">Name</div>
              <input className="pf-input" type="text" placeholder="Optional label" value={newHolding.name}
                onChange={e => setNewHolding(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div>
              <div className="pf-label">Type</div>
              <select className="pf-input" value={newHolding.type} onChange={e => setNewHolding(p => ({ ...p, type: e.target.value }))}>
                {ASSET_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            {(newHolding.type === "crypto_perp" || newHolding.type === "option_short") && (
              <div>
                <div className="pf-label">Direction</div>
                <select className="pf-input" value={newHolding.direction} onChange={e => setNewHolding(p => ({ ...p, direction: parseInt(e.target.value) }))}>
                  <option value={1}>Long</option>
                  <option value={-1}>Short</option>
                </select>
              </div>
            )}
            <div>
              <div className="pf-label">Quantity (tokens)</div>
              <input className="pf-input" type="number" step="any" value={newHolding.quantity || ""}
                onChange={e => setNewHolding(p => ({ ...p, quantity: parseFloat(e.target.value) || 0 }))} />
            </div>
            <div>
              <div className="pf-label">Entry Price (per unit)</div>
              <input className="pf-input" type="number" step="any" value={newHolding.costBasis || ""}
                onChange={e => setNewHolding(p => ({ ...p, costBasis: parseFloat(e.target.value) || 0 }))} />
            </div>
            {(newHolding.type === "crypto_perp") && (
              <>
                <div>
                  <div className="pf-label">Leverage</div>
                  <input className="pf-input" type="number" step="0.5" min="1" value={newHolding.leverage}
                    onChange={e => setNewHolding(p => ({ ...p, leverage: parseFloat(e.target.value) || 1 }))} />
                </div>
                <div>
                  <div className="pf-label">Margin (actual $ in)</div>
                  <input className="pf-input" type="number" step="any" placeholder="Auto from qty×entry÷leverage" value={newHolding.margin || ""}
                    onChange={e => setNewHolding(p => ({ ...p, margin: parseFloat(e.target.value) || 0 }))} />
                </div>
              </>
            )}
            <div>
              <div className="pf-label">Trade Date</div>
              <input className="pf-input" type="date" value={newHolding.tradeDate}
                onChange={e => setNewHolding(p => ({ ...p, tradeDate: e.target.value }))} />
            </div>
            <div>
              <div className="pf-label">Notes</div>
              <input className="pf-input" type="text" placeholder="Optional" value={newHolding.notes}
                onChange={e => setNewHolding(p => ({ ...p, notes: e.target.value }))} />
            </div>
          </div>
          {/* Already Closed toggle */}
          <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#8890a0", cursor: "pointer" }}>
              <input type="checkbox" checked={newHolding.status === "closed"}
                onChange={e => setNewHolding(p => ({ ...p, status: e.target.checked ? "closed" : "open" }))}
                style={{ accentColor: "#f59e0b" }} />
              Already Closed (historical trade)
            </label>
          </div>
          {newHolding.status === "closed" && (
            <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, padding: "10px 12px", background: "#0a0c10", borderRadius: 6, borderLeft: "3px solid #f59e0b" }}>
              <div>
                <div className="pf-label">Exit Price</div>
                <input className="pf-input" type="number" step="any" placeholder="Exit price per unit" value={newHolding.exitPrice || ""}
                  onChange={e => setNewHolding(p => ({ ...p, exitPrice: parseFloat(e.target.value) || 0 }))} />
              </div>
              <div>
                <div className="pf-label">Exit Date</div>
                <input className="pf-input" type="date" value={newHolding.exitDate}
                  onChange={e => setNewHolding(p => ({ ...p, exitDate: e.target.value }))} />
              </div>
            </div>
          )}
          {/* Show computed values preview */}
          {newHolding.quantity > 0 && newHolding.costBasis > 0 && newHolding.type === "crypto_perp" && (
            <div style={{ marginTop: 10, padding: "8px 12px", background: "#0a0c10", borderRadius: 6, display: "flex", gap: 20, fontSize: 10, color: "#5a6070" }}>
              <span>Notional: <span style={{ color: "#8890a0" }}>{fmtDollar(newHolding.quantity * newHolding.costBasis)}</span></span>
              <span>Margin (calc): <span style={{ color: "#8890a0" }}>{fmtDollar(newHolding.quantity * newHolding.costBasis / (newHolding.leverage || 1))}</span></span>
              {newHolding.margin > 0 && <span>Margin (yours): <span style={{ color: "#22c55e" }}>{fmtDollar(newHolding.margin)}</span></span>}
            </div>
          )}
          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            <button className="pf-btn pf-btn-primary" onClick={addHolding}>Add to Portfolio</button>
          </div>
        </div>
      )}

      {/* ─── SUMMARY METRICS ─── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 20 }}>
        <div className="pf-metric">
          <div className="pf-label">Open Margin / Cost</div>
          <div className="pf-value">{fmtDollar(portfolio.totalMargin)}</div>
        </div>
        <div className="pf-metric">
          <div className="pf-label">Portfolio Equity</div>
          <div className="pf-value" style={{ color: portfolio.unrealizedPnl >= 0 ? "#22c55e" : "#ef4444" }}>{fmtDollar(portfolio.totalEquity)}</div>
        </div>
        <div className="pf-metric">
          <div className="pf-label">Unrealized P&L</div>
          <div className="pf-value" style={{ color: portfolio.unrealizedPnl >= 0 ? "#22c55e" : "#ef4444" }}>{fmtPnl(portfolio.unrealizedPnl)}</div>
        </div>
        <div className="pf-metric">
          <div className="pf-label">Realized P&L</div>
          <div className="pf-value" style={{ color: portfolio.realizedPnl >= 0 ? "#22c55e" : "#ef4444" }}>{fmtPnl(portfolio.realizedPnl)}</div>
        </div>
        <div className="pf-metric">
          <div className="pf-label">Total P&L</div>
          <div className="pf-value" style={{ color: portfolio.totalPnl >= 0 ? "#22c55e" : "#ef4444" }}>{fmtPnl(portfolio.totalPnl)}</div>
        </div>
        <div className="pf-metric">
          <div className="pf-label">Return on Capital</div>
          <div className="pf-value" style={{ color: portfolio.totalPnlPct >= 0 ? "#22c55e" : "#ef4444" }}>{fmtPct(portfolio.totalPnlPct)}</div>
        </div>
        {portfolio.best && (
          <div className="pf-metric" style={{ borderLeft: "3px solid #22c55e" }}>
            <div className="pf-label">Best Performer</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#22c55e" }}>{portfolio.best.symbol}</div>
            <div style={{ fontSize: 11, color: "#22c55e80" }}>{fmtPct(portfolio.best.pnlPct)}</div>
          </div>
        )}
        {portfolio.worst && (
          <div className="pf-metric" style={{ borderLeft: "3px solid #ef4444" }}>
            <div className="pf-label">Worst Performer</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#ef4444" }}>{portfolio.worst.symbol}</div>
            <div style={{ fontSize: 11, color: "#ef444480" }}>{fmtPct(portfolio.worst.pnlPct)}</div>
          </div>
        )}
      </div>

      {/* ─── PORTFOLIO VALUE CHART + ALLOCATION ─── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 16, marginBottom: 20 }}>
        <div className="pf-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1px", color: "#5a6070" }}>Portfolio Equity Over Time</div>
            <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
              {["1D", "1W", "1M", "3M", "6M", "1Y", "ALL", "CUSTOM"].map(r => (
                <button key={r} className={`pf-btn ${chartRange === r ? "pf-btn-primary" : ""}`}
                  style={{ padding: "3px 8px", fontSize: 9 }} onClick={() => setChartRange(r)}>
                  {r}
                </button>
              ))}
              {chartRange === "CUSTOM" && (
                <div style={{ display: "flex", gap: 4, alignItems: "center", marginLeft: 6 }}>
                  <input className="pf-input" type="date" value={customFrom}
                    onChange={e => setCustomFrom(e.target.value)}
                    style={{ width: 120, padding: "3px 6px", fontSize: 9 }} />
                  <span style={{ color: "#3a4050", fontSize: 9 }}>→</span>
                  <input className="pf-input" type="date" value={customTo}
                    onChange={e => setCustomTo(e.target.value)}
                    style={{ width: 120, padding: "3px 6px", fontSize: 9 }} />
                </div>
              )}
            </div>
          </div>
          {portfolioChart.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={portfolioChart} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                <defs>
                  <linearGradient id="pf-val-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1a1d28" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 8, fill: "#4a5060" }}
                  tickFormatter={d => {
                    // d is "2026-02-05T08" or "2026-02-05" format
                    const parts = d.split("T")
                    const day = parts[0].slice(5) // "02-05"
                    const hr = parts[1] ? `${parts[1]}:00` : ""
                    return portfolioChart.length <= 30 ? `${day} ${hr}` : day
                  }}
                  interval={portfolioChart.length <= 40 ? Math.max(0, Math.floor(portfolioChart.length / 12)) : "preserveStartEnd"}
                />
                <YAxis
                  yAxisId="val"
                  tick={{ fontSize: 8, fill: "#4a5060" }}
                  domain={[(min) => Math.floor(min * 0.97), (max) => Math.ceil(max * 1.03)]}
                  tickFormatter={v => v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(0)}`}
                />
                <Tooltip
                  contentStyle={{ background: "#12151c", border: "1px solid #1e2330", borderRadius: 6, fontSize: 10, fontFamily: "JetBrains Mono" }}
                  labelFormatter={d => {
                    const parts = d.split("T")
                    return parts[1] ? `${parts[0]} ${parts[1]}:00 UTC` : parts[0]
                  }}
                  formatter={(v, name) => [fmtDollar(v), name === "totalEquity" ? "Equity" : name === "pnl" ? "P&L" : "Margin"]}
                />
                <ReferenceLine yAxisId="val" y={portfolioChart.length > 0 ? portfolioChart[0].totalMargin : 0} stroke="#ef444440" strokeDasharray="4 4" label={{ value: "Cost", fill: "#ef444440", fontSize: 8, position: "left" }} />
                <Area yAxisId="val" type="monotone" dataKey="totalEquity" stroke="#3b82f6" fill="url(#pf-val-grad)" strokeWidth={2} dot={portfolioChart.length <= 80 ? { r: 2, fill: "#3b82f6" } : false} />
                <Line yAxisId="val" type="monotone" dataKey="totalMargin" stroke="#4a506040" strokeWidth={1} dot={false} strokeDasharray="4 4" />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ height: 280, display: "flex", alignItems: "center", justifyContent: "center", color: "#3a4050", fontSize: 11 }}>
              {historyLoading ? "Loading historical data from exchanges..." : 
               Object.keys(historicalData).length === 0 ? "No kline data returned — check browser console (F12) for details" :
               "No chart data for selected range"}
            </div>
          )}
        </div>

        {/* Allocation Pie */}
        <div className="pf-card">
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1px", color: "#5a6070", marginBottom: 8 }}>Allocation</div>
          {portfolio.allocation.length > 0 && (
            <>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie data={portfolio.allocation} dataKey="value" nameKey="name" cx="50%" cy="50%"
                    innerRadius={40} outerRadius={65} stroke="#0f1118" strokeWidth={2}>
                    {portfolio.allocation.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: "#12151c", border: "1px solid #1e2330", borderRadius: 6, fontSize: 10, fontFamily: "JetBrains Mono" }}
                    formatter={(v) => [fmtDollar(v), "Value"]}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
                {portfolio.allocation.map((a, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ width: 8, height: 8, borderRadius: 2, background: a.color }} />
                      <span style={{ color: "#8890a0" }}>{a.name}</span>
                    </div>
                    <span style={{ color: "#5a6070" }}>{(a.pct * 100).toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ─── HOLDINGS: CARD VIEW ─── */}
      {viewMode === "cards" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 14, marginBottom: 20 }}>
          {enrichedHoldings.filter(h => !h.isClosed).map(h => {
            const chartData = holdingChartData(h)
            const isEditing = editingId === h.id
            return (
              <div key={h.id} className="pf-card" style={{ borderLeft: `3px solid ${h.color}`, padding: 16 }}>
                {/* Header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 16, fontWeight: 700, color: "#e0e4ec" }}>{h.symbol}</span>
                      {h.name && <span style={{ fontSize: 11, color: "#4a5060" }}>{h.name}</span>}
                      <span style={{ fontSize: 8, padding: "1px 6px", borderRadius: 3, background: h.type.includes("crypto") ? "#f59e0b15" : "#3b82f615", color: h.type.includes("crypto") ? "#f59e0b" : "#3b82f6" }}>
                        {ASSET_TYPES.find(t => t.value === h.type)?.label || h.type}
                      </span>
                      {h.leverage > 1 && (
                        <span style={{ fontSize: 8, padding: "1px 6px", borderRadius: 3, background: "#ef444415", color: "#ef4444", fontWeight: 600 }}>
                          {h.leverage}×
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 10, color: "#3a4050", marginTop: 2 }}>
                      Opened {h.tradeDate} · {h.daysHeld}d held
                      {h.notes && <span> · {h.notes}</span>}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    {onNavigateToChart && (
                      <button className="pf-btn" style={{ padding: "3px 8px", fontSize: 9, color: "#3b82f6", borderColor: "#3b82f640" }} onClick={() => onNavigateToChart(h.tvSymbol)} title="Open chart in Simulator">
                        📈
                      </button>
                    )}
                    <button className="pf-btn" style={{ padding: "3px 8px", fontSize: 9, color: "#f59e0b", borderColor: "#f59e0b40" }}
                      onClick={() => setClosingId(closingId === h.id ? null : h.id)} title="Close position">
                      {closingId === h.id ? "Cancel" : "Close"}
                    </button>
                    <button className="pf-btn" style={{ padding: "3px 8px", fontSize: 9 }} onClick={() => setEditingId(isEditing ? null : h.id)}>
                      {isEditing ? "Done" : "Edit"}
                    </button>
                    <button className="pf-btn pf-btn-danger" style={{ padding: "3px 8px", fontSize: 9 }} onClick={() => removeHolding(h.id)}>×</button>
                  </div>
                </div>

                {/* Close Position Form */}
                {closingId === h.id && (
                  <ClosePositionForm holding={h} onClose={closeHolding} onCancel={() => setClosingId(null)} />
                )}

                {/* Inline edit */}
                {isEditing && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6, marginBottom: 10, padding: 10, background: "#0a0c10", borderRadius: 6 }}>
                    <div><div style={{ fontSize: 8, color: "#4a5060", marginBottom: 2 }}>Qty (tokens)</div><input className="pf-input" type="number" step="any" value={h.quantity} onChange={e => updateHolding(h.id, "quantity", parseFloat(e.target.value) || 0)} style={{ fontSize: 11, padding: "4px 6px" }} /></div>
                    <div><div style={{ fontSize: 8, color: "#4a5060", marginBottom: 2 }}>Entry Price</div><input className="pf-input" type="number" step="any" value={h.costBasis} onChange={e => updateHolding(h.id, "costBasis", parseFloat(e.target.value) || 0)} style={{ fontSize: 11, padding: "4px 6px" }} /></div>
                    <div><div style={{ fontSize: 8, color: "#4a5060", marginBottom: 2 }}>Leverage</div><input className="pf-input" type="number" step="0.5" min="1" value={h.leverage} onChange={e => updateHolding(h.id, "leverage", parseFloat(e.target.value) || 1)} style={{ fontSize: 11, padding: "4px 6px" }} /></div>
                    <div><div style={{ fontSize: 8, color: "#4a5060", marginBottom: 2 }}>Trade Date</div><input className="pf-input" type="date" value={h.tradeDate} onChange={e => updateHolding(h.id, "tradeDate", e.target.value)} style={{ fontSize: 11, padding: "4px 6px" }} /></div>
                    {h.isLeveraged && (
                      <div><div style={{ fontSize: 8, color: "#4a5060", marginBottom: 2 }}>Margin (actual $ in)</div><input className="pf-input" type="number" step="any" value={h.margin || ""} placeholder="Auto" onChange={e => updateHolding(h.id, "margin", parseFloat(e.target.value) || 0)} style={{ fontSize: 11, padding: "4px 6px" }} /></div>
                    )}
                    <div><div style={{ fontSize: 8, color: "#4a5060", marginBottom: 2 }}>Current Price (manual)</div><input className="pf-input" type="number" step="any" value={h.currentPrice || ""} placeholder="Auto" onChange={e => updateHolding(h.id, "currentPrice", parseFloat(e.target.value) || 0)} style={{ fontSize: 11, padding: "4px 6px" }} /></div>
                  </div>
                )}

                {/* Metrics */}
                <div style={{ display: "grid", gridTemplateColumns: h.isLeveraged ? "1fr 1fr 1fr 1fr" : "1fr 1fr 1fr", gap: 8, marginBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: 8, color: "#4a5060" }}>Current Price</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#e0e4ec" }}>{fmtDollar(h.currentPrice)}</div>
                    {h.change24h !== 0 && <div style={{ fontSize: 9, color: h.change24h >= 0 ? "#22c55e" : "#ef4444" }}>{h.change24h >= 0 ? "▲" : "▼"} {Math.abs(h.change24h).toFixed(2)}% 24h</div>}
                  </div>
                  {h.isLeveraged ? (
                    <>
                      <div>
                        <div style={{ fontSize: 8, color: "#4a5060" }}>Margin (your $)</div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: "#e0e4ec" }}>{fmtDollar(h.margin)}</div>
                        <div style={{ fontSize: 9, color: "#3a4050" }}>Notional: {fmtDollar(h.notional)}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 8, color: "#4a5060" }}>Equity</div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: h.equity >= h.margin ? "#22c55e" : "#ef4444" }}>{fmtDollar(h.equity)}</div>
                        <div style={{ fontSize: 9, color: "#3a4050" }}>{h.leverage}× {h.direction === 1 ? "Long" : "Short"}</div>
                      </div>
                    </>
                  ) : (
                    <div>
                      <div style={{ fontSize: 8, color: "#4a5060" }}>Position Value</div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: "#e0e4ec" }}>{fmtDollar(h.equity)}</div>
                      <div style={{ fontSize: 9, color: "#3a4050" }}>{h.quantity} × {fmtDollar(h.currentPrice)}</div>
                    </div>
                  )}
                  <div>
                    <div style={{ fontSize: 8, color: "#4a5060" }}>P&L</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: h.pnl >= 0 ? "#22c55e" : "#ef4444" }}>{fmtPnl(h.pnl)}</div>
                    <div style={{ fontSize: 9, color: h.pnlPct >= 0 ? "#22c55e80" : "#ef444480" }}>{fmtPct(h.pnlPct)}</div>
                  </div>
                </div>

                {/* Mini Chart — TradingView for visuals, Binance data for P&L overlay */}
                {chartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={100}>
                    <AreaChart data={chartData} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id={`hold-grad-${h.id}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={h.color} stopOpacity={0.2} />
                          <stop offset="95%" stopColor={h.color} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="date" hide />
                      <YAxis hide domain={["dataMin", "dataMax"]} />
                      <Tooltip
                        contentStyle={{ background: "#12151c", border: "1px solid #1e2330", borderRadius: 6, fontSize: 9, fontFamily: "JetBrains Mono" }}
                        labelFormatter={d => { const p = d.split("T"); return p[1] ? `${p[0]} ${p[1]}:00` : p[0] }}
                        formatter={(v, name) => [name === "price" ? fmtDollar(v) : name === "equity" ? fmtDollar(v) : fmtPct(v), name === "price" ? "Price" : name === "equity" ? "Equity" : "Return"]}
                      />
                      <Area type="monotone" dataKey="price" stroke={h.color} fill={`url(#hold-grad-${h.id})`} strokeWidth={1.5} dot={false} />
                      <ReferenceLine y={h.costBasis} stroke="#4a506040" strokeDasharray="3 3" />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div style={{ height: 100, overflow: "hidden", borderRadius: 6, background: "#0a0c10" }}>
                    <TvMiniChart symbol={h.tvSymbol} height={100} />
                  </div>
                )}

                {/* Cost basis line label */}
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#3a4050", marginTop: 4 }}>
                  <span>Entry: {fmtDollar(h.costBasis)}</span>
                  {h.isLeveraged ? (
                    <span>Margin: {fmtDollar(h.margin)} · Notional: {fmtDollar(h.notional)}</span>
                  ) : (
                    <span>Cost: {fmtDollar(h.margin)}</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ─── HOLDINGS: TABLE VIEW ─── */}
      {viewMode === "table" && (
        <div className="pf-card" style={{ marginBottom: 20 }}>
          <div style={{ overflowX: "auto" }}>
            <table className="pf-table">
              <thead><tr>
                <th style={{ textAlign: "left" }}>Asset</th>
                <th>Type</th>
                <th>Qty</th>
                <th>Entry Price</th>
                <th>Margin / Cost</th>
                <th>Current Price</th>
                <th>24h</th>
                <th>Equity</th>
                <th>P&L ($)</th>
                <th>P&L (%)</th>
                <th>Days</th>
                <th></th>
              </tr></thead>
              <tbody>
                {enrichedHoldings.filter(h => !h.isClosed).map(h => (
                  <tr key={h.id}>
                    <td style={{ textAlign: "left" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={{ width: 8, height: 8, borderRadius: 2, background: h.color }} />
                        <span style={{ fontWeight: 600, color: "#e0e4ec" }}>{h.symbol}</span>
                        {h.name && <span style={{ color: "#4a5060", fontSize: 10 }}>{h.name}</span>}
                      </div>
                    </td>
                    <td style={{ fontSize: 10 }}>
                      {h.type === "crypto_perp" ? <span>{h.leverage}× {h.direction === 1 ? "L" : "S"}</span> : h.type.includes("crypto") ? "Spot" : h.type.includes("option") ? "Option" : "Equity"}
                    </td>
                    <td>{h.quantity.toLocaleString()}</td>
                    <td>{fmtDollar(h.costBasis)}</td>
                    <td>{fmtDollar(h.margin)}</td>
                    <td style={{ fontWeight: 600 }}>{fmtDollar(h.currentPrice)}</td>
                    <td style={{ color: h.change24h >= 0 ? "#22c55e" : "#ef4444", fontSize: 10 }}>
                      {h.change24h !== 0 ? `${h.change24h >= 0 ? "+" : ""}${h.change24h.toFixed(2)}%` : "—"}
                    </td>
                    <td style={{ fontWeight: 600, color: h.equity >= h.margin ? "#22c55e" : "#ef4444" }}>{fmtDollar(h.equity)}</td>
                    <td style={{ color: h.pnl >= 0 ? "#22c55e" : "#ef4444", fontWeight: 600 }}>{fmtPnl(h.pnl)}</td>
                    <td style={{ color: h.pnlPct >= 0 ? "#22c55e" : "#ef4444" }}>{fmtPct(h.pnlPct)}</td>
                    <td>{h.daysHeld}d</td>
                    <td>
                      <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                        <button className="pf-btn" style={{ padding: "2px 6px", fontSize: 9, color: "#f59e0b" }} onClick={() => setClosingId(h.id)}>Close</button>
                        {onNavigateToChart && <button className="pf-btn" style={{ padding: "2px 6px", fontSize: 9 }} onClick={() => onNavigateToChart(h.tvSymbol)}>📈</button>}
                        <button className="pf-btn pf-btn-danger" style={{ padding: "2px 6px", fontSize: 9 }} onClick={() => removeHolding(h.id)}>×</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: "2px solid #1e2330" }}>
                  <td style={{ textAlign: "left", fontWeight: 700, color: "#e0e4ec" }} colSpan={4}>Total (Open)</td>
                  <td style={{ fontWeight: 600 }}>{fmtDollar(portfolio.totalMargin)}</td>
                  <td colSpan={2}></td>
                  <td style={{ fontWeight: 700, color: portfolio.unrealizedPnl >= 0 ? "#22c55e" : "#ef4444" }}>{fmtDollar(portfolio.totalEquity)}</td>
                  <td style={{ fontWeight: 700, color: portfolio.unrealizedPnl >= 0 ? "#22c55e" : "#ef4444" }}>{fmtPnl(portfolio.unrealizedPnl)}</td>
                  <td style={{ fontWeight: 600, color: portfolio.unrealizedPnl >= 0 ? "#22c55e" : "#ef4444" }}>{fmtPct(portfolio.totalMargin > 0 ? portfolio.unrealizedPnl / portfolio.totalMargin : 0)}</td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* ─── INDIVIDUAL HOLDING CHARTS (expanded) ─── */}
      {viewMode === "table" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12 }}>
          {enrichedHoldings.filter(h => !h.isClosed && holdingChartData(h).length > 5).map(h => {
            const data = holdingChartData(h)
            return (
              <div key={h.id} className="pf-card" style={{ padding: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: h.color, marginBottom: 8 }}>
                  {h.symbol} — P&L Since Entry
                </div>
                <ResponsiveContainer width="100%" height={140}>
                  <AreaChart data={data} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                    <defs>
                      <linearGradient id={`tbl-grad-${h.id}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#22c55e" stopOpacity={0.15} />
                        <stop offset="50%" stopColor="#22c55e" stopOpacity={0} />
                        <stop offset="51%" stopColor="#ef4444" stopOpacity={0} />
                        <stop offset="100%" stopColor="#ef4444" stopOpacity={0.15} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="date" hide />
                    <YAxis hide />
                    <Tooltip contentStyle={{ background: "#12151c", border: "1px solid #1e2330", borderRadius: 6, fontSize: 9, fontFamily: "JetBrains Mono" }}
                      formatter={(v, name) => [name === "pnl" ? fmtDollar(v) : fmtPct(v), name === "pnl" ? "P&L" : "Return"]} />
                    <ReferenceLine y={0} stroke="#4a506060" />
                    <Area type="monotone" dataKey="pnl" stroke={data[data.length - 1]?.pnl >= 0 ? "#22c55e" : "#ef4444"} fill={`url(#tbl-grad-${h.id})`} strokeWidth={1.5} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )
          })}
        </div>
      )}

      {/* ─── TRADE HISTORY (Closed Positions) ─── */}
      <div style={{ marginTop: 30 }}>
        <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1.5px", color: "#5a6070", marginBottom: 10, display: "flex", alignItems: "center", gap: 10 }}>
          <span>Trade History</span>
          <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 4, background: "#f59e0b15", color: "#f59e0b" }}>
            {enrichedHoldings.filter(h => h.isClosed).length} closed
          </span>
          {portfolio.realizedPnl !== 0 && (
            <span style={{ fontSize: 10, fontWeight: 400, color: portfolio.realizedPnl >= 0 ? "#22c55e" : "#ef4444" }}>
              Realized: {fmtPnl(portfolio.realizedPnl)}
            </span>
          )}
        </div>
        <div className="pf-card" style={{ borderTop: "2px solid #f59e0b40" }}>
          <div style={{ overflowX: "auto" }}>
            <table className="pf-table">
                <thead><tr>
                  <th style={{ textAlign: "left" }}>Asset</th>
                  <th>Type</th>
                  <th>Qty</th>
                  <th>Entry Price</th>
                  <th>Cost</th>
                  <th>Exit Price</th>
                  <th>Exit Value</th>
                  <th>Entry Date</th>
                  <th>Exit Date</th>
                  <th>Days Held</th>
                  <th>P&L ($)</th>
                  <th>P&L (%)</th>
                  <th></th>
                </tr></thead>
                <tbody>
                  {enrichedHoldings.filter(h => h.isClosed).length === 0 && (
                    <tr>
                      <td colSpan={13} style={{ textAlign: "center", padding: "24px 0", color: "#3a4050", fontSize: 11 }}>
                        No closed trades yet. Use the <span style={{ color: "#f59e0b" }}>Close</span> button on a position or add a historical trade with "Already Closed" checked.
                      </td>
                    </tr>
                  )}
                  {enrichedHoldings.filter(h => h.isClosed).sort((a, b) => (b.exitDate || "").localeCompare(a.exitDate || "")).map(h => (
                    <tr key={h.id}>
                      <td style={{ textAlign: "left" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <div style={{ width: 8, height: 8, borderRadius: 2, background: "#4a5060" }} />
                          <span style={{ fontWeight: 600, color: "#8890a0" }}>{h.symbol}</span>
                          {h.name && <span style={{ color: "#4a5060", fontSize: 10 }}>{h.name}</span>}
                        </div>
                      </td>
                      <td style={{ fontSize: 10 }}>
                        {h.type === "crypto_perp" ? <span>{h.leverage}× {h.direction === 1 ? "L" : "S"}</span> : h.type.includes("crypto") ? "Spot" : h.type.includes("option") ? "Option" : "Equity"}
                      </td>
                      <td>{h.quantity.toLocaleString()}</td>
                      <td>{fmtDollar(h.costBasis)}</td>
                      <td>{fmtDollar(h.margin)}</td>
                      <td style={{ color: "#f59e0b" }}>{fmtDollar(h.exitPrice)}</td>
                      <td>{fmtDollar(h.equity)}</td>
                      <td style={{ fontSize: 10, color: "#4a5060" }}>{h.tradeDate}</td>
                      <td style={{ fontSize: 10, color: "#f59e0b" }}>{h.exitDate || "—"}</td>
                      <td>{h.daysHeld}d</td>
                      <td style={{ color: h.pnl >= 0 ? "#22c55e" : "#ef4444", fontWeight: 600 }}>{fmtPnl(h.pnl)}</td>
                      <td style={{ color: h.pnlPct >= 0 ? "#22c55e" : "#ef4444" }}>{fmtPct(h.pnlPct)}</td>
                      <td>
                        <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                          <button className="pf-btn" style={{ padding: "2px 6px", fontSize: 9, color: "#22c55e" }} onClick={() => reopenHolding(h.id)} title="Reopen">↩</button>
                          <button className="pf-btn" style={{ padding: "2px 6px", fontSize: 9 }} onClick={() => setEditingId(editingId === h.id ? null : h.id)}>Edit</button>
                          <button className="pf-btn pf-btn-danger" style={{ padding: "2px 6px", fontSize: 9 }} onClick={() => removeHolding(h.id)}>×</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                {enrichedHoldings.some(h => h.isClosed) && (
                <tfoot>
                  <tr style={{ borderTop: "2px solid #1e2330" }}>
                    <td style={{ textAlign: "left", fontWeight: 700, color: "#f59e0b" }} colSpan={4}>Total Realized</td>
                    <td style={{ fontWeight: 600 }}>{fmtDollar(enrichedHoldings.filter(h => h.isClosed).reduce((s, h) => s + h.margin, 0))}</td>
                    <td></td>
                    <td style={{ fontWeight: 600 }}>{fmtDollar(enrichedHoldings.filter(h => h.isClosed).reduce((s, h) => s + h.equity, 0))}</td>
                    <td colSpan={3}></td>
                    <td style={{ fontWeight: 700, color: portfolio.realizedPnl >= 0 ? "#22c55e" : "#ef4444" }}>{fmtPnl(portfolio.realizedPnl)}</td>
                    <td style={{ fontWeight: 600, color: portfolio.realizedPnl >= 0 ? "#22c55e" : "#ef4444" }}>
                      {fmtPct(enrichedHoldings.filter(h => h.isClosed).reduce((s, h) => s + h.margin, 0) > 0
                        ? portfolio.realizedPnl / enrichedHoldings.filter(h => h.isClosed).reduce((s, h) => s + h.margin, 0) : 0)}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
                )}
              </table>
            </div>
          </div>
        </div>

      {/* ─── POSITION TIMELINE ─── */}
      {enrichedHoldings.length > 0 && (() => {
        // Build all positions sorted by entry date
        const allPositions = [...enrichedHoldings].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate))
        
        // Find date range
        const allDates = []
        allPositions.forEach(h => {
          if (h.tradeDate) allDates.push(h.tradeDate)
          if (h.exitDate) allDates.push(h.exitDate)
        })
        if (allDates.length === 0) return null
        allDates.sort()
        const minDate = allDates[0]
        const today = new Date().toISOString().slice(0, 10)
        const maxDate = allDates[allDates.length - 1] > today ? allDates[allDates.length - 1] : today
        
        // Generate day-by-day list
        const days = []
        let d = new Date(minDate)
        const end = new Date(maxDate)
        while (d <= end) {
          days.push(d.toISOString().slice(0, 10))
          d.setDate(d.getDate() + 1)
        }

        // Compute daily deployed capital
        const dailyCapital = days.map(day => {
          let deployed = 0
          let count = 0
          enrichedHoldings.forEach(h => {
            if (day < h.tradeDate) return
            if (h.isClosed && h.exitDate && day > h.exitDate) return
            deployed += h.margin
            count++
          })
          return { day, deployed, count }
        })

        // Find peak overlap
        const peakDay = dailyCapital.reduce((best, d) => d.deployed > best.deployed ? d : best, { deployed: 0 })

        return (
          <div style={{ marginTop: 24 }}>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1.5px", color: "#5a6070", marginBottom: 10, display: "flex", alignItems: "center", gap: 10 }}>
              <span>Position Timeline</span>
              <span style={{ fontSize: 9, color: "#4a5060" }}>
                Peak deployed: {fmtDollar(peakDay.deployed)} ({peakDay.count} positions on {peakDay.day})
              </span>
            </div>
            <div className="pf-card" style={{ borderTop: "2px solid #3b82f640" }}>
              <div style={{ overflowX: "auto" }}>
                {/* Gantt-style timeline */}
                <div style={{ minWidth: 600 }}>
                  {/* Date header */}
                  <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
                    <div style={{ width: 120, flexShrink: 0, fontSize: 9, color: "#4a5060", fontWeight: 600 }}>Position</div>
                    <div style={{ width: 70, flexShrink: 0, fontSize: 9, color: "#4a5060", textAlign: "right", paddingRight: 8 }}>Cost</div>
                    <div style={{ flex: 1, display: "flex", position: "relative" }}>
                      {days.map((day, i) => (
                        <div key={day} style={{
                          flex: 1, fontSize: 7, color: "#3a4050", textAlign: "center",
                          borderLeft: "1px solid #1e233040",
                          display: i % Math.max(1, Math.floor(days.length / 12)) === 0 ? "block" : "none",
                        }}>
                          {day.slice(5)}
                        </div>
                      ))}
                    </div>
                    <div style={{ width: 80, flexShrink: 0, fontSize: 9, color: "#4a5060", textAlign: "right" }}>Status</div>
                  </div>

                  {/* Position bars */}
                  {allPositions.map(h => {
                    const startIdx = Math.max(0, days.indexOf(h.tradeDate))
                    const endDay = h.isClosed && h.exitDate ? h.exitDate : today
                    let endIdx = days.indexOf(endDay)
                    if (endIdx < 0) endIdx = days.length - 1
                    const barLeft = days.length > 0 ? (startIdx / days.length) * 100 : 0
                    const barWidth = days.length > 0 ? (Math.max(1, endIdx - startIdx + 1) / days.length) * 100 : 0
                    const barColor = h.isClosed ? (h.pnl >= 0 ? "#22c55e" : "#ef4444") : h.color

                    return (
                      <div key={h.id} style={{ display: "flex", alignItems: "center", marginBottom: 3 }}>
                        <div style={{ width: 120, flexShrink: 0, fontSize: 10, color: h.isClosed ? "#6a7080" : "#e0e4ec", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {h.symbol}
                          {h.isLeveraged && <span style={{ fontSize: 8, color: "#f59e0b", marginLeft: 4 }}>{h.leverage}×</span>}
                        </div>
                        <div style={{ width: 70, flexShrink: 0, fontSize: 9, color: "#6a7080", textAlign: "right", paddingRight: 8 }}>
                          {fmtDollar(h.margin)}
                        </div>
                        <div style={{ flex: 1, position: "relative", height: 18, background: "#0a0c10", borderRadius: 2, overflow: "hidden" }}>
                          {/* Background grid lines */}
                          {days.map((day, i) => (
                            <div key={day} style={{
                              position: "absolute", left: `${(i / days.length) * 100}%`, top: 0, bottom: 0,
                              width: 1, background: "#1e233030",
                            }} />
                          ))}
                          {/* Active bar */}
                          <div style={{
                            position: "absolute",
                            left: `${barLeft}%`,
                            width: `${barWidth}%`,
                            top: 2, bottom: 2,
                            background: `${barColor}30`,
                            border: `1px solid ${barColor}60`,
                            borderRadius: 2,
                          }}>
                            <div style={{ fontSize: 7, color: barColor, padding: "0 3px", lineHeight: "12px", whiteSpace: "nowrap", overflow: "hidden" }}>
                              {h.tradeDate.slice(5)} → {h.isClosed ? h.exitDate?.slice(5) : "now"}
                            </div>
                          </div>
                        </div>
                        <div style={{ width: 80, flexShrink: 0, textAlign: "right" }}>
                          {h.isClosed ? (
                            <span style={{ fontSize: 9, color: h.pnl >= 0 ? "#22c55e" : "#ef4444" }}>{fmtPnl(h.pnl)}</span>
                          ) : (
                            <span style={{ fontSize: 9, color: "#3b82f6" }}>Open</span>
                          )}
                        </div>
                      </div>
                    )
                  })}

                  {/* Daily deployed capital row */}
                  <div style={{ display: "flex", alignItems: "center", marginTop: 8, paddingTop: 8, borderTop: "1px solid #1e2330" }}>
                    <div style={{ width: 120, flexShrink: 0, fontSize: 9, color: "#f59e0b", fontWeight: 600 }}>Deployed $</div>
                    <div style={{ width: 70, flexShrink: 0 }} />
                    <div style={{ flex: 1, display: "flex", position: "relative", height: 32 }}>
                      {dailyCapital.map((dc, i) => {
                        const barH = peakDay.deployed > 0 ? (dc.deployed / peakDay.deployed) * 100 : 0
                        return (
                          <div key={dc.day} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", position: "relative" }}>
                            <div style={{
                              width: "80%", height: `${barH}%`, minHeight: dc.deployed > 0 ? 2 : 0,
                              background: dc.count > 4 ? "#ef444460" : dc.count > 3 ? "#f59e0b40" : "#3b82f630",
                              borderRadius: "1px 1px 0 0",
                            }} title={`${dc.day}: ${fmtDollar(dc.deployed)} (${dc.count} positions)`} />
                          </div>
                        )
                      })}
                    </div>
                    <div style={{ width: 80, flexShrink: 0 }} />
                  </div>

                  {/* Count row */}
                  <div style={{ display: "flex", alignItems: "center", marginTop: 2 }}>
                    <div style={{ width: 120, flexShrink: 0, fontSize: 9, color: "#4a5060" }}># Positions</div>
                    <div style={{ width: 70, flexShrink: 0 }} />
                    <div style={{ flex: 1, display: "flex" }}>
                      {dailyCapital.map((dc) => (
                        <div key={dc.day} style={{ flex: 1, textAlign: "center", fontSize: 7, color: dc.count > 4 ? "#ef4444" : dc.count > 3 ? "#f59e0b" : "#4a5060" }}>
                          {dc.count > 0 ? dc.count : ""}
                        </div>
                      ))}
                    </div>
                    <div style={{ width: 80, flexShrink: 0 }} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

