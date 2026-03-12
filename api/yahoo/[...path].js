// Vercel serverless function — proxy to Yahoo Finance API
// Handles: /api/yahoo/* -> https://query1.finance.yahoo.com/* (with query2 fallback)
//
// NOTE: Vercel legacy "routes" config does NOT inject [...path] into req.query.
// Path must be parsed from req.url directly.
//
// Yahoo Finance rate-limiting strategy:
// - No crumb/cookie fetching (adds extra round-trips that get rate-limited first)
// - Set browser-like headers (UA, Referer, Accept-Language)
// - Try query1 first, fall back to query2

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
const YAHOO_HEADERS = {
  "User-Agent": UA,
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": "https://finance.yahoo.com/",
  "Origin": "https://finance.yahoo.com",
}

export default async function handler(req, res) {
  // Parse path from req.url directly — Vercel legacy routes don't inject
  // [...path] into req.query. req.url = "/api/yahoo/v8/finance/chart/SMR?interval=1d&range=2d"
  const rawUrl = req.url || ''
  const qIdx = rawUrl.indexOf('?')
  const pathPart = qIdx >= 0 ? rawUrl.slice(0, qIdx) : rawUrl
  const upstreamPath = pathPart.replace(/^\/api\/yahoo\/?/, '')

  const queryStr = qIdx >= 0 ? rawUrl.slice(qIdx + 1) : ''

  // Build query params (exclude internal 'path' key)
  const queryParams = new URLSearchParams(queryStr)
  queryParams.delete('path')

  // Try query1 first (less rate-limited), then query2 as fallback
  const bases = [
    `https://query1.finance.yahoo.com/${upstreamPath}`,
    `https://query2.finance.yahoo.com/${upstreamPath}`,
  ]

  for (const base of bases) {
    try {
      const url = new URL(base)
      queryParams.forEach((v, k) => url.searchParams.set(k, v))

      const upstream = await fetch(url.toString(), {
        method: req.method,
        headers: YAHOO_HEADERS,
      })

      // 429 = rate limit, 403 = blocked — try next base
      if (upstream.status === 429 || upstream.status === 403) {
        console.warn(`[YF] ${upstream.status} from ${base.slice(0, 50)}... trying next`)
        continue
      }

      const data = await upstream.text()
      res.setHeader("Access-Control-Allow-Origin", "*")
      res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60")
      res.status(upstream.status).send(data)
      return
    } catch (e) {
      console.warn(`[YF] fetch error for ${base.slice(0, 50)}:`, e.message)
      continue
    }
  }

  // Both query1 and query2 failed
  res.status(429).json({ error: "Yahoo Finance rate limit — both endpoints exhausted" })
}
