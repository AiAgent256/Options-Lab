import React, { useState, useEffect, useRef, useCallback } from "react"

const SOURCE_COLORS = {
  "Wall Street Journal": "#f5a623",
  "WSJ": "#f5a623",
  "Bloomberg": "#f06",
  "Reuters": "#ff8200",
  "CNBC": "#0a6eb4",
  "MarketWatch": "#00ac4e",
  "Financial Times": "#fcd0a0",
  "Barron's": "#1a73e8",
  "Seeking Alpha": "#f7931a",
  "Benzinga": "#00d084",
  "Yahoo Finance": "#6001d2",
  "CoinDesk": "#05c",
  "The Block": "#111",
  "default": "#4a5060",
}

function getSourceColor(source) {
  if (!source) return SOURCE_COLORS.default
  for (const [key, color] of Object.entries(SOURCE_COLORS)) {
    if (source.toLowerCase().includes(key.toLowerCase())) return color
  }
  return SOURCE_COLORS.default
}

function getSourceAbbr(source) {
  if (!source) return "?"
  const abbrs = {
    "wall street journal": "WSJ", "bloomberg": "BB", "reuters": "R",
    "cnbc": "CNBC", "marketwatch": "MW", "financial times": "FT",
    "barron": "B", "seeking alpha": "SA", "benzinga": "BZ",
    "yahoo": "Y!", "coindesk": "CD", "the block": "TB",
    "investopedia": "IP", "insider": "BI", "zerohedge": "ZH",
    "decrypt": "DC", "cointelegraph": "CT", "motley": "MF",
  }
  const lower = source.toLowerCase()
  for (const [key, abbr] of Object.entries(abbrs)) {
    if (lower.includes(key)) return abbr
  }
  return source.slice(0, 2).toUpperCase()
}

function formatTime(isoString) {
  if (!isoString) return ""
  const d = new Date(isoString)
  const now = new Date()
  const diffMs = now - d
  const diffMin = Math.floor(diffMs / 60000)

  if (diffMin < 1) return "now"
  if (diffMin < 60) return `${diffMin}m`
  if (diffMin < 1440) return `${Math.floor(diffMin / 60)}h`
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

export default function NewsPanel() {
  const [news, setNews] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState("all") // all, market, blog
  const scrollRef = useRef(null)

  const fetchNews = useCallback(async () => {
    try {
      const res = await fetch("/api/news/feed")
      if (!res.ok) return
      const data = await res.json()
      if (data.items) setNews(data.items)
    } catch (e) { console.warn("[News] fetch error:", e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    fetchNews()
    const timer = setInterval(fetchNews, 120000) // refresh every 2 min
    return () => clearInterval(timer)
  }, [fetchNews])

  const filtered = filter === "all" ? news : news.filter(n => n.category === filter)

  return (
    <div style={{
      background: "#080a0f", borderTop: "1px solid rgba(255,255,255,0.04)",
      display: "flex", flexDirection: "column", height: "100%", overflow: "hidden",
    }}>
      <style>{`
        .news-item { display: flex; align-items: flex-start; gap: 8px; padding: 5px 12px; transition: background 0.1s; cursor: pointer; text-decoration: none; border-bottom: 1px solid rgba(255,255,255,0.02); }
        .news-item:hover { background: rgba(59,130,246,0.04); }
        .news-filter { padding: 3px 10px; font-size: 9px; font-family: 'JetBrains Mono', monospace; cursor: pointer; border-radius: 2px; border: 1px solid rgba(255,255,255,0.04); background: transparent; color: #3a4050; letter-spacing: 0.04em; font-weight: 500; transition: all 0.12s; }
        .news-filter:hover { color: #6a7080; border-color: rgba(255,255,255,0.08); }
        .news-filter-active { background: rgba(59,130,246,0.08); border-color: rgba(59,130,246,0.2); color: #3b82f6; }
        .news-scroll::-webkit-scrollbar { width: 4px; }
        .news-scroll::-webkit-scrollbar-track { background: transparent; }
        .news-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.06); border-radius: 2px; }
        .news-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.12); }
      `}</style>

      {/* ─── Header ─── */}
      <div style={{
        padding: "6px 12px", display: "flex", alignItems: "center", gap: 8,
        borderBottom: "1px solid rgba(255,255,255,0.04)", flexShrink: 0,
      }}>
        <span style={{
          fontSize: 10, fontWeight: 600, color: "#3a4050",
          fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}>
          News
        </span>

        <div style={{ display: "flex", gap: 3 }}>
          {[["all", "All"], ["market", "Market"], ["blog", "Blogs"]].map(([key, label]) => (
            <button key={key} className={`news-filter ${filter === key ? "news-filter-active" : ""}`}
              onClick={() => setFilter(key)}>
              {label}
            </button>
          ))}
        </div>

        <div style={{ flex: 1 }} />

        <span style={{ fontSize: 8, color: "#2a3040", fontFamily: "'JetBrains Mono', monospace" }}>
          {loading ? "loading..." : `${filtered.length} items`}
        </span>
      </div>

      {/* ─── News list ─── */}
      <div ref={scrollRef} className="news-scroll" style={{
        flex: 1, overflow: "auto", padding: "2px 0",
      }}>
        {loading && (
          <div style={{ padding: 20, textAlign: "center", color: "#2a3040", fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>
            Loading news...
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div style={{ padding: 20, textAlign: "center", color: "#2a3040", fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>
            No news available
          </div>
        )}

        {filtered.map((item, i) => (
          <a key={i} className="news-item" href={item.url} target="_blank" rel="noopener noreferrer">
            {/* Source badge */}
            <span style={{
              fontSize: 8, fontWeight: 700, color: getSourceColor(item.source),
              background: getSourceColor(item.source) + "12",
              padding: "2px 5px", borderRadius: 2, flexShrink: 0, marginTop: 1,
              fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.03em",
              minWidth: 28, textAlign: "center", lineHeight: "14px",
              border: `1px solid ${getSourceColor(item.source)}18`,
            }}>
              {getSourceAbbr(item.source)}
            </span>

            {/* Title */}
            <span style={{
              fontSize: 11, color: "#8892a8", lineHeight: "16px",
              fontFamily: "'DM Sans', -apple-system, sans-serif",
              flex: 1, overflow: "hidden",
              display: "-webkit-box", WebkitLineClamp: 1, WebkitBoxOrient: "vertical",
            }}>
              {item.title}
            </span>

            {/* Time */}
            <span style={{
              fontSize: 9, color: "#2a3040", flexShrink: 0,
              fontFamily: "'JetBrains Mono', monospace", marginTop: 2,
            }}>
              {formatTime(item.time)}
            </span>
          </a>
        ))}
      </div>
    </div>
  )
}
