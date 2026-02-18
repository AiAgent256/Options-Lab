// Vercel serverless function — proxy to CoinGecko API
// Handles: /api/coingecko/* -> https://api.coingecko.com/api/v3/*
//
// CoinGecko now requires an API key even for the free (Demo) tier.
// Set COINGECKO_API_KEY in Vercel Environment Variables.
// Get a free key at: https://www.coingecko.com/en/api/pricing

export default async function handler(req, res) {
  const { path } = req.query
  const upstreamPath = Array.isArray(path) ? path.join("/") : (path || "")

  const url = new URL(`https://api.coingecko.com/api/v3/${upstreamPath}`)
  Object.entries(req.query).forEach(([key, value]) => {
    if (key !== "path") url.searchParams.set(key, value)
  })

  // Build headers — include demo API key if available
  const headers = { "Accept": "application/json" }
  const apiKey = process.env.COINGECKO_API_KEY
  if (apiKey) {
    headers["x-cg-demo-api-key"] = apiKey
  }

  try {
    const upstream = await fetch(url.toString(), {
      method: req.method,
      headers,
    })
    const data = await upstream.text()
    res.setHeader("Access-Control-Allow-Origin", "*")
    // Cache for 30s, stale for 60s — CoinGecko free tier: 30 req/min, 10k/month
    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60")
    res.status(upstream.status).send(data)
  } catch (err) {
    res.status(502).json({ error: "Upstream request failed", detail: err.message })
  }
}
