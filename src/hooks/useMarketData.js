/**
 * useMarketData.js — Multi-exchange data fetcher
 * 
 * Routing:
 *   Spot positions   → Coinbase (api.exchange.coinbase.com)
 *   Perp positions   → Phemex   (api.phemex.com)
 *   Fallback         → Binance  (api.binance.com)
 * 
 * All requests go through Vite dev server proxy to avoid CORS.
 */

// ─── SYMBOL MAPS ────────────────────────────────────────────────────────────

const COINBASE_MAP = {
  BTC: "BTC-USD", ETH: "ETH-USD", SOL: "SOL-USD", DOGE: "DOGE-USD",
  XRP: "XRP-USD", ADA: "ADA-USD", AVAX: "AVAX-USD", DOT: "DOT-USD",
  LINK: "LINK-USD", NEAR: "NEAR-USD", SUI: "SUI-USD", APT: "APT-USD",
  ARB: "ARB-USD", OP: "OP-USD", MATIC: "MATIC-USD", SEI: "SEI-USD",
  INJ: "INJ-USD", TIA: "TIA-USD", PEPE: "PEPE-USD", RENDER: "RENDER-USD",
  FET: "FET-USD", TAO: "TAO-USD", HYPE: "HYPE-USD", WIF: "WIF-USD",
}

const PHEMEX_MAP = {
  BTC: "BTCUSDT", ETH: "ETHUSDT", SOL: "SOLUSDT", DOGE: "DOGEUSDT",
  XRP: "XRPUSDT", ADA: "ADAUSDT", AVAX: "AVAXUSDT", DOT: "DOTUSDT",
  LINK: "LINKUSDT", NEAR: "NEARUSDT", SUI: "SUIUSDT", APT: "APTUSDT",
  ARB: "ARBUSDT", OP: "OPUSDT", SEI: "SEIUSDT", INJ: "INJUSDT",
  TIA: "TIAUSDT", PEPE: "PEPEUSDT", WIF: "WIFUSDT", HYPE: "HYPEUSDT",
  RENDER: "RENDERUSDT", FET: "FETUSDT", TAO: "TAOUSDT",
  CC: "CCUSDT",
}

const BINANCE_MAP = {
  BTC: "BTCUSDT", ETH: "ETHUSDT", SOL: "SOLUSDT", DOGE: "DOGEUSDT",
  XRP: "XRPUSDT", ADA: "ADAUSDT", AVAX: "AVAXUSDT", DOT: "DOTUSDT",
  LINK: "LINKUSDT", NEAR: "NEARUSDT", SUI: "SUIUSDT", APT: "APTUSDT",
  ARB: "ARBUSDT", OP: "OPUSDT", SEI: "SEIUSDT", INJ: "INJUSDT",
  TIA: "TIAUSDT", PEPE: "PEPEUSDT", WIF: "WIFUSDT", HYPE: "HYPEUSDT",
  RENDER: "RENDERUSDT", FET: "FETUSDT", TAO: "TAOUSDT",
  CC: "CCUSDT", MATIC: "MATICUSDT",
}

// Normalize user symbol input → key (e.g., "CC/USDT" → "CC", "cc" → "CC")
export function normalizeSymbol(symbol) {
  return symbol.toUpperCase().replace("/USDT", "").replace("/USD", "").replace("/", "").trim()
}

// Check if a symbol is a crypto we can fetch data for
export function isCryptoSymbol(symbol) {
  const key = normalizeSymbol(symbol)
  return !!(COINBASE_MAP[key] || PHEMEX_MAP[key] || BINANCE_MAP[key])
}

// Determine which exchange to use based on position type + symbol availability
function resolveExchange(symbol, type) {
  const key = normalizeSymbol(symbol)
  const isPerp = type === "crypto_perp"

  if (isPerp && PHEMEX_MAP[key]) return { exchange: "phemex", sym: PHEMEX_MAP[key], key }
  if (!isPerp && COINBASE_MAP[key]) return { exchange: "coinbase", sym: COINBASE_MAP[key], key }
  // Fallbacks
  if (PHEMEX_MAP[key]) return { exchange: "phemex", sym: PHEMEX_MAP[key], key }
  if (COINBASE_MAP[key]) return { exchange: "coinbase", sym: COINBASE_MAP[key], key }
  if (BINANCE_MAP[key]) return { exchange: "binance", sym: BINANCE_MAP[key], key }
  return null
}


// ─── COINBASE ───────────────────────────────────────────────────────────────

async function coinbaseTicker(cbSymbol) {
  try {
    const res = await fetch(`/api/coinbase/products/${cbSymbol}/ticker`)
    if (!res.ok) return null
    const data = await res.json()
    return { price: parseFloat(data.price) || 0, change: 0 }
  } catch (e) {
    console.warn(`[Coinbase] ticker failed for ${cbSymbol}:`, e.message)
    return null
  }
}

// Coinbase also has a stats endpoint for 24h change
async function coinbase24hChange(cbSymbol) {
  try {
    const res = await fetch(`/api/coinbase/products/${cbSymbol}/stats`)
    if (!res.ok) return 0
    const data = await res.json()
    const open = parseFloat(data.open) || 0
    const last = parseFloat(data.last) || 0
    return open > 0 ? ((last - open) / open) * 100 : 0
  } catch {
    return 0
  }
}

async function coinbaseCandles(cbSymbol, startTimeMs) {
  const results = []
  const granularity = 86400 // 1 day
  let endSec = Math.floor(Date.now() / 1000)
  const startSec = Math.floor(startTimeMs / 1000)

  // Coinbase max 300 candles per request, descending order
  while (endSec > startSec) {
    const batchStart = Math.max(startSec, endSec - 299 * granularity)
    try {
      const url = `/api/coinbase/products/${cbSymbol}/candles?granularity=${granularity}&start=${batchStart}&end=${endSec}`
      const res = await fetch(url)
      if (!res.ok) break
      const data = await res.json()
      if (!Array.isArray(data) || data.length === 0) break

      // Each candle: [time, low, high, open, close, volume]
      for (const c of data) {
        results.push({
          date: new Date(c[0] * 1000).toISOString().split("T")[0],
          close: c[4],
        })
      }
      endSec = batchStart - granularity
      if (data.length < 280) break
    } catch (e) {
      console.warn(`[Coinbase] candles failed for ${cbSymbol}:`, e.message)
      break
    }
  }

  // Deduplicate by date and sort ascending
  const byDate = {}
  for (const r of results) byDate[r.date] = r
  return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date))
}


// ─── PHEMEX ─────────────────────────────────────────────────────────────────

// Phemex v3 ticker returns unscaled decimal prices
async function phemexTicker(phSymbol) {
  try {
    const res = await fetch(`/api/phemex/md/v3/ticker/24hr?symbol=${phSymbol}`)
    if (!res.ok) return null
    const data = await res.json()
    if (data.code !== 0) return null

    const t = Array.isArray(data.data) ? data.data[0] : data.data
    if (!t) return null

    const price = parseFloat(t.lastPrice || t.close || 0)
    const change = parseFloat(t.price24hPcnt || t.priceChangePercent || 0)
    // Phemex returns change as decimal (0.05 = 5%), convert to %
    const changePct = Math.abs(change) < 1 ? change * 100 : change

    return { price, change: changePct }
  } catch (e) {
    console.warn(`[Phemex] ticker failed for ${phSymbol}:`, e.message)
    return null
  }
}

// Phemex klines return scaled integer prices (Ep format)
// We auto-detect scale by comparing to known ticker price
async function phemexKlines(phSymbol, startTimeMs, knownPrice) {
  try {
    const fromSec = Math.floor(startTimeMs / 1000)
    const toSec = Math.floor(Date.now() / 1000)

    const url = `/api/phemex/exchange/public/md/kline?symbol=${phSymbol}&from=${fromSec}&to=${toSec}&resolution=86400`
    const res = await fetch(url)
    if (!res.ok) return []
    const data = await res.json()

    if (data.code !== 0 || !data.data?.rows?.length) return []

    const rows = data.data.rows
    // rows: [timestamp, interval, lastCloseEp, openEp, highEp, lowEp, closeEp, volumeEv, turnoverEv]

    // Auto-detect price scale: compare last kline close to ticker price
    let scale = 1
    if (knownPrice > 0) {
      const lastClose = rows[rows.length - 1][6]
      if (lastClose > 0) {
        const rawRatio = lastClose / knownPrice
        // Find nearest power of 10
        const logRatio = Math.round(Math.log10(rawRatio))
        scale = Math.pow(10, logRatio)
        if (scale < 1) scale = 1
      }
    }

    return rows.map(row => ({
      date: new Date(row[0] * 1000).toISOString().split("T")[0],
      close: row[6] / scale,
    })).sort((a, b) => a.date.localeCompare(b.date))

  } catch (e) {
    console.warn(`[Phemex] klines failed for ${phSymbol}:`, e.message)
    return []
  }
}


// ─── BINANCE (fallback) ─────────────────────────────────────────────────────

async function binanceTicker(bnSymbol) {
  try {
    const res = await fetch(`/api/binance/api/v3/ticker/24hr?symbol=${bnSymbol}`)
    if (!res.ok) return null
    const data = await res.json()
    return {
      price: parseFloat(data.lastPrice) || 0,
      change: parseFloat(data.priceChangePercent) || 0,
    }
  } catch (e) {
    console.warn(`[Binance] ticker failed for ${bnSymbol}:`, e.message)
    return null
  }
}

async function binanceKlines(bnSymbol, startTimeMs) {
  const results = []
  let start = startTimeMs
  const limit = 1000

  while (start < Date.now()) {
    try {
      const url = `/api/binance/api/v3/klines?symbol=${bnSymbol}&interval=1d&startTime=${start}&limit=${limit}`
      const res = await fetch(url)
      if (!res.ok) break
      const data = await res.json()
      if (!Array.isArray(data) || data.length === 0) break

      for (const k of data) {
        results.push({
          date: new Date(k[0]).toISOString().split("T")[0],
          close: parseFloat(k[4]),
        })
      }
      start = data[data.length - 1][0] + 86400000
      if (data.length < limit) break
    } catch (e) {
      console.warn(`[Binance] klines failed for ${bnSymbol}:`, e.message)
      break
    }
  }
  return results
}


// ─── PUBLIC API ─────────────────────────────────────────────────────────────

/**
 * Fetch live prices for a list of holdings.
 * Routes each to the appropriate exchange based on type.
 * Returns: { [normalizedKey]: { price, change } }
 */
export async function fetchTickers(holdings) {
  const results = {}
  const seen = new Set()

  // Group by exchange to batch where possible
  const tasks = []

  for (const h of holdings) {
    const resolved = resolveExchange(h.symbol, h.type)
    if (!resolved || seen.has(resolved.key)) continue
    seen.add(resolved.key)

    tasks.push((async () => {
      let data = null

      if (resolved.exchange === "coinbase") {
        data = await coinbaseTicker(resolved.sym)
        if (data) {
          const change = await coinbase24hChange(resolved.sym)
          data.change = change
        }
      } else if (resolved.exchange === "phemex") {
        data = await phemexTicker(resolved.sym)
      }

      // Fallback to Binance
      if (!data) {
        const bnSym = BINANCE_MAP[resolved.key]
        if (bnSym) data = await binanceTicker(bnSym)
      }

      if (data && data.price > 0) {
        results[resolved.key] = data
      }
    })())
  }

  // Run up to 4 concurrent fetches
  for (let i = 0; i < tasks.length; i += 4) {
    await Promise.all(tasks.slice(i, i + 4))
  }

  return results
}

/**
 * Fetch historical daily klines for holdings.
 * Each request: { symbol, type, startTime (ms) }
 * Returns: { [normalizedKey]: [{ date, close }] }
 */
export async function fetchAllKlines(requests) {
  const results = {}
  const seen = new Set()

  const tasks = []

  for (const req of requests) {
    const resolved = resolveExchange(req.symbol, req.type)
    if (!resolved || seen.has(resolved.key)) continue
    seen.add(resolved.key)

    tasks.push((async () => {
      let klines = []

      if (resolved.exchange === "coinbase") {
        klines = await coinbaseCandles(resolved.sym, req.startTime)
      } else if (resolved.exchange === "phemex") {
        // Get ticker first for scale detection
        const ticker = await phemexTicker(resolved.sym)
        const knownPrice = ticker?.price || 0
        klines = await phemexKlines(resolved.sym, req.startTime, knownPrice)
      }

      // Fallback to Binance if primary failed
      if (klines.length === 0) {
        const bnSym = BINANCE_MAP[resolved.key]
        if (bnSym) {
          console.log(`[Fallback] Using Binance for ${resolved.key} klines`)
          klines = await binanceKlines(bnSym, req.startTime)
        }
      }

      if (klines.length > 0) {
        results[resolved.key] = klines
      }
    })())
  }

  // Run up to 3 concurrent (rate limit friendly)
  for (let i = 0; i < tasks.length; i += 3) {
    await Promise.all(tasks.slice(i, i + 3))
  }

  return results
}

/**
 * Legacy compat: Batch ticker fetch using Binance (used by Simulator if needed)
 */
export async function fetchBinanceTickers(symbols) {
  const result = {}
  try {
    const url = `/api/binance/api/v3/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(symbols))}`
    const res = await fetch(url)
    if (!res.ok) return result
    const data = await res.json()
    for (const t of data) {
      result[t.symbol] = {
        price: parseFloat(t.lastPrice),
        change: parseFloat(t.priceChangePercent),
        high: parseFloat(t.highPrice),
        low: parseFloat(t.lowPrice),
        volume: parseFloat(t.quoteVolume),
      }
    }
  } catch (e) {
    console.warn("[Binance] batch ticker failed:", e.message)
  }
  return result
}
