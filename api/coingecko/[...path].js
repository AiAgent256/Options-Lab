// Vercel serverless function — proxy to CoinGecko API (free tier, no auth)
// Handles: /api/coingecko/* -> https://api.coingecko.com/api/v3/*

export default async function handler(req, res) {
  const { path } = req.query
  const upstreamPath = Array.isArray(path) ? path.join("/") : (path || "")

  const url = new URL(`https://api.coingecko.com/api/v3/${upstreamPath}`)
  Object.entries(req.query).forEach(([key, value]) => {
    if (key !== "path") url.searchParams.set(key, value)
  })

  try {
    const upstream = await fetch(url.toString(), {
      method: req.method,
      headers: {
        "Accept": "application/json",
      },
    })
    const data = await upstream.text()
    res.setHeader("Access-Control-Allow-Origin", "*")
    // Cache for 30s, stale for 60s — CoinGecko free tier rate limit is ~30 req/min
    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60")
    res.status(upstream.status).send(data)
  } catch (err) {
    res.status(502).json({ error: "Upstream request failed", detail: err.message })
  }
}
