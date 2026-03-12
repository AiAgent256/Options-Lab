// Vercel serverless function — proxy to PriceCharting API
// Handles: /api/pricecharting/* -> https://www.pricecharting.com/api/*
//
// Requires PRICECHARTING_API_KEY env var (Legendary subscription, $49/mo).
// Get your token at: https://www.pricecharting.com/subscriptions
// Rate limit: 1 request per second.

export default async function handler(req, res) {
  const rawUrl = req.url || ''
  const qIdx = rawUrl.indexOf('?')
  const pathPart = qIdx >= 0 ? rawUrl.slice(0, qIdx) : rawUrl
  const upstreamPath = pathPart.replace(/^\/api\/pricecharting\/?/, '')

  const apiKey = (process.env.PRICECHARTING_API_KEY || '').trim()
  if (!apiKey) {
    res.status(503).json({ error: "PriceCharting API key not configured" })
    return
  }

  const url = new URL(`https://www.pricecharting.com/api/${upstreamPath}`)

  const queryParams = new URLSearchParams(qIdx >= 0 ? rawUrl.slice(qIdx + 1) : '')
  queryParams.forEach((value, key) => {
    if (key !== 'path') url.searchParams.set(key, value)
  })
  url.searchParams.set('t', apiKey)

  try {
    const upstream = await fetch(url.toString(), {
      method: req.method,
      headers: { "Accept": "application/json" },
    })
    const data = await upstream.text()
    res.setHeader("Access-Control-Allow-Origin", "*")
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=7200")
    res.status(upstream.status).send(data)
  } catch (err) {
    res.status(502).json({ error: "Upstream request failed", detail: err.message })
  }
}
