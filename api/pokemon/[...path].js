// Vercel serverless function — proxy to Pokemon TCG API
// Handles: /api/pokemon/* -> https://api.pokemontcg.io/*
//
// Optional API key via POKEMON_TCG_API_KEY env var (20K req/day with key).
// Get a free key at: https://dev.pokemontcg.io

export default async function handler(req, res) {
  const rawUrl = req.url || ''
  const qIdx = rawUrl.indexOf('?')
  const pathPart = qIdx >= 0 ? rawUrl.slice(0, qIdx) : rawUrl
  const upstreamPath = pathPart.replace(/^\/api\/pokemon\/?/, '')

  const url = new URL(`https://api.pokemontcg.io/${upstreamPath}`)

  const queryParams = new URLSearchParams(qIdx >= 0 ? rawUrl.slice(qIdx + 1) : '')
  queryParams.forEach((value, key) => {
    if (key !== 'path') url.searchParams.set(key, value)
  })

  const headers = { "Accept": "application/json" }
  const apiKey = (process.env.POKEMON_TCG_API_KEY || '').trim()
  if (apiKey) {
    headers["X-Api-Key"] = apiKey
  }

  try {
    const upstream = await fetch(url.toString(), { method: req.method, headers })
    const data = await upstream.text()
    res.setHeader("Access-Control-Allow-Origin", "*")
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600")
    res.status(upstream.status).send(data)
  } catch (err) {
    res.status(502).json({ error: "Upstream request failed", detail: err.message })
  }
}
