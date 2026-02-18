// Vercel serverless function — proxy to Phemex API
// Handles: /api/phemex/* -> https://api.phemex.com/*
//
// NOTE: Vercel legacy "routes" config does NOT inject [...path] into req.query.
// Path must be parsed from req.url directly.

export default async function handler(req, res) {
  // Parse path from req.url directly — Vercel legacy routes don't inject
  // [...path] into req.query. req.url = "/api/phemex/md/v2/ticker/24hr?symbol=CCUSDT"
  const rawUrl = req.url || ''
  const qIdx = rawUrl.indexOf('?')
  const pathPart = qIdx >= 0 ? rawUrl.slice(0, qIdx) : rawUrl
  const upstreamPath = pathPart.replace(/^\/api\/phemex\/?/, '')

  const url = new URL(`https://api.phemex.com/${upstreamPath}`)

  // Copy query params from original request
  const queryParams = new URLSearchParams(qIdx >= 0 ? rawUrl.slice(qIdx + 1) : '')
  queryParams.forEach((value, key) => {
    if (key !== 'path') url.searchParams.set(key, value)
  })

  try {
    const upstream = await fetch(url.toString(), {
      method: req.method,
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
    })
    const data = await upstream.text()
    res.setHeader("Access-Control-Allow-Origin", "*")
    res.setHeader("Cache-Control", "s-maxage=5, stale-while-revalidate=10")
    res.status(upstream.status).send(data)
  } catch (err) {
    res.status(502).json({ error: "Upstream request failed", detail: err.message })
  }
}
