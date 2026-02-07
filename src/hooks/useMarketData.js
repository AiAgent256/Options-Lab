/**
 * useMarketData.js — Multi-exchange data fetcher
 * 
 * Routing:
 *   Spot positions   → Coinbase (api.exchange.coinbase.com)
 *   Perp positions   → Phemex   (api.phemex.com)
 * 
 * Klines use 4h interval for intraday granularity.
 * All requests proxy through Vite dev server to avoid CORS.
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

// ─── HELPERS ────────────────────────────────────────────────────────────────

export function normalizeSymbol(symbol) {
  return symbol.toUpperCase().replace("/USDT", "").replace("/USD", "").replace("/", "").trim()
}

export function isCryptoSymbol(symbol) {
  const key = normalizeSymbol(symbol)
  return !!(COINBASE_MAP[key] || PHEMEX_MAP[key])
}

function resolveExchange(symbol, type) {
  const key = normalizeSymbol(symbol)
  const isPerp = type === "crypto_perp"

  if (isPerp && PHEMEX_MAP[key]) return { exchange: "phemex", sym: PHEMEX_MAP[key], key }
  if (isPerp && COINBASE_MAP[key]) return { exchange: "coinbase", sym: COINBASE_MAP[key], key }
  if (!isPerp && COINBASE_MAP[key]) return { exchange: "coinbase", sym: COINBASE_MAP[key], key }
  if (!isPerp && PHEMEX_MAP[key]) return { exchange: "phemex", sym: PHEMEX_MAP[key], key }

  return null
}

function toISO(epochSec) {
  return new Date(epochSec * 1000).toISOString()
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

// Coinbase candles — 4h (14400s) — REQUIRES ISO 8601 dates
async function coinbaseCandles(cbSymbol, startTimeMs) {
  console.log(`[CB] candles 4h ${cbSymbol} from ${new Date(startTimeMs).toISOString().split("T")[0]}`)
  const results = []
  const granularity = 14400 // 4 hours in seconds
  let endSec = Math.floor(Date.now() / 1000)
  const startSec = Math.floor(startTimeMs / 1000)
  let batch = 0

  while (endSec > startSec && batch < 20) {
    batch++
    const batchStart = Math.max(startSec, endSec - 299 * granularity)
    try {
      // Coinbase requires ISO 8601 for start/end
      const startISO = toISO(batchStart)
      const endISO = toISO(endSec)
      const url = `/api/coinbase/products/${cbSymbol}/candles?granularity=${granularity}&start=${startISO}&end=${endISO}`
      console.log(`[CB] batch ${batch}: ${startISO} → ${endISO}`)
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
        results.push({
          ts,
          date: new Date(ts).toISOString().slice(0, 13), // "2026-02-05T08"
          close: parseFloat(c[4]),
        })
      }
      endSec = batchStart - granularity
      if (data.length < 250) break
    } catch (e) { console.warn(`[CB] candles err:`, e.message); break }
  }

  const byKey = {}
  for (const r of results) if (r.close > 0) byKey[r.date] = r
  const sorted = Object.values(byKey).sort((a, b) => a.ts - b.ts)
  console.log(`[CB] candles ${cbSymbol}: ${sorted.length} total 4h bars`)
  return sorted
}


// ─── PHEMEX ─────────────────────────────────────────────────────────────────

async function phemexTicker(phSymbol) {
  // Try multiple Phemex ticker endpoints
  const endpoints = [
    `/api/phemex/md/v2/ticker/24hr?symbol=${phSymbol}`,
    `/api/phemex/v1/md/ticker/24hr?symbol=${phSymbol}`,
    `/api/phemex/md/ticker/24hr?symbol=${phSymbol}`,
  ]

  for (const url of endpoints) {
    try {
      const res = await fetch(url)
      if (!res.ok) continue
      const data = await res.json()

      console.log(`[PH] ticker raw ${phSymbol}:`, JSON.stringify(data).slice(0, 300))

      // Navigate to the result object
      const t = data.result || (Array.isArray(data.data) ? data.data[0] : data.data) || data

      // Try multiple price field names
      let price = 0
      for (const field of ["lastPrice", "close", "markPrice", "indexPrice"]) {
        const val = parseFloat(t[field])
        if (val > 0) { price = val; break }
      }

      // Phemex Ep (scaled integer) format
      if (!price) {
        for (const field of ["closeEp", "lastPriceEp", "markPriceEp"]) {
          const raw = parseInt(t[field])
          if (raw > 0) {
            // Auto-detect scale: BTC-class (10^8), USDT-class (10^4)
            if (raw > 1e12) price = raw / 1e8
            else if (raw > 1e8) price = raw / 1e4
            else price = raw / 1e4
            if (price > 0) break
          }
        }
      }

      let change = parseFloat(t.priceChangePercent || t.price24hPcnt || 0)
      if (Math.abs(change) > 0 && Math.abs(change) < 1) change *= 100

      console.log(`[PH] ticker ${phSymbol}: $${price} (${change.toFixed(2)}%)`)
      if (price > 0) return { price, change }
    } catch (e) { continue }
  }

  console.warn(`[PH] ticker ${phSymbol}: all endpoints failed`)
  return null
}

// Phemex klines — try multiple endpoint formats
async function phemexKlines(phSymbol, startTimeMs, tickerPrice) {
  console.log(`[PH] klines 4h ${phSymbol} from ${new Date(startTimeMs).toISOString().split("T")[0]}`)

  const fromSec = Math.floor(startTimeMs / 1000)
  const toSec = Math.floor(Date.now() / 1000)

  // Try multiple Phemex kline endpoint formats
  const endpoints = [
    `/api/phemex/exchange/public/md/v2/kline?symbol=${phSymbol}&resolution=14400&from=${fromSec}&to=${toSec}`,
    `/api/phemex/md/v2/kline?symbol=${phSymbol}&resolution=14400&from=${fromSec}&to=${toSec}`,
    `/api/phemex/exchange/public/md/kline?symbol=${phSymbol}&resolution=14400&from=${fromSec}&to=${toSec}`,
    `/api/phemex/md/kline?symbol=${phSymbol}&resolution=14400&from=${fromSec}&to=${toSec}`,
    `/api/phemex/exchange/public/md/v2/kline/last?symbol=${phSymbol}&resolution=14400&from=${fromSec}&to=${toSec}`,
  ]

  for (const url of endpoints) {
    try {
      console.log(`[PH] trying: ${url.split("/api/phemex")[1]}`)
      const res = await fetch(url)
      if (!res.ok) {
        console.warn(`[PH] ${res.status} for ${url.split("/api/phemex")[1]}`)
        continue
      }
      const data = await res.json()

      if (data.code !== 0 && data.code !== undefined) {
        console.warn(`[PH] code=${data.code} msg=${data.msg || ""}`)
        continue
      }

      const rows = data.data?.rows || data.data?.klines || data.data || []
      if (!Array.isArray(rows) || rows.length === 0) {
        console.log(`[PH] no rows from this endpoint`)
        continue
      }

      console.log(`[PH] klines ${phSymbol}: ${rows.length} rows, sample:`, JSON.stringify(rows[0]).slice(0, 150))

      let results = []
      if (Array.isArray(rows[0])) {
        // Detect price scale by comparing to ticker
        let scale = 1
        if (tickerPrice > 0) {
          const lastClose = rows[rows.length - 1][6] || rows[rows.length - 1][4]
          if (lastClose > 0) {
            const ratio = lastClose / tickerPrice
            if (ratio > 5) { scale = Math.pow(10, Math.round(Math.log10(ratio))) }
          }
          console.log(`[PH] klines scale=${scale} (tickerPrice=${tickerPrice})`)
        }
        results = rows.map(row => {
          const ts = (row[0] || 0) * 1000
          return {
            ts,
            date: new Date(ts).toISOString().slice(0, 13),
            close: (row[6] || row[4] || 0) / scale,
          }
        })
      } else {
        results = rows.map(row => {
          const ts = (row.timestamp || row.t || 0) * 1000
          let close = parseFloat(row.close || row.c || 0)
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
        console.log(`[PH] klines ${phSymbol}: ✅ ${results.length} valid 4h bars`)
        return results
      }
    } catch (e) { console.warn(`[PH] klines err:`, e.message); continue }
  }

  console.warn(`[PH] klines ${phSymbol}: ❌ all endpoints failed`)
  return []
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
        if (data) data.change = await coinbase24h(resolved.sym)
      } else if (resolved.exchange === "phemex") {
        data = await phemexTicker(resolved.sym)
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
