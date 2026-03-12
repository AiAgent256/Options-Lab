// Vercel serverless function — proxy to YGOPRODeck API
// Handles: /api/yugioh/* -> https://db.ygoprodeck.com/*
//
// No API key needed. Rate limit: 20 req/sec.

export default async function handler(req, res) {
  const rawUrl = req.url || ''
  const qIdx = rawUrl.indexOf('?')
  const pathPart = qIdx >= 0 ? rawUrl.slice(0, qIdx) : rawUrl
  const upstreamPath = pathPart.replace(/^\/api\/yugioh\/?/, '')

  const url = new URL(`https://db.ygoprodeck.com/${upstreamPath}`)

  const queryParams = new URLSearchParams(qIdx >= 0 ? rawUrl.slice(qIdx + 1) : '')
  queryParams.forEach((value, key) => {
    if (key !== 'path') url.searchParams.set(key, value)
  })

  try {
    const upstream = await fetch(url.toString(), {
      method: req.method,
      headers: { "Accept": "application/json" },
    })
    const data = await upstream.text()
    res.setHeader("Access-Control-Allow-Origin", "*")
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600")
    res.status(upstream.status).send(data)
  } catch (err) {
    res.status(502).json({ error: "Upstream request failed", detail: err.message })
  }
}
