/**
 * liveData.js — Shared WebSocket manager + REST candle fetchers
 *
 * Data source priority (crypto):
 *   1. Coinbase Exchange (WebSocket live, REST candles)
 *   2. Phemex (REST polling 5s, REST candles) — for perps/tokens not on CB
 *   3. CoinGecko (REST OHLC fallback) — last resort
 *
 * Equities: Yahoo Finance REST polling (15s)
 */

// ─── SYMBOL MAPS ────────────────────────────────────────────────────────────

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

const PH_PRODUCTS = {
  BTC: "BTCUSDT", ETH: "ETHUSDT", SOL: "SOLUSDT", DOGE: "DOGEUSDT",
  XRP: "XRPUSDT", ADA: "ADAUSDT", AVAX: "AVAXUSDT", DOT: "DOTUSDT",
  LINK: "LINKUSDT", NEAR: "NEARUSDT", SUI: "SUIUSDT", APT: "APTUSDT",
  ARB: "ARBUSDT", OP: "OPUSDT", SEI: "SEIUSDT", INJ: "INJUSDT",
  TIA: "TIAUSDT", WIF: "WIFUSDT", HYPE: "HYPEUSDT",
  RENDER: "RENDERUSDT", FET: "FETUSDT", TAO: "TAOUSDT",
  CC: "CCUSDT", PEPE: "1000PEPEUSDT", ZRO: "ZROUSDT",
}

const CG_IDS = {
  BTC: "bitcoin", ETH: "ethereum", SOL: "solana", DOGE: "dogecoin",
  XRP: "ripple", ADA: "cardano", AVAX: "avalanche-2", DOT: "polkadot",
  LINK: "chainlink", NEAR: "near", SUI: "sui", APT: "aptos",
  HYPE: "hyperliquid", ZRO: "layerzero-2", CC: "cross-the-ages",
  RENDER: "render-token", FET: "artificial-superintelligence-alliance",
  INJ: "injective-protocol", TIA: "celestia", ARB: "arbitrum",
}

// ─── PARSE CHART SYMBOL ─────────────────────────────────────────────────────

export function parseChartSymbol(symbol) {
  const parts = symbol.split(":")
  const exchangeHint = (parts[0] || "").toLowerCase()
  const raw = (parts[1] || parts[0] || "").toUpperCase()

  // Extract base ticker from raw
  let base = raw
  if (raw.endsWith("USDT")) base = raw.slice(0, -4)
  else if (raw.endsWith("USD")) base = raw.slice(0, -3)

  // Explicit exchange hints
  if (exchangeHint === "nasdaq" || exchangeHint === "nyse" || exchangeHint === "amex") {
    return { exchange: "yahoo", base: raw, quote: "USD", cbProduct: null, phProduct: null, coingeckoId: null, ticker: raw }
  }

  if (exchangeHint === "phemex") {
    const phProduct = PH_PRODUCTS[base] || `${base}USDT`
    const cbProduct = CB_PRODUCTS[base] || null
    return { exchange: "phemex", base, quote: "USDT", cbProduct, phProduct, coingeckoId: CG_IDS[base] || base.toLowerCase(), ticker: null }
  }

  if (exchangeHint === "coinbase") {
    const cbProduct = CB_PRODUCTS[base] || `${base}-USD`
    const phProduct = PH_PRODUCTS[base] || null
    return { exchange: "coinbase", base, quote: "USD", cbProduct, phProduct, coingeckoId: CG_IDS[base] || base.toLowerCase(), ticker: null }
  }

  // Auto-detect: equity vs crypto
  const isCrypto = raw.endsWith("USD") || raw.endsWith("USDT") || CB_PRODUCTS[base] || PH_PRODUCTS[base] || CG_IDS[base]

  if (!isCrypto) {
    // Looks like an equity ticker
    return { exchange: "yahoo", base: raw, quote: "USD", cbProduct: null, phProduct: null, coingeckoId: null, ticker: raw }
  }

  // Crypto: determine primary exchange
  const cbProduct = CB_PRODUCTS[base] || null
  const phProduct = PH_PRODUCTS[base] || `${base}USDT`
  const coingeckoId = CG_IDS[base] || base.toLowerCase()

  if (cbProduct) {
    return { exchange: "coinbase", base, quote: "USD", cbProduct, phProduct, coingeckoId, ticker: null }
  }
  // Not on Coinbase → Phemex primary
  return { exchange: "phemex", base, quote: "USDT", cbProduct: null, phProduct, coingeckoId, ticker: null }
}


// ─── COINBASE WEBSOCKET (SHARED) ────────────────────────────────────────────

let cbWs = null
let cbReady = false
let cbAttempts = 0
let cbReconnectTimer = null
const cbSubscribers = new Map()

function cbConnect() {
  if (cbWs && (cbWs.readyState === WebSocket.CONNECTING || cbWs.readyState === WebSocket.OPEN)) return

  try {
    cbWs = new WebSocket("wss://ws-feed.exchange.coinbase.com")
  } catch (e) {
    console.warn("[CB-WS] Failed to create WebSocket:", e.message)
    cbScheduleReconnect()
    return
  }

  cbWs.onopen = () => {
    cbReady = true
    cbAttempts = 0
    console.log("[CB-WS] Connected")
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
    console.log("[CB-WS] Disconnected")
    cbScheduleReconnect()
  }

  cbWs.onerror = () => { cbReady = false }
}

function cbScheduleReconnect() {
  if (cbReconnectTimer) return
  if (cbSubscribers.size === 0) return
  const delay = Math.min(1000 * Math.pow(2, cbAttempts), 30000)
  cbAttempts++
  cbReconnectTimer = setTimeout(() => { cbReconnectTimer = null; cbConnect() }, delay)
}

export function subscribeCoinbase(productId, callback) {
  if (!cbSubscribers.has(productId)) cbSubscribers.set(productId, new Set())
  cbSubscribers.get(productId).add(callback)

  if (!cbWs || cbWs.readyState === WebSocket.CLOSED) cbConnect()
  else if (cbReady) cbWs.send(JSON.stringify({ type: "subscribe", product_ids: [productId], channels: ["ticker"] }))

  return () => {
    const subs = cbSubscribers.get(productId)
    if (subs) {
      subs.delete(callback)
      if (subs.size === 0) {
        cbSubscribers.delete(productId)
        if (cbReady && cbWs) try { cbWs.send(JSON.stringify({ type: "unsubscribe", product_ids: [productId], channels: ["ticker"] })) } catch {}
      }
    }
    if (cbSubscribers.size === 0 && cbWs) { try { cbWs.close() } catch {}; cbWs = null; cbReady = false }
  }
}


// ─── PHEMEX REST POLLING ────────────────────────────────────────────────────

export function subscribePhemex(phSymbol, callback, intervalMs = 5000) {
  let active = true

  async function poll() {
    if (!active) return
    try {
      const res = await fetch(`/api/phemex/md/v2/ticker/24hr?symbol=${phSymbol}`)
      if (!res.ok) return
      const data = await res.json()
      const t = data.result || (Array.isArray(data.data) ? data.data[0] : data.data) || data

      // Parse price — Rp fields first, then plain, then Ep (scaled int)
      let price = 0
      for (const f of ["closeRp", "lastPriceRp", "markPriceRp", "indexPriceRp"]) {
        const val = parseFloat(t[f]); if (val > 0) { price = val; break }
      }
      if (!price) {
        for (const f of ["lastPrice", "close", "markPrice", "indexPrice"]) {
          const val = parseFloat(t[f]); if (val > 0) { price = val; break }
        }
      }
      if (!price) {
        for (const f of ["closeEp", "lastPriceEp", "markPriceEp"]) {
          const raw = parseInt(t[f])
          if (raw > 0) { price = raw > 1e12 ? raw / 1e8 : raw / 1e4; if (price > 0) break }
        }
      }

      if (price <= 0) return

      // 24h change
      let change = 0
      const openRp = parseFloat(t.openRp || 0)
      if (openRp > 0) change = ((price - openRp) / openRp) * 100

      // Volume
      const vol = parseFloat(t.volumeRq || t.turnoverRv || t.volume || 0)

      // High/low
      const high = parseFloat(t.highRp || t.high || 0) || price
      const low = parseFloat(t.lowRp || t.low || 0) || price

      callback({
        price, open24h: openRp || price, high, low, volume: vol,
        change, time: Date.now(),
        product_id: phSymbol,
      })
    } catch (e) { console.warn("[PH] poll error:", e.message) }
  }

  poll()
  const timer = setInterval(poll, intervalMs)
  return () => { active = false; clearInterval(timer) }
}


// ─── YAHOO REST POLLING ─────────────────────────────────────────────────────

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
    } catch (e) { console.warn("[YF] poll error:", e.message) }
  }

  poll()
  const timer = setInterval(poll, intervalMs)
  return () => { active = false; clearInterval(timer) }
}


// ─── HISTORICAL CANDLE FETCHERS ─────────────────────────────────────────────

const GRANULARITY_MAP = { "1m": 60, "5m": 300, "15m": 900, "1H": 3600, "4H": 14400, "1D": 86400 }
const CANDLE_COUNTS = { "1m": 360, "5m": 288, "15m": 288, "1H": 720, "4H": 540, "1D": 365 }

// ─── Coinbase Candles ───

export async function fetchCoinbaseCandles(productId, timeframe = "1H") {
  const granularity = GRANULARITY_MAP[timeframe] || 3600
  const count = CANDLE_COUNTS[timeframe] || 720
  const endSec = Math.floor(Date.now() / 1000)
  const startSec = endSec - count * granularity
  const results = []

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

  if (timeframe === "4H") {
    const grouped = {}
    for (const c of candles) {
      const bucket = Math.floor(c.time / 14400) * 14400
      if (!grouped[bucket]) grouped[bucket] = { time: bucket, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume }
      else { const g = grouped[bucket]; g.high = Math.max(g.high, c.high); g.low = Math.min(g.low, c.low); g.close = c.close; g.volume += c.volume }
    }
    candles = Object.values(grouped).sort((a, b) => a.time - b.time)
  }

  const seen = new Set()
  return candles.filter(c => { if (seen.has(c.time)) return false; seen.add(c.time); return true })
}

// ─── Phemex Candles ───

export async function fetchPhemexCandles(phSymbol, timeframe = "1H") {
  const resSec = GRANULARITY_MAP[timeframe] || 3600
  const count = CANDLE_COUNTS[timeframe] || 720
  const toSec = Math.floor(Date.now() / 1000)
  const fromSec = toSec - count * resSec

  // Phemex kline endpoints — try multiple patterns
  const endpoints = [
    `/api/phemex/exchange/public/md/v2/kline?symbol=${phSymbol}&resolution=${resSec}&from=${fromSec}&to=${toSec}`,
    `/api/phemex/md/v2/kline?symbol=${phSymbol}&resolution=${resSec}&from=${fromSec}&to=${toSec}`,
    `/api/phemex/exchange/public/md/kline?symbol=${phSymbol}&resolution=${resSec}&from=${fromSec}&to=${toSec}`,
    `/api/phemex/md/kline?symbol=${phSymbol}&resolution=${resSec}&from=${fromSec}&to=${toSec}`,
  ]

  for (const url of endpoints) {
    try {
      const res = await fetch(url)
      if (!res.ok) continue
      const data = await res.json()
      if (data.code !== 0 && data.code !== undefined) continue

      const rows = data.data?.rows || data.data?.klines || data.data || []
      if (!Array.isArray(rows) || rows.length === 0) continue

      let results = []
      if (Array.isArray(rows[0])) {
        // Array format: [timestamp, interval, open, high, low, close, volume, ...]
        results = rows.map(row => {
          const ts = (row[0] || 0)
          const open = parseFloat(row[3]) || parseFloat(row[2]) || 0
          const high = parseFloat(row[4]) || parseFloat(row[3]) || 0
          const low = parseFloat(row[5]) || parseFloat(row[4]) || 0
          const close = parseFloat(row[6]) || parseFloat(row[5]) || parseFloat(row[4]) || 0
          const volume = parseFloat(row[7]) || 0
          return { time: ts, open: open || close, high: high || close, low: low || close, close, volume }
        })
      } else {
        // Object format
        results = rows.map(row => {
          const ts = row.timestamp || row.t || 0
          let close = parseFloat(row.closeRp || row.close || row.c || 0)
          let open = parseFloat(row.openRp || row.open || row.o || 0) || close
          let high = parseFloat(row.highRp || row.high || row.h || 0) || close
          let low = parseFloat(row.lowRp || row.low || row.l || 0) || close
          const volume = parseFloat(row.volumeRq || row.volume || row.v || 0)
          // Handle Ep fields
          if (!close && row.closeEp) { const raw = parseInt(row.closeEp); close = raw > 1e8 ? raw / 1e4 : raw / 100 }
          return { time: ts, open, high, low, close, volume }
        })
      }

      results = results.filter(r => r.close > 0 && r.time > 0).sort((a, b) => a.time - b.time)
      if (results.length > 0) {
        const seen = new Set()
        return results.filter(c => { if (seen.has(c.time)) return false; seen.add(c.time); return true })
      }
    } catch { continue }
  }
  return []
}

// ─── Yahoo Candles ───

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

    if (timeframe === "4H") {
      const grouped = {}
      for (const c of candles) {
        const bucket = Math.floor(c.time / 14400) * 14400
        if (!grouped[bucket]) grouped[bucket] = { ...c, time: bucket }
        else { const g = grouped[bucket]; g.high = Math.max(g.high, c.high); g.low = Math.min(g.low, c.low); g.close = c.close; g.volume += c.volume }
      }
      candles = Object.values(grouped)
    }

    candles.sort((a, b) => a.time - b.time)
    const seen = new Set()
    return candles.filter(c => { if (seen.has(c.time)) return false; seen.add(c.time); return true })
  } catch { return [] }
}

// ─── CoinGecko Candles (fallback) ───

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
      time: Math.floor(ts / 1000), open: o, high: h, low: l, close: c, volume: 0,
    })).filter(c => c.close > 0)

    const bucketSize = GRANULARITY_MAP[timeframe] || 3600
    const grouped = {}
    for (const c of candles) {
      const bucket = Math.floor(c.time / bucketSize) * bucketSize
      if (!grouped[bucket]) grouped[bucket] = { ...c, time: bucket }
      else { const g = grouped[bucket]; g.high = Math.max(g.high, c.high); g.low = Math.min(g.low, c.low); g.close = c.close }
    }

    candles = Object.values(grouped).sort((a, b) => a.time - b.time)
    const seen = new Set()
    return candles.filter(c => { if (seen.has(c.time)) return false; seen.add(c.time); return true })
  } catch { return [] }
}
