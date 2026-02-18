// Vercel serverless function — proxy to CoinGecko API
// Handles: /api/coingecko/* -> https://api.coingecko.com/api/v3/*
//
// CoinGecko requires an API key even for the free (Demo) tier.
// Set COINGECKO_API_KEY in Vercel Environment Variables.
// Get a free key at: https://www.coingecko.com/en/api/pricing

export default async function handler(req, res) {
  // Parse path from req.url directly — Vercel legacy routes don't inject
  // [...path] into req.query. req.url = "/api/coingecko/simple/price?ids=bitcoin"
  const rawUrl = req.url || ''
  const qIdx = rawUrl.indexOf('?')
  const pathPart = qIdx >= 0 ? rawUrl.slice(0, qIdx) : rawUrl
  const upstreamPath = pathPart.replace(/^\/api\/coingecko\/?/, '')

  const url = new URL(`https://api.coingecko.com/api/v3/${upstreamPath}`)

  // Copy query params from original request
  const queryParams = new URLSearchParams(qIdx >= 0 ? rawUrl.slice(qIdx + 1) : '')
  queryParams.forEach((value, key) => {
    if (key !== 'path') url.searchParams.set(key, value)
  })

  // Include demo API key if set
  const headers = { "Accept": "application/json" }
  const apiKey = (process.env.COINGECKO_API_KEY || '').trim()
  console.log('[CG] key present:', !!apiKey, 'length:', apiKey.length)
  if (apiKey) {
    headers["x-cg-demo-api-key"] = apiKey
  }

  console.log('[CG] calling:', url.toString())

  try {
    const upstream = await fetch(url.toString(), {
      method: req.method,
      headers,
    })
    const data = await upstream.text()
    console.log('[CG] status:', upstream.status)
    res.setHeader("Access-Control-Allow-Origin", "*")
    // Cache 30s, stale 60s — CoinGecko free tier: 30 req/min, 10k/month
    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60")
    res.status(upstream.status).send(data)
  } catch (err) {
    res.status(502).json({ error: "Upstream request failed", detail: err.message })
  }
}
