/**
 * usePokemonMarket.js — Data fetching hook for Pokemon Market tab.
 *
 * Manages watchlist state, price fetching, search, and snapshots.
 * Uses pokemontcg.io via the /api/pokemon proxy.
 */

import { useState, useEffect, useCallback, useRef } from "react"
import {
  loadWatchlist, saveWatchlist, addToWatchlist, removeFromWatchlist,
  recordSnapshot, getCardSnapshots, loadSnapshots,
} from "../lib/pokemonMarketPersistence"

// ─── API HELPERS ────────────────────────────────────────────────────────────

async function searchCards(query, page = 1) {
  if (!query || query.trim().length < 2) return { cards: [], totalCount: 0 }

  // Build search query — support "name set" or just "name"
  const q = `name:"${query.trim()}*"`
  const url = `/api/pokemon/v2/cards?q=${encodeURIComponent(q)}&pageSize=20&page=${page}&orderBy=-set.releaseDate`

  const res = await fetch(url)
  if (!res.ok) return { cards: [], totalCount: 0 }

  const data = await res.json()
  return {
    cards: (data.data || []).map(c => ({
      id: c.id,
      name: c.name,
      setName: c.set?.name,
      setId: c.set?.id,
      number: c.number,
      rarity: c.rarity,
      image: c.images?.small,
      imageLarge: c.images?.large,
      artist: c.artist,
      releaseDate: c.set?.releaseDate,
      prices: c.tcgplayer?.prices || null,
      updatedAt: c.tcgplayer?.updatedAt || null,
      cardmarket: c.cardmarket?.prices || null,
    })),
    totalCount: data.totalCount || 0,
  }
}

async function fetchCardPrice(cardId) {
  const url = `/api/pokemon/v2/cards/${cardId}`
  const res = await fetch(url)
  if (!res.ok) return null

  const data = await res.json()
  const c = data.data
  if (!c) return null

  return {
    id: c.id,
    name: c.name,
    setName: c.set?.name,
    prices: c.tcgplayer?.prices || null,
    updatedAt: c.tcgplayer?.updatedAt || null,
    cardmarket: c.cardmarket?.prices || null,
  }
}

/** Extract the best market price from tcgplayer prices object */
function getBestPrice(prices, preferredVariant) {
  if (!prices) return null
  const variant = preferredVariant && prices[preferredVariant]
    ? preferredVariant
    : prices.holofoil ? "holofoil"
    : prices.normal ? "normal"
    : prices.reverseHolofoil ? "reverseHolofoil"
    : prices["1stEditionHolofoil"] ? "1stEditionHolofoil"
    : Object.keys(prices)[0]

  if (!variant || !prices[variant]) return null
  const vp = prices[variant]
  return {
    variant,
    market: vp.market || vp.mid || vp.low || null,
    low: vp.low,
    mid: vp.mid,
    high: vp.high,
  }
}

// ─── POPULAR SETS (for market overview) ─────────────────────────────────────

const POPULAR_SETS = [
  { id: "sv8", name: "Surging Sparks" },
  { id: "sv7", name: "Stellar Crown" },
  { id: "sv6", name: "Twilight Masquerade" },
  { id: "sv5", name: "Temporal Forces" },
  { id: "sv4", name: "Paradox Rift" },
  { id: "sv3pt5", name: "151" },
  { id: "sv3", name: "Obsidian Flames" },
  { id: "swsh12pt5", name: "Crown Zenith" },
  { id: "cel25", name: "Celebrations" },
  { id: "base1", name: "Base Set" },
]

async function fetchSetHighlights(setId) {
  const q = `set.id:${setId}`
  const url = `/api/pokemon/v2/cards?q=${encodeURIComponent(q)}&pageSize=10&orderBy=-tcgplayer.prices.holofoil.market`
  const res = await fetch(url)
  if (!res.ok) return []
  const data = await res.json()
  return (data.data || []).map(c => ({
    id: c.id,
    name: c.name,
    number: c.number,
    rarity: c.rarity,
    image: c.images?.small,
    setName: c.set?.name,
    setId: c.set?.id,
    prices: c.tcgplayer?.prices || null,
    updatedAt: c.tcgplayer?.updatedAt || null,
    cardmarket: c.cardmarket?.prices || null,
  }))
}

// ─── HOOK ───────────────────────────────────────────────────────────────────

export function usePokemonMarket() {
  const [watchlist, setWatchlist] = useState(() => loadWatchlist())
  const [watchlistPrices, setWatchlistPrices] = useState({})
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState(null)
  const [searching, setSearching] = useState(false)
  const [selectedCard, setSelectedCard] = useState(null)
  const [selectedRange, setSelectedRange] = useState("30d")
  const [loading, setLoading] = useState(false)
  const [trendingCards, setTrendingCards] = useState([])
  const [loadingTrending, setLoadingTrending] = useState(false)
  const refreshTimer = useRef(null)

  // ── Search ──
  const doSearch = useCallback(async (query) => {
    if (!query || query.trim().length < 2) {
      setSearchResults(null)
      return
    }
    setSearching(true)
    try {
      const result = await searchCards(query)
      setSearchResults(result)
    } catch {
      setSearchResults({ cards: [], totalCount: 0 })
    }
    setSearching(false)
  }, [])

  // ── Add / Remove ──
  const addCard = useCallback((card) => {
    const updated = addToWatchlist({
      id: card.id,
      name: card.name,
      setName: card.setName,
      setId: card.setId,
      number: card.number,
      rarity: card.rarity,
      variant: card.variant || null,
      image: card.image,
    })
    setWatchlist(updated)

    // Record initial snapshot if we have a price
    const bp = getBestPrice(card.prices, card.variant)
    if (bp?.market) recordSnapshot(card.id, bp.market)
  }, [])

  const removeCard = useCallback((cardId) => {
    const updated = removeFromWatchlist(cardId)
    setWatchlist(updated)
    if (selectedCard?.id === cardId) setSelectedCard(null)
  }, [selectedCard])

  // ── Refresh watchlist prices ──
  const refreshPrices = useCallback(async () => {
    if (watchlist.length === 0) return
    setLoading(true)
    const prices = {}

    // Fetch in batches of 4
    for (let i = 0; i < watchlist.length; i += 4) {
      const batch = watchlist.slice(i, i + 4)
      const results = await Promise.all(batch.map(c => fetchCardPrice(c.id)))
      results.forEach((data, idx) => {
        if (!data) return
        const card = batch[idx]
        const bp = getBestPrice(data.prices, card.variant)
        if (bp?.market) {
          prices[card.id] = {
            ...bp,
            updatedAt: data.updatedAt,
            cardmarket: data.cardmarket,
          }
          recordSnapshot(card.id, bp.market)
        }
      })
    }

    setWatchlistPrices(prices)
    setLoading(false)
  }, [watchlist])

  // ── Fetch trending / popular cards ──
  const fetchTrending = useCallback(async () => {
    setLoadingTrending(true)
    try {
      // Pick 3 random popular sets and fetch top cards
      const shuffled = [...POPULAR_SETS].sort(() => Math.random() - 0.5).slice(0, 3)
      const results = await Promise.all(shuffled.map(s => fetchSetHighlights(s.id)))
      const all = results.flat().filter(c => {
        const bp = getBestPrice(c.prices)
        return bp?.market && bp.market > 0.5
      })
      // Sort by price descending, take top 12
      all.sort((a, b) => {
        const pa = getBestPrice(a.prices)?.market || 0
        const pb = getBestPrice(b.prices)?.market || 0
        return pb - pa
      })
      setTrendingCards(all.slice(0, 12))
    } catch {
      setTrendingCards([])
    }
    setLoadingTrending(false)
  }, [])

  // ── Auto-refresh every 5 min ──
  useEffect(() => {
    refreshPrices()
    fetchTrending()
    refreshTimer.current = setInterval(refreshPrices, 5 * 60 * 1000)
    return () => clearInterval(refreshTimer.current)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Get chart data for selected card ──
  const getChartData = useCallback((cardId, range) => {
    return getCardSnapshots(cardId, range)
  }, [])

  // ── Compute percentage changes from snapshots ──
  const getPctChanges = useCallback((cardId, currentPrice) => {
    if (!currentPrice) return {}
    const snaps = getCardSnapshots(cardId, "all")
    if (!snaps.length) return {}

    const now = new Date()
    const findClosest = (daysAgo) => {
      const target = new Date(now)
      target.setDate(target.getDate() - daysAgo)
      const targetStr = target.toISOString().split("T")[0]
      // Find closest snapshot to target date
      let best = null
      for (const s of snaps) {
        const snapDate = s.date.split("T")[0]
        if (snapDate <= targetStr) best = s
      }
      return best
    }

    const snap7d = findClosest(7)
    const snap30d = findClosest(30)
    const snap90d = findClosest(90)

    const pct = (old) => old ? (currentPrice - old.price) / old.price : null

    return {
      pct7d: pct(snap7d),
      pct30d: pct(snap30d),
      pct90d: pct(snap90d),
    }
  }, [])

  return {
    // Watchlist
    watchlist, watchlistPrices, loading,
    addCard, removeCard, refreshPrices,
    // Search
    searchQuery, setSearchQuery, searchResults, searching, doSearch,
    // Selected card
    selectedCard, setSelectedCard, selectedRange, setSelectedRange,
    getChartData, getPctChanges,
    // Trending
    trendingCards, loadingTrending, fetchTrending,
    // Utilities
    getBestPrice, POPULAR_SETS,
  }
}

export { getBestPrice }
