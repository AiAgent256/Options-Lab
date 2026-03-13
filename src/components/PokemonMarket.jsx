import React, { useState, useMemo, useCallback } from "react"
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts"
import { usePokemonMarket, getBestPrice } from "../hooks/usePokemonMarket"
import { fmtDollar, fmtPnlPct } from "../utils/format"
import { COLORS, FONTS } from "../utils/constants"

// ─── STYLES (reuse Portfolio pattern) ───────────────────────────────────────
const S = {
  container: { padding: 24, maxWidth: 1400, margin: "0 auto", fontFamily: FONTS.mono, color: COLORS.text.primary },
  sectionTitle: {
    fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1.2px",
    color: COLORS.text.dim, marginBottom: 12, display: "flex", alignItems: "center", gap: 8,
  },
  divider: { flex: 1, height: 1, background: COLORS.border.primary },
  card: {
    background: COLORS.bg.elevated, border: `1px solid ${COLORS.border.secondary}`,
    borderRadius: 8, overflow: "hidden",
  },
  summaryRow: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 24 },
  summaryCard: { padding: "14px 16px", background: COLORS.bg.elevated, border: `1px solid ${COLORS.border.secondary}`, borderRadius: 8 },
  cardLabel: { fontSize: 9, color: COLORS.text.dim, textTransform: "uppercase", letterSpacing: "0.5px" },
  cardValue: { fontSize: 18, fontWeight: 600, marginTop: 4 },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 11 },
  th: {
    padding: "10px 12px", textAlign: "left", fontSize: 9, color: COLORS.text.dim,
    textTransform: "uppercase", letterSpacing: "0.5px", borderBottom: `1px solid ${COLORS.border.secondary}`,
    background: COLORS.bg.elevated, position: "sticky", top: 0,
  },
  td: { padding: "10px 12px", borderBottom: `1px solid ${COLORS.border.primary}`, color: COLORS.text.secondary },
  btn: {
    padding: "5px 12px", fontSize: 10, fontFamily: FONTS.mono, cursor: "pointer", borderRadius: 4,
    border: `1px solid ${COLORS.border.secondary}`, background: COLORS.bg.elevated, color: COLORS.text.muted,
    transition: "all 0.15s",
  },
  btnPrimary: {
    padding: "5px 12px", fontSize: 10, fontFamily: FONTS.mono, cursor: "pointer", borderRadius: 4,
    border: `1px solid ${COLORS.accent.blueBorder}`, background: COLORS.accent.blueBg, color: COLORS.accent.blue,
  },
  btnDanger: {
    padding: "4px 8px", fontSize: 9, fontFamily: FONTS.mono, cursor: "pointer", borderRadius: 3,
    border: `1px solid ${COLORS.negative.border}`, background: COLORS.negative.bg, color: COLORS.negative.text,
  },
  btnSuccess: {
    padding: "4px 8px", fontSize: 9, fontFamily: FONTS.mono, cursor: "pointer", borderRadius: 3,
    border: `1px solid ${COLORS.positive.border}`, background: COLORS.positive.bg, color: COLORS.positive.text,
  },
  input: {
    background: COLORS.bg.input, border: `1px solid ${COLORS.border.secondary}`, color: COLORS.text.primary,
    padding: "5px 8px", borderRadius: 4, fontFamily: FONTS.mono, fontSize: 11, outline: "none", width: "100%",
  },
  badge: (color) => ({
    display: "inline-block", padding: "2px 6px", borderRadius: 3, fontSize: 8,
    fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px",
    background: color + "22", color: color, border: `1px solid ${color}44`,
  }),
}

const pnlColor = (v) => v >= 0 ? COLORS.positive.text : COLORS.negative.text

// ─── CHART TOOLTIP ──────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: COLORS.bg.elevated, border: `1px solid ${COLORS.border.secondary}`,
      borderRadius: 6, padding: "8px 12px", fontSize: 10, fontFamily: FONTS.mono,
    }}>
      <div style={{ color: COLORS.text.dim, marginBottom: 4 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color, display: "flex", gap: 8 }}>
          <span>Price:</span>
          <span style={{ fontWeight: 600 }}>{fmtDollar(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

// ─── MINI SPARKLINE ─────────────────────────────────────────────────────────
function Sparkline({ data, width = 80, height = 28 }) {
  if (!data?.length || data.length < 2) {
    return <span style={{ fontSize: 9, color: COLORS.text.dim }}>—</span>
  }
  const isUp = data[data.length - 1].price >= data[0].price
  const color = isUp ? COLORS.positive.text : COLORS.negative.text
  return (
    <ResponsiveContainer width={width} height={height}>
      <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 2 }}>
        <Area type="monotone" dataKey="price" stroke={color} fill={color + "30"} strokeWidth={1.5} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

// ─── MAIN COMPONENT ─────────────────────────────────────────────────────────
export default function PokemonMarket() {
  const {
    watchlist, watchlistPrices, loading,
    addCard, removeCard, refreshPrices,
    searchQuery, setSearchQuery, searchResults, searching, doSearch,
    selectedCard, setSelectedCard, selectedRange, setSelectedRange,
    getChartData, getPctChanges,
    trendingCards, loadingTrending,
  } = usePokemonMarket()

  const [searchInput, setSearchInput] = useState("")

  const handleSearch = useCallback((e) => {
    e.preventDefault()
    setSearchQuery(searchInput)
    doSearch(searchInput)
  }, [searchInput, doSearch, setSearchQuery])

  // ── Summary stats ──
  const summary = useMemo(() => {
    let totalValue = 0
    let biggestGainer = null
    let biggestLoser = null

    watchlist.forEach(c => {
      const p = watchlistPrices[c.id]
      if (!p?.market) return
      totalValue += p.market

      const changes = getPctChanges(c.id, p.market)
      const pct = changes.pct7d
      if (pct != null) {
        if (!biggestGainer || pct > biggestGainer.pct) biggestGainer = { name: c.name, pct }
        if (!biggestLoser || pct < biggestLoser.pct) biggestLoser = { name: c.name, pct }
      }
    })

    return { totalValue, tracked: watchlist.length, biggestGainer, biggestLoser }
  }, [watchlist, watchlistPrices, getPctChanges])

  // ── Chart data for selected card ──
  const chartData = useMemo(() => {
    if (!selectedCard) return []
    return getChartData(selectedCard.id, selectedRange)
  }, [selectedCard, selectedRange, getChartData])

  const selectedPrice = selectedCard ? watchlistPrices[selectedCard.id] : null

  return (
    <div style={S.container}>

      {/* ── HEADER ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h2 style={{ fontFamily: FONTS.display, fontSize: 20, fontWeight: 700, color: COLORS.text.primary, margin: 0 }}>
            Pokemon Market
          </h2>
          <p style={{ fontSize: 10, color: COLORS.text.dim, marginTop: 4, margin: 0 }}>
            Track prices, trends, and market data for Pokemon TCG cards
          </p>
        </div>
        <button onClick={refreshPrices} disabled={loading} style={S.btnPrimary}>
          {loading ? "Refreshing..." : "Refresh Prices"}
        </button>
      </div>

      {/* ── SUMMARY CARDS ── */}
      <div style={S.summaryRow}>
        <div style={S.summaryCard}>
          <div style={S.cardLabel}>Watchlist Value</div>
          <div style={{ ...S.cardValue, color: COLORS.accent.blue }}>{fmtDollar(summary.totalValue)}</div>
        </div>
        <div style={S.summaryCard}>
          <div style={S.cardLabel}>Cards Tracked</div>
          <div style={S.cardValue}>{summary.tracked}</div>
        </div>
        <div style={S.summaryCard}>
          <div style={S.cardLabel}>Biggest Gainer (7d)</div>
          {summary.biggestGainer ? (
            <>
              <div style={{ ...S.cardValue, color: COLORS.positive.text }}>{fmtPnlPct(summary.biggestGainer.pct)}</div>
              <div style={{ fontSize: 9, color: COLORS.text.dim, marginTop: 2 }}>{summary.biggestGainer.name}</div>
            </>
          ) : <div style={{ ...S.cardValue, color: COLORS.text.dim }}>—</div>}
        </div>
        <div style={S.summaryCard}>
          <div style={S.cardLabel}>Biggest Loser (7d)</div>
          {summary.biggestLoser && summary.biggestLoser.pct < 0 ? (
            <>
              <div style={{ ...S.cardValue, color: COLORS.negative.text }}>{fmtPnlPct(summary.biggestLoser.pct)}</div>
              <div style={{ fontSize: 9, color: COLORS.text.dim, marginTop: 2 }}>{summary.biggestLoser.name}</div>
            </>
          ) : <div style={{ ...S.cardValue, color: COLORS.text.dim }}>—</div>}
        </div>
      </div>

      {/* ── SEARCH ── */}
      <div style={S.sectionTitle}>
        <span>Search Cards</span>
        <div style={S.divider} />
      </div>
      <form onSubmit={handleSearch} style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
          placeholder="Search by card name (e.g. Charizard, Pikachu VMAX)..."
          style={{ ...S.input, flex: 1 }}
        />
        <button type="submit" disabled={searching} style={S.btnPrimary}>
          {searching ? "Searching..." : "Search"}
        </button>
      </form>

      {/* Search results */}
      {searchResults && (
        <div style={{ ...S.card, marginBottom: 24, maxHeight: 400, overflowY: "auto" }}>
          {searchResults.cards.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: COLORS.text.dim, fontSize: 11 }}>
              No cards found. Try a different search term.
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 1, background: COLORS.border.primary }}>
              {searchResults.cards.map(card => {
                const bp = getBestPrice(card.prices)
                const onWatchlist = watchlist.some(c => c.id === card.id)
                return (
                  <div key={card.id} style={{
                    background: COLORS.bg.elevated, padding: 12,
                    display: "flex", flexDirection: "column", gap: 8,
                  }}>
                    <div style={{ display: "flex", gap: 10 }}>
                      {card.image && (
                        <img src={card.image} alt={card.name} style={{ width: 50, height: 70, objectFit: "contain", borderRadius: 4 }} />
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.text.primary, lineHeight: 1.3 }}>
                          {card.name}
                        </div>
                        <div style={{ fontSize: 9, color: COLORS.text.dim, marginTop: 2 }}>
                          {card.setName} #{card.number}
                        </div>
                        {card.rarity && (
                          <div style={{ marginTop: 3 }}>
                            <span style={S.badge(COLORS.purple.text)}>{card.rarity}</span>
                          </div>
                        )}
                        {bp?.market && (
                          <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.positive.text, marginTop: 4 }}>
                            {fmtDollar(bp.market)}
                          </div>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => !onWatchlist && addCard({ ...card, variant: bp?.variant })}
                      disabled={onWatchlist}
                      style={onWatchlist ? { ...S.btn, opacity: 0.5, cursor: "default" } : S.btnSuccess}
                    >
                      {onWatchlist ? "On Watchlist" : "+ Add to Watchlist"}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
          <div style={{ padding: "8px 12px", fontSize: 9, color: COLORS.text.dim, borderTop: `1px solid ${COLORS.border.primary}` }}>
            Showing {searchResults.cards.length} of {searchResults.totalCount} results
          </div>
        </div>
      )}

      {/* ── WATCHLIST TABLE ── */}
      {watchlist.length > 0 && (
        <>
          <div style={S.sectionTitle}>
            <span>Watchlist</span>
            <div style={S.divider} />
            {loading && <span style={{ fontSize: 9, color: COLORS.accent.blue }}>Updating...</span>}
          </div>
          <div style={{ ...S.card, marginBottom: 24 }}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>Card</th>
                  <th style={{ ...S.th, textAlign: "right" }}>Price</th>
                  <th style={{ ...S.th, textAlign: "right" }}>Variant</th>
                  <th style={{ ...S.th, textAlign: "center" }}>7d</th>
                  <th style={{ ...S.th, textAlign: "center" }}>30d</th>
                  <th style={{ ...S.th, textAlign: "center" }}>90d</th>
                  <th style={{ ...S.th, textAlign: "center" }}>Trend</th>
                  <th style={{ ...S.th, textAlign: "center" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {watchlist.map(card => {
                  const p = watchlistPrices[card.id]
                  const changes = p?.market ? getPctChanges(card.id, p.market) : {}
                  const sparkData = getChartData(card.id, "30d")
                  const isSelected = selectedCard?.id === card.id

                  return (
                    <tr key={card.id}
                      onClick={() => setSelectedCard(isSelected ? null : card)}
                      style={{
                        cursor: "pointer",
                        background: isSelected ? COLORS.accent.blueBg : "transparent",
                        transition: "background 0.15s",
                      }}
                    >
                      <td style={S.td}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          {card.image && (
                            <img src={card.image} alt="" style={{ width: 30, height: 42, objectFit: "contain", borderRadius: 3 }} />
                          )}
                          <div>
                            <div style={{ fontWeight: 600, color: COLORS.text.primary, fontSize: 11 }}>{card.name}</div>
                            <div style={{ fontSize: 9, color: COLORS.text.dim }}>{card.setName} #{card.number}</div>
                          </div>
                        </div>
                      </td>
                      <td style={{ ...S.td, textAlign: "right", fontWeight: 600, color: COLORS.text.primary }}>
                        {p?.market ? fmtDollar(p.market) : "—"}
                      </td>
                      <td style={{ ...S.td, textAlign: "right" }}>
                        {p?.variant && <span style={S.badge(COLORS.purple.text)}>{p.variant}</span>}
                      </td>
                      <td style={{ ...S.td, textAlign: "center", color: changes.pct7d != null ? pnlColor(changes.pct7d) : COLORS.text.dim }}>
                        {changes.pct7d != null ? fmtPnlPct(changes.pct7d) : "—"}
                      </td>
                      <td style={{ ...S.td, textAlign: "center", color: changes.pct30d != null ? pnlColor(changes.pct30d) : COLORS.text.dim }}>
                        {changes.pct30d != null ? fmtPnlPct(changes.pct30d) : "—"}
                      </td>
                      <td style={{ ...S.td, textAlign: "center", color: changes.pct90d != null ? pnlColor(changes.pct90d) : COLORS.text.dim }}>
                        {changes.pct90d != null ? fmtPnlPct(changes.pct90d) : "—"}
                      </td>
                      <td style={{ ...S.td, textAlign: "center" }}>
                        <Sparkline data={sparkData} />
                      </td>
                      <td style={{ ...S.td, textAlign: "center" }}>
                        <button
                          onClick={(e) => { e.stopPropagation(); removeCard(card.id) }}
                          style={S.btnDanger}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── PRICE CHART (selected card) ── */}
      {selectedCard && (
        <>
          <div style={S.sectionTitle}>
            <span>Price Chart — {selectedCard.name}</span>
            <div style={S.divider} />
          </div>
          <div style={{ ...S.card, padding: 16, marginBottom: 24 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {selectedCard.image && (
                  <img src={selectedCard.image} alt="" style={{ width: 40, height: 56, objectFit: "contain", borderRadius: 4 }} />
                )}
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.text.primary, fontFamily: FONTS.display }}>
                    {selectedCard.name}
                  </div>
                  <div style={{ fontSize: 10, color: COLORS.text.dim }}>
                    {selectedCard.setName} #{selectedCard.number}
                  </div>
                  {selectedPrice?.market && (
                    <div style={{ fontSize: 16, fontWeight: 700, color: COLORS.positive.text, marginTop: 4 }}>
                      {fmtDollar(selectedPrice.market)}
                    </div>
                  )}
                </div>
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                {["7d", "30d", "90d", "all"].map(r => (
                  <button key={r} onClick={() => setSelectedRange(r)} style={{
                    ...S.btn,
                    ...(selectedRange === r ? { background: COLORS.accent.blueBg, borderColor: COLORS.accent.blueBorder, color: COLORS.accent.blue } : {}),
                  }}>
                    {r.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            {chartData.length >= 2 ? (
              <ResponsiveContainer width="100%" height={250}>
                <AreaChart data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                  <defs>
                    <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={COLORS.accent.blue} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={COLORS.accent.blue} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="date" tick={{ fontSize: 9, fill: COLORS.text.dim }} tickLine={false} axisLine={false}
                    tickFormatter={(d) => d.split("T")[0].slice(5)}
                  />
                  <YAxis
                    tick={{ fontSize: 9, fill: COLORS.text.dim }} tickLine={false} axisLine={false}
                    tickFormatter={(v) => `$${v}`} domain={["auto", "auto"]} width={50}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Area type="monotone" dataKey="price" stroke={COLORS.accent.blue} fill="url(#priceGradient)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ height: 250, display: "flex", alignItems: "center", justifyContent: "center", color: COLORS.text.dim, fontSize: 11 }}>
                Not enough data yet — snapshots are recorded every 2 hours when you visit.
                <br />Check back later for a price chart.
              </div>
            )}

            {/* Price details */}
            {selectedPrice && (
              <div style={{ display: "flex", gap: 24, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${COLORS.border.primary}` }}>
                {selectedPrice.low != null && (
                  <div>
                    <div style={S.cardLabel}>Low</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.negative.text }}>{fmtDollar(selectedPrice.low)}</div>
                  </div>
                )}
                {selectedPrice.mid != null && (
                  <div>
                    <div style={S.cardLabel}>Mid</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.text.primary }}>{fmtDollar(selectedPrice.mid)}</div>
                  </div>
                )}
                {selectedPrice.market != null && (
                  <div>
                    <div style={S.cardLabel}>Market</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.positive.text }}>{fmtDollar(selectedPrice.market)}</div>
                  </div>
                )}
                {selectedPrice.high != null && (
                  <div>
                    <div style={S.cardLabel}>High</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.warning.text }}>{fmtDollar(selectedPrice.high)}</div>
                  </div>
                )}
                {selectedPrice.updatedAt && (
                  <div>
                    <div style={S.cardLabel}>Last Updated</div>
                    <div style={{ fontSize: 11, color: COLORS.text.muted }}>{selectedPrice.updatedAt}</div>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── MARKET OVERVIEW / TRENDING ── */}
      <div style={S.sectionTitle}>
        <span>Market Overview — Trending Cards</span>
        <div style={S.divider} />
        {loadingTrending && <span style={{ fontSize: 9, color: COLORS.accent.blue }}>Loading...</span>}
      </div>
      {trendingCards.length > 0 ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12, marginBottom: 24 }}>
          {trendingCards.map(card => {
            const bp = getBestPrice(card.prices)
            const onWatchlist = watchlist.some(c => c.id === card.id)
            return (
              <div key={card.id} style={{
                ...S.summaryCard, padding: 12, display: "flex", flexDirection: "column", gap: 8,
                cursor: "pointer", transition: "border-color 0.15s",
              }}
                onClick={() => !onWatchlist && addCard({ ...card, variant: bp?.variant })}
              >
                <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  {card.image && (
                    <img src={card.image} alt="" style={{ width: 40, height: 56, objectFit: "contain", borderRadius: 3 }} />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: COLORS.text.primary, lineHeight: 1.3 }}>
                      {card.name}
                    </div>
                    <div style={{ fontSize: 8, color: COLORS.text.dim, marginTop: 2 }}>
                      {card.setName}
                    </div>
                    {card.rarity && (
                      <div style={{ marginTop: 3 }}>
                        <span style={S.badge(COLORS.purple.text)}>{card.rarity}</span>
                      </div>
                    )}
                  </div>
                </div>
                {bp?.market && (
                  <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.positive.text }}>
                    {fmtDollar(bp.market)}
                  </div>
                )}
                {bp?.variant && (
                  <div style={{ fontSize: 8, color: COLORS.text.dim }}>{bp.variant}</div>
                )}
                {onWatchlist && (
                  <div style={{ fontSize: 8, color: COLORS.accent.blue }}>On watchlist</div>
                )}
              </div>
            )
          })}
        </div>
      ) : !loadingTrending ? (
        <div style={{ ...S.card, padding: 24, textAlign: "center", color: COLORS.text.dim, fontSize: 11, marginBottom: 24 }}>
          Loading trending cards from popular sets...
        </div>
      ) : null}

      {/* ── EMPTY STATE ── */}
      {watchlist.length === 0 && !searchResults && (
        <div style={{ ...S.card, padding: 40, textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🔍</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.text.primary, fontFamily: FONTS.display, marginBottom: 8 }}>
            Start Tracking Pokemon Cards
          </div>
          <div style={{ fontSize: 11, color: COLORS.text.dim, maxWidth: 400, margin: "0 auto", lineHeight: 1.6 }}>
            Search for any Pokemon card above to add it to your watchlist.
            Prices update from TCGPlayer every 5 minutes, and price history
            is recorded every 2 hours for charts and trend analysis.
          </div>
        </div>
      )}
    </div>
  )
}
