// Vercel serverless function — proxy to Yahoo Finance API
// Handles: /api/yahoo/* -> https://query2.finance.yahoo.com/*
//
// Yahoo now requires a crumb + cookie for v8 API access.
// This proxy fetches a session cookie first, then uses it for the actual request.

let cachedCrumb = null
let cachedCookie = null
let crumbExpiry = 0

async function getCrumbAndCookie() {
  const now = Date.now()
  if (cachedCrumb && cachedCookie && now < crumbExpiry) {
    return { crumb: cachedCrumb, cookie: cachedCookie }
  }

  const headers = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  }

  // Step 1: Visit Yahoo Finance to get session cookies
  const pageRes = await fetch("https://finance.yahoo.com/quote/AAPL/", {
    headers,
    redirect: "follow",
  })

  const setCookies = pageRes.headers.getSetCookie?.() || []
  const cookieStr = setCookies.map(c => c.split(";")[0]).join("; ")

  // Step 2: Get the crumb using the cookies
  const crumbRes = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
    headers: { ...headers, "Cookie": cookieStr },
  })

  if (!crumbRes.ok) {
    // Fallback: try without crumb (some endpoints still work)
    return { crumb: null, cookie: null }
  }

  const crumb = await crumbRes.text()

  cachedCrumb = crumb
  cachedCookie = cookieStr
  crumbExpiry = now + 5 * 60 * 1000 // Cache for 5 minutes

  return { crumb, cookie: cookieStr }
}

export default async function handler(req, res) {
  const { path } = req.query
  const upstreamPath = Array.isArray(path) ? path.join("/") : (path || "")

  const url = new URL(`https://query2.finance.yahoo.com/${upstreamPath}`)
  Object.entries(req.query).forEach(([key, value]) => {
    if (key !== "path") url.searchParams.set(key, value)
  })

  try {
    // Try to get crumb + cookie for authenticated requests
    const { crumb, cookie } = await getCrumbAndCookie()

    // Append crumb to query params if available
    if (crumb) {
      url.searchParams.set("crumb", crumb)
    }

    const headers = {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "application/json,text/html,application/xhtml+xml",
    }
    if (cookie) {
      headers["Cookie"] = cookie
    }

    const upstream = await fetch(url.toString(), {
      method: req.method,
      headers,
    })

    // If first attempt fails, retry without crumb (fallback for query1)
    if (!upstream.ok && crumb) {
      url.searchParams.delete("crumb")
      const fallbackUrl = url.toString().replace("query2.finance", "query1.finance")
      const fallback = await fetch(fallbackUrl, {
        method: req.method,
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "application/json",
        },
      })
      const data = await fallback.text()
      res.setHeader("Access-Control-Allow-Origin", "*")
      res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60")
      res.status(fallback.status).send(data)
      return
    }

    const data = await upstream.text()
    res.setHeader("Access-Control-Allow-Origin", "*")
    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60")
    res.status(upstream.status).send(data)
  } catch (err) {
    res.status(502).json({ error: "Upstream request failed", detail: err.message })
  }
}
