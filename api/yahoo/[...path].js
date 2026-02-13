// Vercel serverless function — proxy to Yahoo Finance API
// Handles: /api/yahoo/* -> https://query2.finance.yahoo.com/*

export default async function handler(req, res) {
  const { path } = req.query
  const upstreamPath = Array.isArray(path) ? path.join("/") : (path || "")

  const url = new URL(`https://query2.finance.yahoo.com/${upstreamPath}`)
  Object.entries(req.query).forEach(([key, value]) => {
    if (key !== "path") url.searchParams.set(key, value)
  })

  try {
    const upstream = await fetch(url.toString(), {
      method: req.method,
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0",
      },
    })
    const data = await upstream.text()
    res.setHeader("Access-Control-Allow-Origin", "*")
    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60")
    res.status(upstream.status).send(data)
  } catch (err) {
    res.status(502).json({ error: "Upstream request failed", detail: err.message })
  }
}
