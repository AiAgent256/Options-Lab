/**
 * useMarketData.js — Multi-exchange data fetcher
 * 
 * Routing:
 *   Spot positions   → Coinbase Exchange API → Binance fallback
 *   Perp positions   → Phemex → Binance fallback
 * 
 * All requests go through Vite dev server proxy to avoid CORS:
 *   /api/coinbase/* → https://api.exchange.coinbase.com/*
 *   /api/phemex/*   → https://api.phemex.com/*
 *   /api/binance/*  → https://api.binance.com/*
 */

// ─── SYMBOL MAPS ────────────────────────────────────────────────────────────

const COINBASE_MAP = {
  BTC: "BTC-USD", ETH: "ETH-USD", SOL: "SOL-USD", DOGE: "DOGE-USD",
  XRP: "XRP-USD", ADA: "ADA-USD", AVAX: "AVAX-USD", DOT: "DOT-USD",
  LINK: "LINK-USD", NEAR: "NEAR-USD", SUI: "SUI-USD", APT: "APT-USD",
  ARB: "ARB-USD", OP: "OP-USD", MATIC: "MATIC-USD", SEI: "SEI-USD",
  INJ: "INJ-USD", TIA: "TIA-USD", RENDER: "RENDER-USD",
  FET: "FET-USD", HYPE: "HYPE-USD",
}

const PHEMEX_MAP = {
  BTC: "BTCUSDT", ETH: "ETHUSDT", SOL: "SOLUSDT", DOGE: "DOGEUSDT",
  XRP: "XRPUSDT", ADA: "ADAUSDT", AVAX: "AVAXUSDT", DOT: "DOTUSDT",
  LINK: "LINKUSDT", NEAR: "NEARUSDT", SUI: "SUIUSDT", APT: "APTUSDT",
  ARB: "ARBUSDT", OP: "OPUSDT", SEI: "SEIUSDT", INJ: "INJUSDT",
  TIA: "TIAUSDT", WIF: "WIFUSDT", HYPE: "HYPEUSDT",
  RENDER: "RENDERUSDT", FET: "FETUSDT", TAO: "TAOUSDT",
  CC: "CCUSDT", PEPE: "1000PEPEUSDT",
}

const BINANCE_MAP = {
  BTC: "BTCUSDT", ETH: "ETHUSDT", SOL: "SOLUSDT", DOGE: "DOGEUSDT",
  XRP: "XRPUSDT", ADA: "ADAUSDT", AVAX: "AVAXUSDT", DOT: "DOTUSDT",
  LINK: "LINKUSDT", NEAR: "NEARUSDT", SUI: "SUIUSDT", APT: "APTUSDT",
  ARB: "ARBUSDT", OP: "OPUSDT", SEI: "SEIUSDT", INJ: "INJUSDT",
  TIA: "TIAUSDT", PEPE: "PEPEUSDT", WIF: "WIFUSDT", HYPE: "HYPEUSDT",
  RENDER: "RENDERUSDT", FET: "FETUSDT", TAO: "TAOUSDT",
  MATIC: "MATICUSDT",
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
  if (BINANCE_MAP[key]) return { exchange: "binance", sym: BINANCE_MAP[key], key }
  if (PHEMEX_MAP[key]) return { exchange: "phemex", sym: PHEMEX_MAP[key], key }
  if (COINBASE_MAP[key]) return { exchange: "coinbase", sym: COINBASE_MAP[key], key }
  return null
}


// ─── COINBASE ───────────────────────────────────────────────────────────────

async function coinbaseTicker(cbSymbol) {
  try {
    const res = await fetch(`/api/coinbase/products/${cbSymbol}/ticker`)
    if (!res.ok) { console.warn(`[CB] ticker ${cbSymbol} → ${res.status}`); return null }
    const data = await res.json()
    return { price: parseFloat(data.price) || 0, change: 0 }
  } catch (e) { console.warn(`[CB] ticker error ${cbSymbol}:`, e.message); return null }
}

async function coinbase24hStats(cbSymbol) {
  try {
    const res = await fetch(`/api/coinbase/products/${cbSymbol}/stats`)
    if (!res.ok) return 0
    const data = await res.json()
    const open = parseFloat(data.open) || 0
    const last = parseFloat(data.last) || 0
    return open > 0 ? ((last - open) / open) * 100 : 0
  } catch { return 0 }
}

async function coinbaseCandles(cbSymbol, startTimeMs) {
  console.log(`[CB] fetching candles for ${cbSymbol} from ${new Date(startTimeMs).toISOString().split("T")[0]}`)
  const results = []
  const granularity = 86400 // 1 day in seconds
  let endSec = Math.floor(Date.now() / 1000)
  const startSec = Math.floor(startTimeMs / 1000)

  // Coinbase max 300 candles per request
  let batch = 0
  while (endSec > startSec && batch < 10) {
    batch++
    const batchStart = Math.max(startSec, endSec - 299 * granularity)
    try {
      const url = `/api/coinbase/products/${cbSymbol}/candles?granularity=${granularity}&start=${batchStart}&end=${endSec}`
      const res = await fetch(url)
      if (!res.ok) { console.warn(`[CB] candles ${cbSymbol} batch ${batch} → ${res.status}`); break }
      const data = await res.json()
      if (!Array.isArray(data) || data.length === 0) { console.log(`[CB] candles ${cbSymbol} batch ${batch}: empty`); break }

      console.log(`[CB] candles ${cbSymbol} batch ${batch}: ${data.length} candles`)
      // Coinbase candle: [time_seconds, low, high, open, close, volume]
      for (const c of data) {
        if (!Array.isArray(c) || c.length < 5) continue
        results.push({
          date: new Date(c[0] * 1000).toISOString().split("T")[0],
          close: parseFloat(c[4]),
        })
      }
      endSec = batchStart - granularity
      if (data.length < 250) break // got less than a full page, we're done
    } catch (e) {
      console.warn(`[CB] candles error ${cbSymbol}:`, e.message)
      break
    }
  }

  // Deduplicate by date and sort ascending
  const byDate = {}
  for (const r of results) if (r.close > 0) byDate[r.date] = r
  const sorted = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date))
  console.log(`[CB] candles ${cbSymbol}: ${sorted.length} total days`)
  return sorted
}


// ─── PHEMEX ─────────────────────────────────────────────────────────────────

async function phemexTicker(phSymbol) {
  try {
    // Try the v2 ticker first (simpler response)
    const res = await fetch(`/api/phemex/md/v2/ticker/24hr?symbol=${phSymbol}`)
    if (!res.ok) { console.warn(`[PH] ticker ${phSymbol} → ${res.status}`); return null }
    const data = await res.json()
    
    if (data.code !== 0 && data.code !== undefined) {
      console.warn(`[PH] ticker ${phSymbol} code=${data.code}:`, data.msg)
      return null
    }

    // v2 response: data.result or data.data
    const t = data.result || (Array.isArray(data.data) ? data.data[0] : data.data) || data
    
    // Phemex v2 uses scaled prices (Ep = price * 10^scale)
    // For most pairs scale=4 (10000), for BTC scale=0
    let price = 0
    if (t.lastPrice !== undefined) price = parseFloat(t.lastPrice)
    else if (t.close !== undefined) price = parseFloat(t.close)
    else if (t.closeEp !== undefined) {
      // Try to detect scale from the number magnitude
      const raw = parseInt(t.closeEp)
      price = raw > 1000000 ? raw / 10000 : raw / 100
    }
    
    let change = parseFloat(t.priceChangePercent || t.price24hPcnt || 0)
    // Phemex sometimes returns as decimal (0.05 = 5%)
    if (Math.abs(change) < 5 && Math.abs(change) > 0) change *= 100

    console.log(`[PH] ticker ${phSymbol}: price=${price} change=${change}%`)
    return price > 0 ? { price, change } : null
  } catch (e) { console.warn(`[PH] ticker error ${phSymbol}:`, e.message); return null }
}

async function phemexKlines(phSymbol, startTimeMs, tickerPrice) {
  console.log(`[PH] fetching klines for ${phSymbol} from ${new Date(startTimeMs).toISOString().split("T")[0]}`)
  
  try {
    const fromSec = Math.floor(startTimeMs / 1000)
    const toSec = Math.floor(Date.now() / 1000)

    // Try v2 kline endpoint (returns up to 2000 candles)
    const url = `/api/phemex/exchange/public/md/v2/kline?symbol=${phSymbol}&resolution=86400&from=${fromSec}&to=${toSec}`
    console.log(`[PH] kline URL: ${url}`)
    const res = await fetch(url)
    if (!res.ok) {
      console.warn(`[PH] klines ${phSymbol} → ${res.status}`)
      return []
    }
    const data = await res.json()
    console.log(`[PH] klines ${phSymbol} response code=${data.code}, keys:`, Object.keys(data))

    if (data.code !== 0) {
      console.warn(`[PH] klines ${phSymbol} error:`, data.msg)
      return []
    }

    const rows = data.data?.rows || data.data?.klines || data.data || []
    if (!Array.isArray(rows) || rows.length === 0) {
      console.log(`[PH] klines ${phSymbol}: no rows found. data.data =`, JSON.stringify(data.data)?.slice(0, 500))
      return []
    }

    console.log(`[PH] klines ${phSymbol}: ${rows.length} rows, sample:`, JSON.stringify(rows[0]))

    // Detect if rows are arrays or objects
    let results = []
    if (Array.isArray(rows[0])) {
      // Array format: [timestamp, interval, lastClose, open, high, low, close, volume, turnover]
      // Detect price scale by comparing last row's close to ticker price
      let scale = 1
      if (tickerPrice > 0) {
        const lastClose = rows[rows.length - 1][6] || rows[rows.length - 1][4]
        if (lastClose > 0) {
          const rawRatio = lastClose / tickerPrice
          if (rawRatio > 5) {
            const logR = Math.round(Math.log10(rawRatio))
            scale = Math.pow(10, logR)
          }
        }
        console.log(`[PH] klines ${phSymbol}: scale=${scale} (lastClose=${rows[rows.length - 1][6]}, ticker=${tickerPrice})`)
      }

      results = rows.map(row => ({
        date: new Date((row[0] || 0) * 1000).toISOString().split("T")[0],
        close: (row[6] || row[4] || 0) / scale,
      }))
    } else if (typeof rows[0] === "object") {
      // Object format
      results = rows.map(row => ({
        date: new Date((row.timestamp || row.t || 0) * 1000).toISOString().split("T")[0],
        close: parseFloat(row.close || row.closeEp || row.c || 0),
      }))
    }

    results = results.filter(r => r.close > 0 && r.date > "2020-01-01")
    results.sort((a, b) => a.date.localeCompare(b.date))
    console.log(`[PH] klines ${phSymbol}: ${results.length} valid candles`)
    return results

  } catch (e) {
    console.warn(`[PH] klines error ${phSymbol}:`, e.message)
    return []
  }
}


// ─── BINANCE (fallback) ─────────────────────────────────────────────────────

async function binanceTicker(bnSymbol) {
  try {
    const res = await fetch(`/api/binance/api/v3/ticker/24hr?symbol=${bnSymbol}`)
    if (!res.ok) { console.warn(`[BN] ticker ${bnSymbol} → ${res.status}`); return null }
    const data = await res.json()
    return {
      price: parseFloat(data.lastPrice) || 0,
      change: parseFloat(data.priceChangePercent) || 0,
    }
  } catch (e) { console.warn(`[BN] ticker error ${bnSymbol}:`, e.message); return null }
}

async function binanceKlines(bnSymbol, startTimeMs) {
  console.log(`[BN] fetching klines for ${bnSymbol} from ${new Date(startTimeMs).toISOString().split("T")[0]}`)
  const results = []
  let start = startTimeMs
  const limit = 1000
  let batch = 0

  while (start < Date.now() && batch < 5) {
    batch++
    try {
      const url = `/api/binance/api/v3/klines?symbol=${bnSymbol}&interval=1d&startTime=${start}&limit=${limit}`
      const res = await fetch(url)
      if (!res.ok) { console.warn(`[BN] klines ${bnSymbol} batch ${batch} → ${res.status}`); break }
      const data = await res.json()
      if (!Array.isArray(data) || data.length === 0) break

      console.log(`[BN] klines ${bnSymbol} batch ${batch}: ${data.length} candles`)
      for (const k of data) {
        results.push({
          date: new Date(k[0]).toISOString().split("T")[0],
          close: parseFloat(k[4]),
        })
      }
      start = data[data.length - 1][0] + 86400000
      if (data.length < limit) break
    } catch (e) {
      console.warn(`[BN] klines error ${bnSymbol}:`, e.message)
      break
    }
  }
  console.log(`[BN] klines ${bnSymbol}: ${results.length} total candles`)
  return results
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
    const resolved = resolveExchange(h.symbol, h.type)
    if (!resolved || seen.has(resolved.key)) continue
    seen.add(resolved.key)

    tasks.push((async () => {
      let data = null

      if (resolved.exchange === "coinbase") {
        data = await coinbaseTicker(resolved.sym)
        if (data) data.change = await coinbase24hStats(resolved.sym)
      } else if (resolved.exchange === "phemex") {
        data = await phemexTicker(resolved.sym)
      } else if (resolved.exchange === "binance") {
        data = await binanceTicker(resolved.sym)
      }

      // Fallback chain
      if (!data && resolved.exchange !== "binance") {
        const bnSym = BINANCE_MAP[resolved.key]
        if (bnSym) {
          console.log(`[Fallback] Using Binance ticker for ${resolved.key}`)
          data = await binanceTicker(bnSym)
        }
      }

      if (data && data.price > 0) results[resolved.key] = data
    })())
  }

  // 4 concurrent
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

      console.log(`[Klines] ${resolved.key} → ${resolved.exchange}:${resolved.sym}`)

      if (resolved.exchange === "coinbase") {
        klines = await coinbaseCandles(resolved.sym, req.startTime)
      } else if (resolved.exchange === "phemex") {
        const ticker = await phemexTicker(resolved.sym)
        klines = await phemexKlines(resolved.sym, req.startTime, ticker?.price || 0)
      } else if (resolved.exchange === "binance") {
        klines = await binanceKlines(resolved.sym, req.startTime)
      }

      // Fallback to Binance
      if (klines.length === 0 && resolved.exchange !== "binance") {
        const bnSym = BINANCE_MAP[resolved.key]
        if (bnSym) {
          console.log(`[Fallback] Using Binance klines for ${resolved.key}`)
          klines = await binanceKlines(bnSym, req.startTime)
        }
      }

      if (klines.length > 0) {
        console.log(`[Klines] ${resolved.key}: ✅ ${klines.length} days loaded`)
        results[resolved.key] = klines
      } else {
        console.warn(`[Klines] ${resolved.key}: ❌ no data from any source`)
      }
    })())
  }

  // 3 concurrent
  for (let i = 0; i < tasks.length; i += 3) {
    await Promise.all(tasks.slice(i, i + 3))
  }

  console.log(`[Klines] Complete:`, Object.keys(results).map(k => `${k}(${results[k].length})`).join(", "))
  return results
}

/**
 * Legacy compat for Simulator tab
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
  } catch (e) { console.warn("[BN] batch ticker failed:", e.message) }
  return result
}
