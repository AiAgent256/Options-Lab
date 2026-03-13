/**
 * pokemonMarketPersistence.js — localStorage persistence for Pokemon Market watchlist & snapshots.
 *
 * Watchlist: array of card objects { id, name, setName, setId, number, variant, image, addedAt }
 * Snapshots: { [cardId]: [ { date, price }, ... ] } — one entry per 2h bucket
 */

const WATCHLIST_KEY = "pokemon_market_watchlist"
const SNAPSHOTS_KEY = "pokemon_market_snapshots"

// ─── WATCHLIST ──────────────────────────────────────────────────────────────

export function loadWatchlist() {
  try {
    const raw = localStorage.getItem(WATCHLIST_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

export function saveWatchlist(list) {
  localStorage.setItem(WATCHLIST_KEY, JSON.stringify(list))
}

export function addToWatchlist(card) {
  const list = loadWatchlist()
  if (list.some(c => c.id === card.id)) return list
  const updated = [...list, { ...card, addedAt: new Date().toISOString() }]
  saveWatchlist(updated)
  return updated
}

export function removeFromWatchlist(cardId) {
  const list = loadWatchlist().filter(c => c.id !== cardId)
  saveWatchlist(list)
  return list
}

// ─── PRICE SNAPSHOTS ────────────────────────────────────────────────────────

export function loadSnapshots() {
  try {
    const raw = localStorage.getItem(SNAPSHOTS_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

export function saveSnapshots(snapshots) {
  localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(snapshots))
}

/**
 * Record a price snapshot for a card. Uses 2h bucketing to match portfolio.
 * Returns true if a new snapshot was added.
 */
export function recordSnapshot(cardId, price) {
  if (!price || price <= 0) return false

  const now = new Date()
  const h2 = Math.floor(now.getHours() / 2) * 2
  const snapKey = `${now.toISOString().split("T")[0]}T${String(h2).padStart(2, "0")}`

  const all = loadSnapshots()
  if (!all[cardId]) all[cardId] = []

  // Don't duplicate the same bucket
  if (all[cardId].some(s => s.date === snapKey)) return false

  all[cardId].push({ date: snapKey, price })

  // Keep max 2190 entries (~6 months at 12/day)
  if (all[cardId].length > 2190) all[cardId] = all[cardId].slice(-2190)

  saveSnapshots(all)
  return true
}

/**
 * Get snapshots for a card, optionally filtered by range.
 * range: "7d" | "30d" | "90d" | "all"
 */
export function getCardSnapshots(cardId, range = "all") {
  const all = loadSnapshots()
  const snaps = all[cardId] || []
  if (range === "all" || !snaps.length) return snaps

  const days = range === "7d" ? 7 : range === "30d" ? 30 : range === "90d" ? 90 : 9999
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)
  const cutoffStr = cutoff.toISOString().split("T")[0]

  return snaps.filter(s => s.date >= cutoffStr)
}
