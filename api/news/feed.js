// Vercel serverless function — News feed aggregator
// Fetches from Finviz RSS and returns parsed JSON

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=300")

  const results = []

  // ─── Finviz News RSS ───
  try {
    const finvizRes = await fetch("https://finviz.com/news_rss.ashx", {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; OptionsLab/1.0)" }
    })
    if (finvizRes.ok) {
      const xml = await finvizRes.text()
      const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || []
      for (const item of items.slice(0, 40)) {
        const title = (item.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) || item.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || ""
        const link = (item.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || ""
        const pubDate = (item.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || ""
        const source = (item.match(/<source[^>]*>([\s\S]*?)<\/source>/) || item.match(/<dc:creator>([\s\S]*?)<\/dc:creator>/) || [])[1] || ""
        if (title) {
          results.push({ title: title.trim(), url: link.trim(), time: pubDate ? new Date(pubDate).toISOString() : null, source: source.trim() || "Finviz", category: "market" })
        }
      }
    }
  } catch (e) { console.warn("Finviz RSS error:", e.message) }

  // ─── Finviz Blog RSS ───
  try {
    const blogRes = await fetch("https://finviz.com/blog_rss.ashx", {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; OptionsLab/1.0)" }
    })
    if (blogRes.ok) {
      const xml = await blogRes.text()
      const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || []
      for (const item of items.slice(0, 30)) {
        const title = (item.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) || item.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || ""
        const link = (item.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || ""
        const pubDate = (item.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || ""
        const source = (item.match(/<source[^>]*>([\s\S]*?)<\/source>/) || item.match(/<dc:creator>([\s\S]*?)<\/dc:creator>/) || [])[1] || ""
        if (title) {
          results.push({ title: title.trim(), url: link.trim(), time: pubDate ? new Date(pubDate).toISOString() : null, source: source.trim() || "Blog", category: "blog" })
        }
      }
    }
  } catch (e) { console.warn("Finviz Blog RSS error:", e.message) }

  results.sort((a, b) => {
    if (!a.time) return 1; if (!b.time) return -1
    return new Date(b.time) - new Date(a.time)
  })

  res.status(200).json({ items: results, fetchedAt: new Date().toISOString() })
}
