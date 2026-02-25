import React, { useState, useEffect, useRef, useCallback, memo } from "react"
import { createChart } from "lightweight-charts"
import {
  parseChartSymbol, subscribeCoinbase, subscribePhemex, subscribeYahoo,
  fetchCoinbaseCandles, fetchPhemexCandles, fetchYahooCandles, fetchCoingeckoCandles,
} from "../lib/liveData"

const TIMEFRAMES = ["1m", "5m", "15m", "1H", "4H", "1D"]

function fmtPrice(p) {
  if (p == null) return "—"
  if (p >= 1000) return p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (p >= 1) return p.toFixed(2)
  if (p >= 0.01) return p.toFixed(4)
  return p.toFixed(6)
}

function fmtChange(c) {
  if (c == null) return ""
  return `${c >= 0 ? "+" : ""}${c.toFixed(2)}%`
}

const GRANULARITY = { "1m": 60, "5m": 300, "15m": 900, "1H": 3600, "4H": 14400, "1D": 86400 }

function LiveChart({ symbol }) {
  const containerRef = useRef(null)
  const chartRef = useRef(null)
  const candleRef = useRef(null)
  const volRef = useRef(null)
  const lastCandleRef = useRef(null)

  const [tf, setTf] = useState("1H")
  const [price, setPrice] = useState(null)
  const [change24h, setChange24h] = useState(null)
  const [status, setStatus] = useState("loading") // loading, live, polling, delayed, error
  const [source, setSource] = useState("") // "CB", "PH", "CG", "YF"

  const parsed = parseChartSymbol(symbol)

  // ─── CREATE CHART ───
  useEffect(() => {
    if (!containerRef.current) return
    const el = containerRef.current

    const chart = createChart(el, {
      layout: {
        background: { color: "#080a0f" },
        textColor: "#4a5060",
        fontFamily: "'JetBrains Mono', 'SF Mono', monospace",
        fontSize: 10,
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.025)" },
        horzLines: { color: "rgba(255,255,255,0.025)" },
      },
      crosshair: {
        mode: 0,
        vertLine: { color: "rgba(59,130,246,0.3)", width: 1, style: 2, labelBackgroundColor: "#1a1d28" },
        horzLine: { color: "rgba(59,130,246,0.3)", width: 1, style: 2, labelBackgroundColor: "#1a1d28" },
      },
      timeScale: {
        borderColor: "rgba(255,255,255,0.04)",
        timeVisible: true,
        secondsVisible: false,
        fixLeftEdge: true,
        fixRightEdge: true,
      },
      rightPriceScale: {
        borderColor: "rgba(255,255,255,0.04)",
        scaleMargins: { top: 0.05, bottom: 0.2 },
      },
      handleScroll: true,
      handleScale: true,
    })

    const candleSeries = chart.addCandlestickSeries({
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor: "#22c55e80",
      wickDownColor: "#ef444480",
    })

    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
    })
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })

    chartRef.current = chart
    candleRef.current = candleSeries
    volRef.current = volumeSeries

    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect
      if (width > 0 && height > 0) chart.resize(width, height)
    })
    ro.observe(el)

    return () => { ro.disconnect(); chart.remove(); chartRef.current = null; candleRef.current = null; volRef.current = null }
  }, [])

  // ─── LOAD HISTORICAL CANDLES (with fallback chain) ───
  useEffect(() => {
    let cancelled = false
    setStatus("loading")
    setSource("")

    async function load() {
      let candles = []
      let src = ""

      if (parsed.exchange === "yahoo") {
        candles = await fetchYahooCandles(parsed.ticker, tf)
        src = "YF"
      } else {
        // Crypto fallback chain: Coinbase → Phemex → CoinGecko
        if (parsed.cbProduct) {
          candles = await fetchCoinbaseCandles(parsed.cbProduct, tf)
          if (candles.length > 0) src = "CB"
        }
        if (candles.length === 0 && parsed.phProduct) {
          candles = await fetchPhemexCandles(parsed.phProduct, tf)
          if (candles.length > 0) src = "PH"
        }
        if (candles.length === 0 && parsed.coingeckoId) {
          candles = await fetchCoingeckoCandles(parsed.coingeckoId, tf)
          if (candles.length > 0) src = "CG"
        }
      }

      if (cancelled) return

      if (candles.length === 0) {
        setStatus("error")
        setSource("—")
        return
      }

      setSource(src)

      if (candleRef.current) {
        candleRef.current.setData(candles.map(c => ({
          time: c.time, open: c.open, high: c.high, low: c.low, close: c.close,
        })))
      }
      if (volRef.current) {
        volRef.current.setData(candles.map(c => ({
          time: c.time, value: c.volume || 0,
          color: c.close >= c.open ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
        })))
      }

      const last = candles[candles.length - 1]
      lastCandleRef.current = last
      if (last) setPrice(last.close)

      if (chartRef.current) chartRef.current.timeScale().fitContent()
    }

    load()
    return () => { cancelled = true }
  }, [symbol, tf])

  // ─── LIVE UPDATES (with fallback) ───
  useEffect(() => {
    if (!parsed) return
    const unsubs = []

    if (parsed.exchange === "yahoo") {
      setStatus("delayed")
      unsubs.push(subscribeYahoo(parsed.ticker, (tick) => {
        setPrice(tick.price)
        setChange24h(tick.change)
        setStatus("delayed")
        updateLastCandle(tick.price, tf)
      }, 15000))
      return () => unsubs.forEach(u => u())
    }

    // Crypto: try Coinbase WS first, always run Phemex polling as backup
    let hasCbData = false

    if (parsed.cbProduct) {
      unsubs.push(subscribeCoinbase(parsed.cbProduct, (tick) => {
        const p = parseFloat(tick.price)
        const open24h = parseFloat(tick.open_24h || 0)
        if (!p || p <= 0) return
        hasCbData = true
        setPrice(p)
        setStatus("live")
        setSource("CB")
        if (open24h > 0) setChange24h(((p - open24h) / open24h) * 100)
        updateLastCandle(p, tf)
      }))
    }

    if (parsed.phProduct) {
      unsubs.push(subscribePhemex(parsed.phProduct, (tick) => {
        // Only use Phemex data if Coinbase isn't streaming
        if (hasCbData) return
        setPrice(tick.price)
        setChange24h(tick.change)
        setStatus("polling")
        setSource("PH")
        updateLastCandle(tick.price, tf)
      }, 5000))
    }

    // If neither CB nor PH, we just have candle data
    if (!parsed.cbProduct && !parsed.phProduct) {
      setStatus("delayed")
    }

    return () => unsubs.forEach(u => u())
  }, [symbol, tf])

  function updateLastCandle(p, timeframe) {
    const gran = GRANULARITY[timeframe] || 3600
    const bucket = Math.floor(Date.now() / 1000 / gran) * gran
    const last = lastCandleRef.current

    if (last && last.time === bucket) {
      last.close = p
      last.high = Math.max(last.high, p)
      last.low = Math.min(last.low, p)
      if (candleRef.current) candleRef.current.update(last)
    } else {
      const newCandle = { time: bucket, open: p, high: p, low: p, close: p, volume: 0 }
      lastCandleRef.current = newCandle
      if (candleRef.current) candleRef.current.update(newCandle)
      if (volRef.current) volRef.current.update({ time: bucket, value: 0, color: "rgba(34,197,94,0.15)" })
    }
  }

  const statusColor = status === "live" ? "#22c55e" : status === "polling" ? "#3b82f6" : status === "delayed" ? "#f59e0b" : status === "error" ? "#ef4444" : "#6a7080"
  const statusLabel = status === "live" ? "LIVE" : status === "polling" ? "5s" : status === "delayed" ? "15s" : status === "error" ? "ERR" : "..."
  const changeColor = change24h >= 0 ? "#22c55e" : "#ef4444"

  return (
    <div ref={containerRef} style={{ height: "100%", width: "100%", position: "relative", background: "#080a0f" }}>
      {/* ─── Price overlay ─── */}
      <div style={{
        position: "absolute", top: 6, left: 8, zIndex: 10, pointerEvents: "none",
        display: "flex", flexDirection: "column", gap: 2,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{
            fontSize: 11, fontWeight: 600, color: "#8892a8",
            fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.04em",
          }}>
            {parsed.base}/{parsed.quote}
          </span>
          <span style={{
            fontSize: 8, fontWeight: 600, color: statusColor,
            background: statusColor + "15", padding: "1px 5px", borderRadius: 2,
            letterSpacing: "0.06em", fontFamily: "'JetBrains Mono', monospace",
          }}>
            {statusLabel}
          </span>
          {source && (
            <span style={{
              fontSize: 7, fontWeight: 500, color: "#3a4050",
              fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.05em",
            }}>
              {source}
            </span>
          )}
        </div>
        {price != null && (
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span style={{
              fontSize: 16, fontWeight: 700, color: "#e0e4ec",
              fontFamily: "'JetBrains Mono', monospace",
            }}>
              ${fmtPrice(price)}
            </span>
            {change24h != null && (
              <span style={{
                fontSize: 11, fontWeight: 600, color: changeColor,
                fontFamily: "'JetBrains Mono', monospace",
              }}>
                {fmtChange(change24h)}
              </span>
            )}
          </div>
        )}
      </div>

      {/* ─── Timeframe selector ─── */}
      <div style={{
        position: "absolute", bottom: 28, left: 8, zIndex: 10,
        display: "flex", gap: 2, pointerEvents: "auto",
      }}>
        {TIMEFRAMES.map(t => (
          <button key={t} onClick={() => setTf(t)} style={{
            padding: "2px 6px", fontSize: 9, fontWeight: tf === t ? 600 : 400,
            fontFamily: "'JetBrains Mono', monospace",
            background: tf === t ? "rgba(59,130,246,0.12)" : "rgba(0,0,0,0.5)",
            border: `1px solid ${tf === t ? "rgba(59,130,246,0.3)" : "rgba(255,255,255,0.04)"}`,
            borderRadius: 2, color: tf === t ? "#3b82f6" : "#4a5060",
            cursor: "pointer", letterSpacing: "0.03em",
            backdropFilter: "blur(4px)", transition: "all 0.12s",
          }}>
            {t}
          </button>
        ))}
      </div>
    </div>
  )
}

export default memo(LiveChart)

