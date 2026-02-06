import { useState, useEffect, useCallback } from 'react'

/**
 * Fetch historical kline (candlestick) data from Binance public API.
 * Free, no API key required. Rate limited to 1200 req/min.
 *
 * @param {string} symbol - e.g. "BTCUSDT"
 * @param {string} interval - e.g. "1d", "4h", "1h"
 * @param {number} limit - Number of candles (max 1000)
 * @param {number|null} startTime - Unix ms start time
 */
export function useBinanceKlines(symbol, interval = "1d", limit = 365, startTime = null) {
  const [klines, setKlines] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!symbol) { setKlines([]); return }

    let cancelled = false
    setLoading(true)
    setError(null)

    const url = new URL("https://api.binance.com/api/v3/klines")
    url.searchParams.set("symbol", symbol.toUpperCase())
    url.searchParams.set("interval", interval)
    url.searchParams.set("limit", String(Math.min(limit, 1000)))
    if (startTime) url.searchParams.set("startTime", String(startTime))

    fetch(url.toString())
      .then(res => {
        if (!res.ok) throw new Error(`Binance API ${res.status}`)
        return res.json()
      })
      .then(data => {
        if (cancelled) return
        // Binance kline format: [openTime, open, high, low, close, volume, closeTime, ...]
        const parsed = data.map(k => ({
          time: k[0],
          date: new Date(k[0]).toISOString().split("T")[0],
          open: parseFloat(k[1]),
          high: parseFloat(k[2]),
          low: parseFloat(k[3]),
          close: parseFloat(k[4]),
          volume: parseFloat(k[5]),
          quoteVolume: parseFloat(k[7]),
        }))
        setKlines(parsed)
        setLoading(false)
      })
      .catch(err => {
        if (cancelled) return
        setError(err.message)
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [symbol, interval, limit, startTime])

  return { klines, loading, error }
}

/**
 * Fetch current price for a Binance symbol (single REST call).
 * Useful for initial load before WebSocket connects.
 */
export async function fetchBinancePrice(symbol) {
  try {
    const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol.toUpperCase()}`)
    if (!res.ok) return null
    const data = await res.json()
    return parseFloat(data.price)
  } catch { return null }
}

/**
 * Fetch 24h ticker for multiple symbols in one call.
 */
export async function fetchBinanceTickers(symbols) {
  try {
    const res = await fetch("https://api.binance.com/api/v3/ticker/24hr")
    if (!res.ok) return {}
    const data = await res.json()
    const map = {}
    data.forEach(t => {
      if (symbols.includes(t.symbol)) {
        map[t.symbol] = {
          price: parseFloat(t.lastPrice),
          change: parseFloat(t.priceChangePercent),
          high: parseFloat(t.highPrice),
          low: parseFloat(t.lowPrice),
          volume: parseFloat(t.quoteVolume),
        }
      }
    })
    return map
  } catch { return {} }
}

/**
 * Fetch klines for multiple symbols since specific dates. Returns { symbol: klines[] }
 */
export async function fetchMultiKlines(requests) {
  const results = {}
  // Batch with small concurrency to respect rate limits
  const chunks = []
  for (let i = 0; i < requests.length; i += 3) chunks.push(requests.slice(i, i + 3))

  for (const chunk of chunks) {
    const promises = chunk.map(async ({ symbol, startTime, interval = "1d" }) => {
      try {
        const url = new URL("https://api.binance.com/api/v3/klines")
        url.searchParams.set("symbol", symbol.toUpperCase())
        url.searchParams.set("interval", interval)
        url.searchParams.set("limit", "1000")
        if (startTime) url.searchParams.set("startTime", String(startTime))
        const res = await fetch(url.toString())
        if (!res.ok) return { symbol, klines: [] }
        const data = await res.json()
        return {
          symbol,
          klines: data.map(k => ({
            time: k[0], date: new Date(k[0]).toISOString().split("T")[0],
            close: parseFloat(k[4]),
          })),
        }
      } catch { return { symbol, klines: [] } }
    })
    const res = await Promise.all(promises)
    res.forEach(r => { results[r.symbol] = r.klines })
  }
  return results
}
