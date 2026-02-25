/**
 * liveData.js — Shared WebSocket manager + REST candle fetchers
 *
 * Coinbase: single shared WebSocket, multiplexed subscriptions
 * Yahoo: polling via REST (no websocket available)
 * CoinGecko: REST fallback for coins not on Coinbase
 */

// ─── COINBASE WEBSOCKET (SHARED) ────────────────────────────────────────────

let cbWs = null
let cbReady = false
let cbAttempts = 0
let cbReconnectTimer = null
const cbSubscribers = new Map() // productId → Set<callback>
const cbPendingSubs = new Set()

function cbConnect() {
  if (cbWs && (cbWs.readyState === WebSocket.CONNECTING || cbWs.readyState === WebSocket.OPEN)) return

  try {
    cbWs = new WebSocket("wss://ws-feed.exchange.coinbase.com")
  } catch (e) {
    console.warn("[WS] Failed to create WebSocket:", e.message)
    cbScheduleReconnect()
    return
  }

  cbWs.onopen = () => {
    cbReady = true
    cbAttempts = 0
    console.log("[WS] Coinbase connected")
    // Subscribe to all registered products
    const products = [...cbSubscribers.keys()]
    if (products.length > 0) {
      cbWs.send(JSON.stringify({ type: "subscribe", product_ids: products, channels: ["ticker"] }))
    }
  }

  cbWs.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data)
      if (data.type === "ticker" && data.product_id) {
        const cbs = cbSubscribers.get(data.product_id)
        if (cbs) cbs.forEach(cb => cb(data))
      }
    } catch {}
  }

  cbWs.onclose = () => {
    cbReady = false
    console.log("[WS] Coinbase disconnected")
    cbScheduleReconnect()
  }

  cbWs.onerror = () => {
    cbReady = false
  }
}

function cbScheduleReconnect() {
  if (cbReconnectTimer) return
  if (cbSubscribers.size === 0) return // no subscribers, don't reconnect
  const delay = Math.min(1000 * Math.pow(2, cbAttempts), 30000)
  cbAttempts++
  console.log(`[WS] Reconnecting in ${delay}ms (attempt ${cbAttempts})`)
  cbReconnectTimer = setTimeout(() => {
    cbReconnectTimer = null
    cbConnect()
  }, delay)
}

export function subscribeCoinbase(productId, callback) {
  if (!cbSubscribers.has(productId)) {
    cbSubscribers.set(productId, new Set())
  }
  cbSubscribers.get(productId).add(callback)

  // Connect if not already
  if (!cbWs || cbWs.readyState === WebSocket.CLOSED) {
    cbConnect()
  } else if (cbReady) {
    // Subscribe to this new product
    cbWs.send(JSON.stringify({ type: "subscribe", product_ids: [productId], channels: ["ticker"] }))
  }

  // Return unsubscribe function
  return () => {
    const subs = cbSubscribers.get(productId)
    if (subs) {
      subs.delete(callback)
      if (subs.size === 0) {
        cbSubscribers.delete(productId)
        if (cbReady && cbWs) {
          try { cbWs.send(JSON.stringify({ type: "unsubscribe", product_ids: [productId], channels: ["ticker"] })) } catch {}
        }
      }
    }
    // Close ws if no subscribers left
    if (cbSubscribers.size === 0 && cbWs) {
      try { cbWs.close() } catch {}
      cbWs = null
      cbReady = false
    }
  }
}

// ─── YAHOO POLLING ──────────────────────────────────────────────────────────

export function subscribeYahoo(ticker, callback, intervalMs = 15000) {
  let active = true

  async function poll() {
    if (!active) return
    try {
      const url = `/api/yahoo/v7/finance/quote?symbols=${ticker}&fields=regularMarketPrice,regularMarketChangePercent,regularMarketOpen,regularMarketDayHigh,regularMarketDayLow,regularMarketVolume,regularMarketPreviousClose`
      const res = await fetch(url)
      if (!res.ok) return
      const data = await res.json()
      const q = data.quoteResponse?.result?.[0]
      if (q && q.regularMarketPrice > 0) {
        callback({
          price: q.regularMarketPrice,
          open24h: q.regularMarketPreviousClose || q.regularMarketOpen || 0,
          high: q.regularMarketDayHigh || q.regularMarketPrice,
          low: q.regularMarketDayLow || q.regularMarketPrice,
          volume: q.regularMarketVolume || 0,
          change: q.regularMarketChangePercent || 0,
          time: Date.now(),
        })
      }
    } catch (e) { console.warn("[Yahoo] poll error:", e.message) }
  }

  poll() // initial
  const timer = setInterval(poll, intervalMs)

  return () => {
    active = false
    clearInterval(timer)
  }
}

// ─── HISTORICAL CANDLE FETCHERS ─────────────────────────────────────────────

const GRANULARITY_MAP = {
  "1m": 60, "5m": 300, "15m": 900, "1H": 3600, "4H": 14400, "1D": 86400,
}
const CANDLE_COUNTS = {
  "1m": 360, "5m": 288, "15m": 288, "1H": 720, "4H": 540, "1D": 365,
}

export async function fetchCoinbaseCandles(productId, timeframe = "1H") {
  const granularity = GRANULARITY_MAP[timeframe] || 3600
  const count = CANDLE_COUNTS[timeframe] || 720
  const endSec = Math.floor(Date.now() / 1000)
  const startSec = endSec - count * granularity
  const results = []

  // Coinbase allows 300 candles per request
  // For 4H: fetch 1H and group client-side
  const fetchGran = timeframe === "4H" ? 3600 : granularity
  let cursor = endSec
  let batch = 0

  while (cursor > startSec && batch < 15) {
    batch++
    const bStart = Math.max(startSec, cursor - 299 * fetchGran)
    try {
      const url = `/api/coinbase/products/${productId}/candles?granularity=${fetchGran}&start=${new Date(bStart * 1000).toISOString()}&end=${new Date(cursor * 1000).toISOString()}`
      const res = await fetch(url)
      if (!res.ok) break
      const data = await res.json()
      if (!Array.isArray(data) || data.length === 0) break
      for (const c of data) {
        if (!Array.isArray(c) || c.length < 6) continue
        results.push({ time: c[0], low: c[1], high: c[2], open: c[3], close: c[4], volume: c[5] })
      }
      cursor = bStart - fetchGran
      if (data.length < 250) break
    } catch { break }
  }

  let candles = results.filter(c => c.close > 0).sort((a, b) => a.time - b.time)

  // Group into 4H if needed
  if (timeframe === "4H") {
    const grouped = {}
    for (const c of candles) {
      const bucket = Math.floor(c.time / 14400) * 14400
      if (!grouped[bucket]) {
        grouped[bucket] = { time: bucket, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume }
      } else {
        const g = grouped[bucket]
        g.high = Math.max(g.high, c.high)
        g.low = Math.min(g.low, c.low)
        g.close = c.close // last close wins
        g.volume += c.volume
      }
    }
    candles = Object.values(grouped).sort((a, b) => a.time - b.time)
  }

  // Deduplicate by time
  const seen = new Set()
  return candles.filter(c => {
    if (seen.has(c.time)) return false
    seen.add(c.time)
    return true
  })
}

export async function fetchYahooCandles(ticker, timeframe = "1H") {
  const intervalMap = { "1m": "1m", "5m": "5m", "15m": "15m", "1H": "1h", "4H": "1h", "1D": "1d" }
  const interval = intervalMap[timeframe] || "1h"
  const count = CANDLE_COUNTS[timeframe] || 720
  const gran = GRANULARITY_MAP[timeframe] || 3600
  const endSec = Math.floor(Date.now() / 1000)
  const startSec = endSec - count * gran

  try {
    const url = `/api/yahoo/v8/finance/chart/${ticker}?interval=${interval}&period1=${startSec}&period2=${endSec}`
    const res = await fetch(url)
    if (!res.ok) return []
    const data = await res.json()
    const result = data.chart?.result?.[0]
    if (!result) return []

    const ts = result.timestamp || []
    const q = result.indicators?.quote?.[0] || {}

    let candles = []
    for (let i = 0; i < ts.length; i++) {
      const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i], v = q.volume?.[i]
      if (c == null || c <= 0) continue
      candles.push({ time: ts[i], open: o || c, high: h || c, low: l || c, close: c, volume: v || 0 })
    }

    // Group into 4H if needed
    if (timeframe === "4H") {
      const grouped = {}
      for (const c of candles) {
        const bucket = Math.floor(c.time / 14400) * 14400
        if (!grouped[bucket]) {
          grouped[bucket] = { ...c, time: bucket }
        } else {
          const g = grouped[bucket]
          g.high = Math.max(g.high, c.high)
          g.low = Math.min(g.low, c.low)
          g.close = c.close
          g.volume += c.volume
        }
      }
      candles = Object.values(grouped)
    }

    candles.sort((a, b) => a.time - b.time)
    const seen = new Set()
    return candles.filter(c => { if (seen.has(c.time)) return false; seen.add(c.time); return true })
  } catch { return [] }
}

export async function fetchCoingeckoCandles(coinId, timeframe = "1H") {
  const count = CANDLE_COUNTS[timeframe] || 720
  const gran = GRANULARITY_MAP[timeframe] || 3600
  const days = Math.ceil((count * gran) / 86400)

  try {
    const url = `/api/coingecko/coins/${coinId}/ohlc?vs_currency=usd&days=${Math.min(days, 365)}`
    const res = await fetch(url)
    if (!res.ok) return []
    const data = await res.json()
    if (!Array.isArray(data)) return []

    let candles = data.map(([ts, o, h, l, c]) => ({
      time: Math.floor(ts / 1000),
      open: o, high: h, low: l, close: c, volume: 0,
    })).filter(c => c.close > 0)

    // CoinGecko OHLC comes in fixed intervals. Group to desired timeframe.
    const bucketSize = GRANULARITY_MAP[timeframe] || 3600
    const grouped = {}
    for (const c of candles) {
      const bucket = Math.floor(c.time / bucketSize) * bucketSize
      if (!grouped[bucket]) {
        grouped[bucket] = { ...c, time: bucket }
      } else {
        const g = grouped[bucket]
        g.high = Math.max(g.high, c.high)
        g.low = Math.min(g.low, c.low)
        g.close = c.close
      }
    }

    candles = Object.values(grouped).sort((a, b) => a.time - b.time)
    const seen = new Set()
    return candles.filter(c => { if (seen.has(c.time)) return false; seen.add(c.time); return true })
  } catch { return [] }
}

// ─── COINBASE PRODUCT MAPPING ───────────────────────────────────────────────

const CB_PRODUCTS = {
  BTC: "BTC-USD", ETH: "ETH-USD", SOL: "SOL-USD", DOGE: "DOGE-USD",
  XRP: "XRP-USD", ADA: "ADA-USD", AVAX: "AVAX-USD", DOT: "DOT-USD",
  LINK: "LINK-USD", NEAR: "NEAR-USD", SUI: "SUI-USD", APT: "APT-USD",
  ARB: "ARB-USD", OP: "OP-USD", MATIC: "MATIC-USD", SEI: "SEI-USD",
  INJ: "INJ-USD", TIA: "TIA-USD", RENDER: "RENDER-USD", HYPE: "HYPE-USD",
  LTC: "LTC-USD", UNI: "UNI-USD", AAVE: "AAVE-USD", ATOM: "ATOM-USD",
  FIL: "FIL-USD", PEPE: "PEPE-USD", SHIB: "SHIB-USD", FET: "FET-USD",
  ZRO: "ZRO-USD",
}

const CG_IDS = {
  BTC: "bitcoin", ETH: "ethereum", SOL: "solana", DOGE: "dogecoin",
  XRP: "ripple", ADA: "cardano", AVAX: "avalanche-2", DOT: "polkadot",
  LINK: "chainlink", NEAR: "near", SUI: "sui", APT: "aptos",
  HYPE: "hyperliquid", ZRO: "layerzero-2",
}

export function parseChartSymbol(symbol) {
  // "COINBASE:BTCUSD" → { exchange, base, quote, productId, ticker }
  const parts = symbol.split(":")
  const exchange = (parts[0] || "").toLowerCase()
  const raw = parts[1] || parts[0] || ""

  if (exchange === "coinbase" || exchange === "phemex") {
    let base = raw
    let quote = "USD"
    if (raw.endsWith("USDT")) { base = raw.slice(0, -4); quote = "USDT" }
    else if (raw.endsWith("USD")) { base = raw.slice(0, -3); quote = "USD" }
    const productId = CB_PRODUCTS[base] || `${base}-${quote}`
    const coingeckoId = CG_IDS[base] || base.toLowerCase()
    return { exchange: "coinbase", base, quote, productId, coingeckoId, ticker: null }
  }

  if (exchange === "nasdaq" || exchange === "nyse" || exchange === "amex") {
    return { exchange: "yahoo", base: raw, quote: "USD", productId: null, coingeckoId: null, ticker: raw }
  }

  // Guess: if it looks like crypto, use coinbase; otherwise yahoo
  if (raw.endsWith("USD") || raw.endsWith("USDT")) {
    const base = raw.replace(/USDT?$/, "")
    const productId = CB_PRODUCTS[base] || `${base}-USD`
    return { exchange: "coinbase", base, quote: "USD", productId, coingeckoId: CG_IDS[base] || base.toLowerCase(), ticker: null }
  }
  return { exchange: "yahoo", base: raw, quote: "USD", productId: null, coingeckoId: null, ticker: raw }
}
