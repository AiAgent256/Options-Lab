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

// ─── SYMBOL ALIASES ────────────────────────────────────────────────────────
// Map common names / misspellings / full names → canonical tickers
const SYMBOL_ALIASES = {
  LAYERZERO: "ZRO", BITCOIN: "BTC", ETHEREUM: "ETH", SOLANA: "SOL",
  DOGECOIN: "DOGE", RIPPLE: "XRP", CARDANO: "ADA", POLKADOT: "DOT",
  CHAINLINK: "LINK", AVALANCHE: "AVAX", COSMOS: "ATOM", POLYGON: "MATIC",
  ARBITRUM: "ARB", OPTIMISM: "OP", CELESTIA: "TIA", INJECTIVE: "INJ",
  RENDERTOKEN: "RENDER", HYPERLIQUID: "HYPE", APTOS: "APT",
  LITECOIN: "LTC", UNISWAP: "UNI",
  MICROSTRATEGY: "MSTR", STRATEGY: "MSTR", TESLA: "TSLA", APPLE: "AAPL",
  NVIDIA: "NVDA", NUSCALE: "SMR",
}

// ─── SYMBOL MAPS ────────────────────────────────────────────────────────────
// Known-good product IDs on each exchange's API.
// If a symbol is NOT here, we still try the standard format,
// then fall back to CoinGecko (crypto) or Yahoo Finance (equities) if the exchange 404s.

const COINBASE_MAP = {
  BTC: "BTC-USD", ETH: "ETH-USD", SOL: "SOL-USD", DOGE: "DOGE-USD",
  XRP: "XRP-USD", ADA: "ADA-USD", AVAX: "AVAX-USD", DOT: "DOT-USD",
  LINK: "LINK-USD", NEAR: "NEAR-USD", SUI: "SUI-USD", APT: "APT-USD",
  ARB: "ARB-USD", OP: "OP-USD", MATIC: "MATIC-USD", SEI: "SEI-USD",
  INJ: "INJ-USD", TIA: "TIA-USD", RENDER: "RENDER-USD",
  FET: "FET-USD", HYPE: "HYPE-USD",
  // NOTE: ZRO removed — it's on Coinbase retail but NOT on their Exchange API
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

// ─── COINGECKO FALLBACK ────────────────────────────────────────────────────
// CoinGecko free API: no auth, ~30 req/min, comprehensive crypto coverage.
// Used as fallback when Coinbase Exchange API / Phemex don't list a token.
// Map: ticker symbol → CoinGecko coin ID
const COINGECKO_ID_MAP = {
  BTC: "bitcoin", ETH: "ethereum", SOL: "solana", DOGE: "dogecoin",
  XRP: "ripple", ADA: "cardano", AVAX: "avalanche-2", DOT: "polkadot",
  LINK: "chainlink", NEAR: "near", SUI: "sui", APT: "aptos",
  ARB: "arbitrum", OP: "optimism", MATIC: "matic-network", SEI: "sei-network",
  INJ: "injective-protocol", TIA: "celestia", RENDER: "render-token",
  FET: "artificial-superintelligence-alliance", HYPE: "hyperliquid",
  WIF: "dogwifcoin", TAO: "bittensor",
  ZRO: "layerzero", PEPE: "pepe",
  ATOM: "cosmos", UNI: "uniswap", LTC: "litecoin",
}

function coingeckoId(key) {
  return COINGECKO_ID_MAP[key] || key.toLowerCase()
}

async function coingeckoQuote(key) {
  const id = coingeckoId(key)
  try {
    const url = `/api/coingecko/simple/price?ids=${id}&vs_currencies=usd&include_24hr_change=true`
    if(import.meta.env.DEV) console.log(`[CG] quote ${key} → ${id}`)
    const res = await fetch(url)
    if (!res.ok) { if(import.meta.env.DEV) console.warn(`[CG] quote ${key} → ${res.status}`); return null }
    const data = await res.json()
    const entry = data[id]
    if (!entry || !entry.usd) { if(import.meta.env.DEV) console.warn(`[CG] quote ${key}: no data`); return null }
    if(import.meta.env.DEV) console.log(`[CG] quote ${key}: $${entry.usd} (${(entry.usd_24h_change || 0).toFixed(2)}%)`)
    return { price: entry.usd, change: entry.usd_24h_change || 0 }
  } catch (e) { if(import.meta.env.DEV) console.warn(`[CG] quote err:`, e.message); return null }
}

async function coingeckoKlines(key, startTimeMs) {
  const id = coingeckoId(key)
  const days = Math.ceil((Date.now() - startTimeMs) / (1000 * 60 * 60 * 24))
  try {
    // CoinGecko: days <= 90 → hourly granularity, > 90 → daily
    const url = `/api/coingecko/coins/${id}/market_chart?vs_currency=usd&days=${Math.min(days, 365)}`
    if(import.meta.env.DEV) console.log(`[CG] klines ${key} → ${id} (${days}d)`)
    const res = await fetch(url)
    if (!res.ok) { if(import.meta.env.DEV) console.warn(`[CG] klines ${key} → ${res.status}`); return [] }
    const data = await res.json()
    const prices = data.prices || []
    if (prices.length === 0) { if(import.meta.env.DEV) console.warn(`[CG] klines ${key}: no prices`); return [] }

    if(import.meta.env.DEV) console.log(`[CG] klines ${key}: ${prices.length} raw points`)

    // Group into 4h buckets (same approach as Yahoo)
    const by4h = {}
    for (const [ts, close] of prices) {
      if (!close || close <= 0) continue
      const bucket = Math.floor(ts / (4 * 3600 * 1000)) * (4 * 3600 * 1000)
      by4h[bucket] = { ts: bucket, date: new Date(bucket).toISOString().slice(0, 13), close }
    }
    const klines = Object.values(by4h).sort((a, b) => a.ts - b.ts)
    if(import.meta.env.DEV) console.log(`[CG] klines ${key}: ${klines.length} 4h bars`)
    return klines
  } catch (e) { if(import.meta.env.DEV) console.warn(`[CG] klines err:`, e.message); return [] }
}

// ─── HELPERS ────────────────────────────────────────────────────────────────

export function normalizeSymbol(symbol) {
  let s = symbol.toUpperCase()
    .replace(/[:/\-]/g, "")            // strip separators (ZRO:USDT, ZRO/USD, ZRO-USD)
    .replace(/USDT$/, "")              // strip trailing USDT
    .replace(/USDC$/, "")              // strip trailing USDC
    .replace(/USD$/, "")               // strip trailing USD
    .replace(/PERP$/, "")              // strip trailing PERP
    .trim()
  // Apply aliases: LAYERZERO → ZRO, BITCOIN → BTC, etc.
  return SYMBOL_ALIASES[s] || s
}

export function isCryptoSymbol(symbol) {
  const key = normalizeSymbol(symbol)
  return !!(COINBASE_MAP[key] || PHEMEX_MAP[key] || COINGECKO_ID_MAP[key])
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
  if (exchange === "coingecko") return { exchange: "coingecko", sym: coingeckoId(key), key }
  if (exchange === "nasdaq" || exchange === "nyse" || exchange === "amex") return { exchange: "yahoo", sym: key, key }

  // Fallback: guess from type (backward compat for holdings without exchange field)
  // Crypto perps → Phemex
  if (isPerp && PHEMEX_MAP[key]) return { exchange: "phemex", sym: PHEMEX_MAP[key], key }
  if (isPerp && COINBASE_MAP[key]) return { exchange: "coinbase", sym: COINBASE_MAP[key], key }
  if (isPerp) return { exchange: "phemex", sym: `${key}USDT`, key }

  // Crypto spot → Coinbase, then CoinGecko for tokens not on major exchanges
  if (type !== "equity" && COINBASE_MAP[key]) return { exchange: "coinbase", sym: COINBASE_MAP[key], key }
  if (type !== "equity" && PHEMEX_MAP[key]) return { exchange: "phemex", sym: PHEMEX_MAP[key], key }
  if (type !== "equity" && COINGECKO_ID_MAP[key]) return { exchange: "coingecko", sym: coingeckoId(key), key }
  if (isSpot && COINGECKO_ID_MAP[key]) return { exchange: "coingecko", sym: coingeckoId(key), key }
  if (isSpot) return { exchange: "coinbase", sym: `${key}-USD`, key }

  // Equities → Yahoo Finance
  if (/^[A-Z]{1,5}$/.test(key)) return { exchange: "yahoo", sym: key, key }

  if(import.meta.env.DEV) console.warn(`[Resolve] no exchange for symbol="${symbol}" type="${type}" exchange="${exchange}" key="${key}"`)
  return null
}


// ─── COINBASE ───────────────────────────────────────────────────────────────

async function coinbaseTicker(cbSymbol) {
  try {
    const res = await fetch(`/api/coinbase/products/${cbSymbol}/ticker`)
    if (!res.ok) { if(import.meta.env.DEV) console.warn(`[CB] ticker ${cbSymbol} → ${res.status}`); return null }
    const data = await res.json()
    return { price: parseFloat(data.price) || 0, change: 0 }
  } catch (e) { if(import.meta.env.DEV) console.warn(`[CB] ticker err:`, e.message); return null }
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
  if(import.meta.env.DEV) console.log(`[CB] candles 1h ${cbSymbol} from ${new Date(startTimeMs).toISOString().split("T")[0]}`)
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
      if(import.meta.env.DEV) console.log(`[CB] batch ${batch}: ${startISO.slice(0, 16)} → ${endISO.slice(0, 16)}`)
      const res = await fetch(url)
      if (!res.ok) {
        const body = await res.text().catch(() => "")
        if(import.meta.env.DEV) console.warn(`[CB] candles ${cbSymbol} batch ${batch} → ${res.status}`, body.slice(0, 200))
        break
      }
      const data = await res.json()
      if (!Array.isArray(data) || data.length === 0) { if(import.meta.env.DEV) console.log(`[CB] batch ${batch}: empty`); break }

      if(import.meta.env.DEV) console.log(`[CB] batch ${batch}: ${data.length} candles`)
      for (const c of data) {
        if (!Array.isArray(c) || c.length < 5) continue
        const ts = c[0] * 1000
        results.push({ ts, date: new Date(ts).toISOString().slice(0, 13), close: parseFloat(c[4]) })
      }
      endSec = batchStart - granularity
      if (data.length < 250) break
    } catch (e) { if(import.meta.env.DEV) console.warn(`[CB] candles err:`, e.message); break }
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
  if(import.meta.env.DEV) console.log(`[CB] candles ${cbSymbol}: ${results.length} raw 1h → ${sorted.length} 4h bars`)
  return sorted
}


// ─── PHEMEX ─────────────────────────────────────────────────────────────────

async function phemexTicker(phSymbol) {
  try {
    const res = await fetch(`/api/phemex/md/v2/ticker/24hr?symbol=${phSymbol}`)
    if (!res.ok) { if(import.meta.env.DEV) console.warn(`[PH] ticker ${phSymbol} → ${res.status}`); return null }
    const data = await res.json()

    if(import.meta.env.DEV) console.log(`[PH] ticker raw ${phSymbol}:`, JSON.stringify(data).slice(0, 400))

    const t = data.result || (Array.isArray(data.data) ? data.data[0] : data.data) || data

    // Parse price — Rp fields first (raw price strings), then plain, then Ep (scaled int)
    let price = 0
    for (const f of ["closeRp", "lastPriceRp", "markPriceRp", "indexPriceRp"]) {
      const val = parseFloat(t[f])
      if (val > 0) { price = val; if(import.meta.env.DEV) console.log(`[PH] price from ${f}: ${val}`); break }
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

    if(import.meta.env.DEV) console.log(`[PH] ticker ${phSymbol}: $${price} (${change.toFixed(2)}%)`)
    return price > 0 ? { price, change } : null
  } catch (e) { if(import.meta.env.DEV) console.warn(`[PH] ticker err:`, e.message); return null }
}

// Phemex klines — 4h (14400s), tries multiple endpoint patterns
async function phemexKlines(phSymbol, startTimeMs, tickerPrice) {
  if(import.meta.env.DEV) console.log(`[PH] klines 4h ${phSymbol} from ${new Date(startTimeMs).toISOString().split("T")[0]}`)

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
      if(import.meta.env.DEV) console.log(`[PH] trying: ${shortPath}`)
      const res = await fetch(url)
      if (!res.ok) { if(import.meta.env.DEV) console.warn(`[PH] ${res.status} for ${shortPath}`); continue }
      const data = await res.json()

      if (data.code !== 0 && data.code !== undefined) { if(import.meta.env.DEV) console.warn(`[PH] code=${data.code}`); continue }

      const rows = data.data?.rows || data.data?.klines || data.data || []
      if (!Array.isArray(rows) || rows.length === 0) { if(import.meta.env.DEV) console.log(`[PH] no rows`); continue }

      if(import.meta.env.DEV) console.log(`[PH] klines ${phSymbol}: ${rows.length} rows, sample:`, JSON.stringify(rows[0]).slice(0, 200))

      let results = []
      if (Array.isArray(rows[0])) {
        if(import.meta.env.DEV) console.log(`[PH] row length=${rows[0].length}, types: ${rows[0].map((v, i) => `[${i}]${typeof v}`).join(", ")}`)
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
        if(import.meta.env.DEV) console.log(`[PH] klines ${phSymbol}: ✅ ${results.length} valid 4h bars, $${results[0].close} → $${results[results.length - 1].close}`)
        return results
      }
    } catch (e) { if(import.meta.env.DEV) console.warn(`[PH] klines err:`, e.message); continue }
  }

  if(import.meta.env.DEV) console.warn(`[PH] klines ${phSymbol}: ❌ all endpoints failed`)
  return []
}


// ─── YAHOO FINANCE ──────────────────────────────────────────────────────────

async function yahooQuote(ticker) {
  try {
    // v7/finance/quote — lighter endpoint, less rate-limited than v8/chart
    const v7url = `/api/yahoo/v7/finance/quote?symbols=${ticker}&fields=regularMarketPrice,regularMarketChangePercent,regularMarketPreviousClose`
    if(import.meta.env.DEV) console.log(`[YF] v7 quote ${ticker}`)
    const r7 = await fetch(v7url)
    if (r7.ok) {
      const d7 = await r7.json()
      const q = d7.quoteResponse?.result?.[0]
      if (q && q.regularMarketPrice > 0) {
        const price = q.regularMarketPrice
        const change = q.regularMarketChangePercent || 0
        if(import.meta.env.DEV) console.log(`[YF] v7 quote ${ticker}: $${price} (${change.toFixed(2)}%)`)
        return { price, change }
      }
    }
    if(import.meta.env.DEV) console.warn(`[YF] v7 quote ${ticker} → ${r7.status}, falling back to v8 chart`)

    // Fallback: v8/finance/chart with 2d range
    const url = `/api/yahoo/v8/finance/chart/${ticker}?interval=1d&range=2d`
    const res = await fetch(url)
    if (!res.ok) { if(import.meta.env.DEV) console.warn(`[YF] quote ${ticker} → ${res.status}`); return null }
    const data = await res.json()

    const result = data.chart?.result?.[0]
    if (!result) { if(import.meta.env.DEV) console.warn(`[YF] quote ${ticker}: no result`); return null }

    const meta = result.meta || {}
    const price = meta.regularMarketPrice || 0
    const prevClose = meta.chartPreviousClose || meta.previousClose || 0
    const change = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0

    if(import.meta.env.DEV) console.log(`[YF] v8 quote ${ticker}: $${price} (${change.toFixed(2)}%)`)
    return price > 0 ? { price, change } : null
  } catch (e) { if(import.meta.env.DEV) console.warn(`[YF] quote err:`, e.message); return null }
}

// Yahoo Finance klines — 1h candles, grouped into 4h
async function yahooKlines(ticker, startTimeMs) {
  if(import.meta.env.DEV) console.log(`[YF] klines ${ticker} from ${new Date(startTimeMs).toISOString().split("T")[0]}`)
  try {
    const now = Math.floor(Date.now() / 1000)
    const start = Math.floor(startTimeMs / 1000)

    // Yahoo allows max ~730 days for 1h interval
    // Use period1/period2 for exact range
    const url = `/api/yahoo/v8/finance/chart/${ticker}?interval=1h&period1=${start}&period2=${now}`
    if(import.meta.env.DEV) console.log(`[YF] fetching: ${ticker} period1=${start} period2=${now}`)
    const res = await fetch(url)
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      if(import.meta.env.DEV) console.warn(`[YF] klines ${ticker} → ${res.status}`, body.slice(0, 200))
      return []
    }
    const data = await res.json()

    const result = data.chart?.result?.[0]
    if (!result) { if(import.meta.env.DEV) console.warn(`[YF] klines ${ticker}: no result`); return [] }

    const timestamps = result.timestamp || []
    const closes = result.indicators?.quote?.[0]?.close || []

    if (timestamps.length === 0) { if(import.meta.env.DEV) console.warn(`[YF] klines ${ticker}: no timestamps`); return [] }

    if(import.meta.env.DEV) console.log(`[YF] klines ${ticker}: ${timestamps.length} raw 1h candles`)

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
    if(import.meta.env.DEV) console.log(`[YF] klines ${ticker}: ${raw.length} raw 1h → ${sorted.length} 4h bars, $${sorted[0]?.close} → $${sorted[sorted.length - 1]?.close}`)
    return sorted
  } catch (e) { if(import.meta.env.DEV) console.warn(`[YF] klines err:`, e.message); return [] }
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
    if(import.meta.env.DEV) console.log(`[Ticker] ${h.symbol}(${h.type}/${h.exchange || "auto"}) → ${resolved.exchange}:${resolved.sym}`)

    tasks.push((async () => {
      let data = null

      if (resolved.exchange === "coingecko") {
        data = await coingeckoQuote(resolved.key)
        if (data) if(import.meta.env.DEV) console.log(`[Ticker] ${resolved.key}: ✅ CoinGecko: $${data.price}`)
      } else if (resolved.exchange === "coinbase") {
        data = await coinbaseTicker(resolved.sym)
        if (data) {
          data.change = await coinbase24h(resolved.sym)
        } else {
          // FALLBACK: Coinbase Exchange API doesn't have this product → CoinGecko
          if(import.meta.env.DEV) console.log(`[Ticker] ${resolved.key}: CB failed, trying CoinGecko`)
          data = await coingeckoQuote(resolved.key)
          if (data) if(import.meta.env.DEV) console.log(`[Ticker] ${resolved.key}: ✅ CoinGecko fallback: $${data.price}`)
        }
      } else if (resolved.exchange === "phemex") {
        data = await phemexTicker(resolved.sym)
        if (!data) {
          // FALLBACK: Phemex doesn't have this product → CoinGecko
          if(import.meta.env.DEV) console.log(`[Ticker] ${resolved.key}: PH failed, trying CoinGecko`)
          data = await coingeckoQuote(resolved.key)
          if (data) if(import.meta.env.DEV) console.log(`[Ticker] ${resolved.key}: ✅ CoinGecko fallback: $${data.price}`)
        }
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

  if(import.meta.env.DEV) console.log(`[Klines] ── Starting with ${requests.length} requests:`, requests.map(r => `${r.symbol}(${r.type})`).join(", "))

  for (const req of requests) {
    const resolved = resolveExchange(req.symbol, req.type, req.exchange)
    if(import.meta.env.DEV) console.log(`[Klines] resolve ${req.symbol} (type=${req.type}, exchange=${req.exchange || "auto"}) →`, resolved ? `${resolved.exchange}:${resolved.sym}` : "NULL")
    if (!resolved || seen.has(resolved.key)) continue
    seen.add(resolved.key)

    tasks.push((async () => {
      let klines = []
      if(import.meta.env.DEV) console.log(`[Klines] ${resolved.key} → ${resolved.exchange}:${resolved.sym}`)

      if (resolved.exchange === "coingecko") {
        klines = await coingeckoKlines(resolved.key, req.startTime)
        if (klines.length > 0) if(import.meta.env.DEV) console.log(`[Klines] ${resolved.key}: ✅ CoinGecko: ${klines.length} bars`)
      } else if (resolved.exchange === "coinbase") {
        klines = await coinbaseCandles(resolved.sym, req.startTime)
        if (klines.length === 0) {
          // FALLBACK: Coinbase Exchange API doesn't have this product → CoinGecko
          if(import.meta.env.DEV) console.log(`[Klines] ${resolved.key}: CB failed, trying CoinGecko`)
          klines = await coingeckoKlines(resolved.key, req.startTime)
          if (klines.length > 0) if(import.meta.env.DEV) console.log(`[Klines] ${resolved.key}: ✅ CoinGecko fallback: ${klines.length} bars`)
        }
      } else if (resolved.exchange === "phemex") {
        const ticker = await phemexTicker(resolved.sym)
        klines = await phemexKlines(resolved.sym, req.startTime, ticker?.price || 0)
        if (klines.length === 0) {
          // FALLBACK: Phemex doesn't have this product → CoinGecko
          if(import.meta.env.DEV) console.log(`[Klines] ${resolved.key}: PH failed, trying CoinGecko`)
          klines = await coingeckoKlines(resolved.key, req.startTime)
          if (klines.length > 0) if(import.meta.env.DEV) console.log(`[Klines] ${resolved.key}: ✅ CoinGecko fallback: ${klines.length} bars`)
        }
      } else if (resolved.exchange === "yahoo") {
        klines = await yahooKlines(resolved.sym, req.startTime)
      }

      if (klines.length > 0) {
        if(import.meta.env.DEV) console.log(`[Klines] ${resolved.key}: ✅ ${klines.length} bars`)
        results[resolved.key] = klines
      } else {
        if(import.meta.env.DEV) console.warn(`[Klines] ${resolved.key}: ❌ no data`)
      }
    })())
  }

  for (let i = 0; i < tasks.length; i += 3) await Promise.all(tasks.slice(i, i + 3))
  if(import.meta.env.DEV) console.log(`[Klines] Done:`, Object.keys(results).map(k => `${k}(${results[k].length})`).join(", "))
  return results
}
