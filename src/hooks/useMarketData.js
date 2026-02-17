/**
 * useMarketData.js — Multi-exchange data fetcher
 * 
 * Routing:
 *   Spot crypto    → Coinbase (api.exchange.coinbase.com)
 *   Perp crypto    → Phemex   (api.phemex.com)
 *   Equities/ETFs  → Yahoo Finance (query1.finance.yahoo.com)
 * 
 * Coinbase klines: 1h granularity grouped into 4h
 * Phemex klines: 4h granularity
 * Yahoo klines: 1h granularity grouped into 4h
 * All requests proxy through Vite dev server to avoid CORS.
 */

// ─── SYMBOL MAPS ────────────────────────────────────────────────────────────

const COINBASE_MAP = {
  BTC: "BTC-USD", ETH: "ETH-USD", SOL: "SOL-USD", DOGE: "DOGE-USD",
  XRP: "XRP-USD", ADA: "ADA-USD", AVAX: "AVAX-USD", DOT: "DOT-USD",
  LINK: "LINK-USD", NEAR: "NEAR-USD", SUI: "SUI-USD", APT: "APT-USD",
  ARB: "ARB-USD", OP: "OP-USD", MATIC: "MATIC-USD", SEI: "SEI-USD",
  INJ: "INJ-USD", TIA: "TIA-USD", RENDER: "RENDER-USD",
  FET: "FET-USD", HYPE: "HYPE-USD", ZRO: "ZRO-USD",
}

const PHEMEX_MAP = {
  BTC: "BTCUSDT", ETH: "ETHUSDT", SOL: "SOLUSDT", DOGE: "DOGEUSDT",
  XRP: "XRPUSDT", ADA: "ADAUSDT", AVAX: "AVAXUSDT", DOT: "DOTUSDT",
  LINK: "LINKUSDT", NEAR: "NEARUSDT", SUI: "SUIUSDT", APT: "APTUSDT",
  ARB: "ARBUSDT", OP: "OPUSDT", SEI: "SEIUSDT", INJ: "INJUSDT",
  TIA: "TIAUSDT", WIF: "WIFUSDT", HYPE: "HYPEUSDT",
  RENDER: "RENDERUSDT", FET: "FETUSDT", TAO: "TAOUSDT",
  CC: "CCUSDT", PEPE: "1000PEPEUSDT", ZRO: "ZROUSDT",
}

// ─── HELPERS ────────────────────────────────────────────────────────────────

export function normalizeSymbol(symbol) {
  return symbol.toUpperCase()
    .replace(/[:/]/g, "")              // strip separators (ZRO:USDT → ZROUSDT, ZRO/USD → ZROUSD)
    .replace(/USDT$/, "")              // strip trailing USDT
    .replace(/USDC$/, "")              // strip trailing USDC
    .replace(/USD$/, "")               // strip trailing USD
    .replace(/PERP$/, "")              // strip trailing PERP
    .trim()
}

export function isCryptoSymbol(symbol) {
  const key = normalizeSymbol(symbol)
  return !!(COINBASE_MAP[key] || PHEMEX_MAP[key])
}

export function isEquitySymbol(symbol) {
  const key = normalizeSymbol(symbol)
  return !COINBASE_MAP[key] && !PHEMEX_MAP[key] && /^[A-Z]{1,5}$/.test(key)
}

/**
 * Returns true if we can fetch live prices + klines for this holding.
 * Covers crypto (Coinbase/Phemex) AND equities (Yahoo Finance).
 */
export function isTrackedSymbol(symbol, type) {
  if (isCryptoSymbol(symbol)) return true
  if (type === "equity") return true
  if (type === "crypto_spot" || type === "crypto_perp") return true
  // Any 1-5 letter ticker is assumed to be an equity we can look up
  const key = normalizeSymbol(symbol)
  if (/^[A-Z]{1,5}$/.test(key)) return true
  return false
}

function resolveExchange(symbol, type, exchange) {
  const key = normalizeSymbol(symbol)
  const isPerp = type === "crypto_perp"
  const isSpot = type === "crypto_spot"

  // If exchange is explicitly set, use it directly
  if (exchange === "coinbase") return { exchange: "coinbase", sym: COINBASE_MAP[key] || `${key}-USD`, key }
  if (exchange === "phemex") return { exchange: "phemex", sym: PHEMEX_MAP[key] || `${key}USDT`, key }
  if (exchange === "nasdaq" || exchange === "nyse" || exchange === "amex") return { exchange: "yahoo", sym: key, key }

  // Fallback: guess from type (backward compat for holdings without exchange field)
  // Crypto perps → Phemex
  if (isPerp && PHEMEX_MAP[key]) return { exchange: "phemex", sym: PHEMEX_MAP[key], key }
  if (isPerp && COINBASE_MAP[key]) return { exchange: "coinbase", sym: COINBASE_MAP[key], key }
  if (isPerp) return { exchange: "phemex", sym: `${key}USDT`, key }

  // Crypto spot → Coinbase
  if (type !== "equity" && COINBASE_MAP[key]) return { exchange: "coinbase", sym: COINBASE_MAP[key], key }
  if (type !== "equity" && PHEMEX_MAP[key]) return { exchange: "phemex", sym: PHEMEX_MAP[key], key }
  if (isSpot) return { exchange: "coinbase", sym: `${key}-USD`, key }

  // Equities → Yahoo Finance
  if (/^[A-Z]{1,5}$/.test(key)) return { exchange: "yahoo", sym: key, key }

  console.warn(`[Resolve] no exchange for symbol="${symbol}" type="${type}" exchange="${exchange}" key="${key}"`)
  return null
}


// ─── COINBASE ───────────────────────────────────────────────────────────────

async function coinbaseTicker(cbSymbol) {
  try {
    const res = await fetch(`/api/coinbase/products/${cbSymbol}/ticker`)
    if (!res.ok) { console.warn(`[CB] ticker ${cbSymbol} → ${res.status}`); return null }
    const data = await res.json()
    return { price: parseFloat(data.price) || 0, change: 0 }
  } catch (e) { console.warn(`[CB] ticker err:`, e.message); return null }
}

async function coinbase24h(cbSymbol) {
  try {
    const res = await fetch(`/api/coinbase/products/${cbSymbol}/stats`)
    if (!res.ok) return 0
    const d = await res.json()
    const open = parseFloat(d.open) || 0, last = parseFloat(d.last) || 0
    return open > 0 ? ((last - open) / open) * 100 : 0
  } catch { return 0 }
}

// Coinbase candles — 1h (3600s), grouped into 4h client-side
async function coinbaseCandles(cbSymbol, startTimeMs) {
  console.log(`[CB] candles 1h ${cbSymbol} from ${new Date(startTimeMs).toISOString().split("T")[0]}`)
  const results = []
  const granularity = 3600
  let endSec = Math.floor(Date.now() / 1000)
  const startSec = Math.floor(startTimeMs / 1000)
  let batch = 0

  while (endSec > startSec && batch < 20) {
    batch++
    const batchStart = Math.max(startSec, endSec - 299 * granularity)
    try {
      const startISO = new Date(batchStart * 1000).toISOString()
      const endISO = new Date(endSec * 1000).toISOString()
      const url = `/api/coinbase/products/${cbSymbol}/candles?granularity=${granularity}&start=${startISO}&end=${endISO}`
      console.log(`[CB] batch ${batch}: ${startISO.slice(0, 16)} → ${endISO.slice(0, 16)}`)
      const res = await fetch(url)
      if (!res.ok) {
        const body = await res.text().catch(() => "")
        console.warn(`[CB] candles ${cbSymbol} batch ${batch} → ${res.status}`, body.slice(0, 200))
        break
      }
      const data = await res.json()
      if (!Array.isArray(data) || data.length === 0) { console.log(`[CB] batch ${batch}: empty`); break }

      console.log(`[CB] batch ${batch}: ${data.length} candles`)
      for (const c of data) {
        if (!Array.isArray(c) || c.length < 5) continue
        const ts = c[0] * 1000
        results.push({ ts, date: new Date(ts).toISOString().slice(0, 13), close: parseFloat(c[4]) })
      }
      endSec = batchStart - granularity
      if (data.length < 250) break
    } catch (e) { console.warn(`[CB] candles err:`, e.message); break }
  }

  // Group 1h into 4h buckets
  const by4h = {}
  for (const r of results) {
    if (r.close <= 0) continue
    const d = new Date(r.ts)
    const h4 = Math.floor(d.getUTCHours() / 4) * 4
    const key = `${d.toISOString().slice(0, 10)}T${String(h4).padStart(2, "0")}`
    if (!by4h[key] || r.ts > by4h[key].ts) by4h[key] = { ...r, date: key }
  }
  const sorted = Object.values(by4h).sort((a, b) => a.ts - b.ts)
  console.log(`[CB] candles ${cbSymbol}: ${results.length} raw 1h → ${sorted.length} 4h bars`)
  return sorted
}


// ─── PHEMEX ─────────────────────────────────────────────────────────────────

async function phemexTicker(phSymbol) {
  try {
    const res = await fetch(`/api/phemex/md/v2/ticker/24hr?symbol=${phSymbol}`)
    if (!res.ok) { console.warn(`[PH] ticker ${phSymbol} → ${res.status}`); return null }
    const data = await res.json()

    console.log(`[PH] ticker raw ${phSymbol}:`, JSON.stringify(data).slice(0, 400))

    const t = data.result || (Array.isArray(data.data) ? data.data[0] : data.data) || data

    // Parse price — Rp fields first (raw price strings), then plain, then Ep (scaled int)
    let price = 0
    for (const f of ["closeRp", "lastPriceRp", "markPriceRp", "indexPriceRp"]) {
      const val = parseFloat(t[f])
      if (val > 0) { price = val; console.log(`[PH] price from ${f}: ${val}`); break }
    }
    if (!price) {
      for (const f of ["lastPrice", "close", "markPrice", "indexPrice"]) {
        const val = parseFloat(t[f])
        if (val > 0) { price = val; break }
      }
    }
    if (!price) {
      for (const f of ["closeEp", "lastPriceEp", "markPriceEp"]) {
        const raw = parseInt(t[f])
        if (raw > 0) {
          price = raw > 1e12 ? raw / 1e8 : raw / 1e4
          if (price > 0) break
        }
      }
    }

    // 24h change
    let change = 0
    const openRp = parseFloat(t.openRp || 0)
    if (openRp > 0 && price > 0) change = ((price - openRp) / openRp) * 100

    console.log(`[PH] ticker ${phSymbol}: $${price} (${change.toFixed(2)}%)`)
    return price > 0 ? { price, change } : null
  } catch (e) { console.warn(`[PH] ticker err:`, e.message); return null }
}

// Phemex klines — 4h (14400s), tries multiple endpoint patterns
async function phemexKlines(phSymbol, startTimeMs, tickerPrice) {
  console.log(`[PH] klines 4h ${phSymbol} from ${new Date(startTimeMs).toISOString().split("T")[0]}`)

  const fromSec = Math.floor(startTimeMs / 1000)
  const toSec = Math.floor(Date.now() / 1000)

  const endpoints = [
    `/api/phemex/exchange/public/md/v2/kline?symbol=${phSymbol}&resolution=14400&from=${fromSec}&to=${toSec}`,
    `/api/phemex/md/v2/kline?symbol=${phSymbol}&resolution=14400&from=${fromSec}&to=${toSec}`,
    `/api/phemex/exchange/public/md/kline?symbol=${phSymbol}&resolution=14400&from=${fromSec}&to=${toSec}`,
    `/api/phemex/md/kline?symbol=${phSymbol}&resolution=14400&from=${fromSec}&to=${toSec}`,
    `/api/phemex/exchange/public/md/v2/kline/last?symbol=${phSymbol}&resolution=14400&from=${fromSec}&to=${toSec}`,
  ]

  for (const url of endpoints) {
    try {
      const shortPath = url.split("/api/phemex")[1]
      console.log(`[PH] trying: ${shortPath}`)
      const res = await fetch(url)
      if (!res.ok) { console.warn(`[PH] ${res.status} for ${shortPath}`); continue }
      const data = await res.json()

      if (data.code !== 0 && data.code !== undefined) { console.warn(`[PH] code=${data.code}`); continue }

      const rows = data.data?.rows || data.data?.klines || data.data || []
      if (!Array.isArray(rows) || rows.length === 0) { console.log(`[PH] no rows`); continue }

      console.log(`[PH] klines ${phSymbol}: ${rows.length} rows, sample:`, JSON.stringify(rows[0]).slice(0, 200))

      let results = []
      if (Array.isArray(rows[0])) {
        console.log(`[PH] row length=${rows[0].length}, types: ${rows[0].map((v, i) => `[${i}]${typeof v}`).join(", ")}`)
        results = rows.map(row => {
          const ts = (row[0] || 0) * 1000
          const close = parseFloat(row[6]) || parseFloat(row[5]) || parseFloat(row[4]) || 0
          return { ts, date: new Date(ts).toISOString().slice(0, 13), close }
        })
      } else {
        results = rows.map(row => {
          const ts = (row.timestamp || row.t || 0) * 1000
          let close = parseFloat(row.closeRp || row.close || row.c || 0)
          if (!close && row.closeEp) {
            const raw = parseInt(row.closeEp)
            close = raw > 1e8 ? raw / 1e4 : raw / 100
          }
          return { ts, date: new Date(ts).toISOString().slice(0, 13), close }
        })
      }

      results = results.filter(r => r.close > 0 && r.ts > 0)
      results.sort((a, b) => a.ts - b.ts)

      if (results.length > 0) {
        console.log(`[PH] klines ${phSymbol}: ✅ ${results.length} valid 4h bars, $${results[0].close} → $${results[results.length - 1].close}`)
        return results
      }
    } catch (e) { console.warn(`[PH] klines err:`, e.message); continue }
  }

  console.warn(`[PH] klines ${phSymbol}: ❌ all endpoints failed`)
  return []
}


// ─── YAHOO FINANCE ──────────────────────────────────────────────────────────

async function yahooQuote(ticker) {
  try {
    // Use chart endpoint with 1d range to get current price + today's change
    const url = `/api/yahoo/v8/finance/chart/${ticker}?interval=1d&range=2d`
    console.log(`[YF] quote ${ticker}`)
    const res = await fetch(url)
    if (!res.ok) { console.warn(`[YF] quote ${ticker} → ${res.status}`); return null }
    const data = await res.json()

    const result = data.chart?.result?.[0]
    if (!result) { console.warn(`[YF] quote ${ticker}: no result`); return null }

    const meta = result.meta || {}
    const price = meta.regularMarketPrice || 0
    const prevClose = meta.chartPreviousClose || meta.previousClose || 0
    const change = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0

    console.log(`[YF] quote ${ticker}: $${price} (${change.toFixed(2)}%)`)
    return price > 0 ? { price, change } : null
  } catch (e) { console.warn(`[YF] quote err:`, e.message); return null }
}

// Yahoo Finance klines — 1h candles, grouped into 4h
async function yahooKlines(ticker, startTimeMs) {
  console.log(`[YF] klines ${ticker} from ${new Date(startTimeMs).toISOString().split("T")[0]}`)
  try {
    const now = Math.floor(Date.now() / 1000)
    const start = Math.floor(startTimeMs / 1000)

    // Yahoo allows max ~730 days for 1h interval
    // Use period1/period2 for exact range
    const url = `/api/yahoo/v8/finance/chart/${ticker}?interval=1h&period1=${start}&period2=${now}`
    console.log(`[YF] fetching: ${ticker} period1=${start} period2=${now}`)
    const res = await fetch(url)
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      console.warn(`[YF] klines ${ticker} → ${res.status}`, body.slice(0, 200))
      return []
    }
    const data = await res.json()

    const result = data.chart?.result?.[0]
    if (!result) { console.warn(`[YF] klines ${ticker}: no result`); return [] }

    const timestamps = result.timestamp || []
    const closes = result.indicators?.quote?.[0]?.close || []

    if (timestamps.length === 0) { console.warn(`[YF] klines ${ticker}: no timestamps`); return [] }

    console.log(`[YF] klines ${ticker}: ${timestamps.length} raw 1h candles`)

    // Build raw candles
    const raw = []
    for (let i = 0; i < timestamps.length; i++) {
      const close = closes[i]
      if (close == null || close <= 0) continue
      const ts = timestamps[i] * 1000
      raw.push({
        ts,
        date: new Date(ts).toISOString().slice(0, 13),
        close,
      })
    }

    // Group 1h into 4h buckets
    const by4h = {}
    for (const r of raw) {
      const d = new Date(r.ts)
      const h4 = Math.floor(d.getUTCHours() / 4) * 4
      const key = `${d.toISOString().slice(0, 10)}T${String(h4).padStart(2, "0")}`
      if (!by4h[key] || r.ts > by4h[key].ts) by4h[key] = { ...r, date: key }
    }

    const sorted = Object.values(by4h).sort((a, b) => a.ts - b.ts)
    console.log(`[YF] klines ${ticker}: ${raw.length} raw 1h → ${sorted.length} 4h bars, $${sorted[0]?.close} → $${sorted[sorted.length - 1]?.close}`)
    return sorted
  } catch (e) { console.warn(`[YF] klines err:`, e.message); return [] }
}


// ─── PUBLIC API ─────────────────────────────────────────────────────────────

/**
 * Fetch live prices for a list of holdings.
 * Returns: { [normalizedKey]: { price, change } }
 */
export async function fetchTickers(holdings) {
  const results = {}
  const seen = new Set()
  const tasks = []

  for (const h of holdings) {
    const resolved = resolveExchange(h.symbol, h.type, h.exchange)
    if (!resolved || seen.has(resolved.key)) continue
    seen.add(resolved.key)
    console.log(`[Ticker] ${h.symbol}(${h.type}/${h.exchange || "auto"}) → ${resolved.exchange}:${resolved.sym}`)

    tasks.push((async () => {
      let data = null

      if (resolved.exchange === "coinbase") {
        data = await coinbaseTicker(resolved.sym)
        if (data) data.change = await coinbase24h(resolved.sym)
      } else if (resolved.exchange === "phemex") {
        data = await phemexTicker(resolved.sym)
      } else if (resolved.exchange === "yahoo") {
        data = await yahooQuote(resolved.sym)
      }

      if (data && data.price > 0) results[resolved.key] = data
    })())
  }

  for (let i = 0; i < tasks.length; i += 4) await Promise.all(tasks.slice(i, i + 4))
  return results
}

/**
 * Fetch historical 4h klines for holdings.
 * Each request: { symbol, type, startTime (ms) }
 * Returns: { [normalizedKey]: [{ ts, date, close }] }
 */
export async function fetchAllKlines(requests) {
  const results = {}
  const seen = new Set()
  const tasks = []

  console.log(`[Klines] ── Starting with ${requests.length} requests:`, requests.map(r => `${r.symbol}(${r.type})`).join(", "))

  for (const req of requests) {
    const resolved = resolveExchange(req.symbol, req.type, req.exchange)
    console.log(`[Klines] resolve ${req.symbol} (type=${req.type}, exchange=${req.exchange || "auto"}) →`, resolved ? `${resolved.exchange}:${resolved.sym}` : "NULL")
    if (!resolved || seen.has(resolved.key)) continue
    seen.add(resolved.key)

    tasks.push((async () => {
      let klines = []
      console.log(`[Klines] ${resolved.key} → ${resolved.exchange}:${resolved.sym}`)

      if (resolved.exchange === "coinbase") {
        klines = await coinbaseCandles(resolved.sym, req.startTime)
      } else if (resolved.exchange === "phemex") {
        const ticker = await phemexTicker(resolved.sym)
        klines = await phemexKlines(resolved.sym, req.startTime, ticker?.price || 0)
      } else if (resolved.exchange === "yahoo") {
        klines = await yahooKlines(resolved.sym, req.startTime)
      }

      if (klines.length > 0) {
        console.log(`[Klines] ${resolved.key}: ✅ ${klines.length} bars`)
        results[resolved.key] = klines
      } else {
        console.warn(`[Klines] ${resolved.key}: ❌ no data`)
      }
    })())
  }

  for (let i = 0; i < tasks.length; i += 3) await Promise.all(tasks.slice(i, i + 3))
  console.log(`[Klines] Done:`, Object.keys(results).map(k => `${k}(${results[k].length})`).join(", "))
  return results
}
