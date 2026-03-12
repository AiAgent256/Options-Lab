/**
 * useCardPrices.js — Card pricing from Pokemon TCG API + YGOPRODeck
 *
 * Pokemon:  pokemontcg.io  → TCGPlayer market prices
 * Yu-Gi-Oh: ygoprodeck.com → TCGPlayer prices
 *
 * All requests proxy through Vite dev server / Vercel to avoid CORS.
 */

// ─── POKEMON TCG ──────────────────────────────────────────────────────────────

async function fetchPokemonPrice(cardName, setId, cardNumber) {
  try {
    const parts = []
    if (cardName) parts.push(`name:"${cardName}"`)
    if (setId) parts.push(`set.id:${setId}`)
    if (cardNumber) parts.push(`number:${cardNumber}`)
    if (parts.length === 0) return null

    const q = parts.join(" ")
    const url = `/api/pokemon/v2/cards?q=${encodeURIComponent(q)}&pageSize=1`
    if (import.meta.env.DEV) console.log(`[PKM] fetching: ${q}`)

    const res = await fetch(url)
    if (!res.ok) {
      if (import.meta.env.DEV) console.warn(`[PKM] ${cardName} → ${res.status}`)
      return null
    }

    const data = await res.json()
    const card = data.data?.[0]
    if (!card) {
      if (import.meta.env.DEV) console.warn(`[PKM] ${cardName}: no results`)
      return null
    }

    const tcg = card.tcgplayer
    if (!tcg?.prices) {
      if (import.meta.env.DEV) console.warn(`[PKM] ${cardName}: no price data`)
      return null
    }

    if (import.meta.env.DEV) console.log(`[PKM] ${card.name} (${card.set?.name} #${card.number}): variants=${Object.keys(tcg.prices).join(",")}`)

    return {
      cardId: card.id,
      name: card.name,
      set: card.set?.name,
      number: card.number,
      image: card.images?.small,
      updatedAt: tcg.updatedAt,
      prices: tcg.prices, // { holofoil: { low, mid, high, market }, normal: {...}, ... }
    }
  } catch (e) {
    if (import.meta.env.DEV) console.warn(`[PKM] err:`, e.message)
    return null
  }
}

// ─── YU-GI-OH ─────────────────────────────────────────────────────────────────

async function fetchYugiohPrice(cardName) {
  try {
    if (!cardName) return null

    const url = `/api/yugioh/api/v7/cardinfo.php?name=${encodeURIComponent(cardName)}`
    if (import.meta.env.DEV) console.log(`[YGO] fetching: ${cardName}`)

    const res = await fetch(url)
    if (!res.ok) {
      // Try fuzzy search on exact-match failure
      if (res.status === 400) {
        const fuzzyUrl = `/api/yugioh/api/v7/cardinfo.php?fname=${encodeURIComponent(cardName)}&num=1&offset=0`
        if (import.meta.env.DEV) console.log(`[YGO] exact miss, trying fuzzy: ${cardName}`)
        const fuzzyRes = await fetch(fuzzyUrl)
        if (!fuzzyRes.ok) {
          if (import.meta.env.DEV) console.warn(`[YGO] ${cardName} → fuzzy also failed: ${fuzzyRes.status}`)
          return null
        }
        const fuzzyData = await fuzzyRes.json()
        const card = fuzzyData.data?.[0]
        if (!card?.card_prices?.[0]) return null
        return parseYugiohCard(card)
      }
      if (import.meta.env.DEV) console.warn(`[YGO] ${cardName} → ${res.status}`)
      return null
    }

    const data = await res.json()
    const card = data.data?.[0]
    if (!card?.card_prices?.[0]) {
      if (import.meta.env.DEV) console.warn(`[YGO] ${cardName}: no price data`)
      return null
    }

    return parseYugiohCard(card)
  } catch (e) {
    if (import.meta.env.DEV) console.warn(`[YGO] err:`, e.message)
    return null
  }
}

function parseYugiohCard(card) {
  const cp = card.card_prices[0]
  if (import.meta.env.DEV) console.log(`[YGO] ${card.name}: tcg=$${cp.tcgplayer_price} ebay=$${cp.ebay_price}`)
  return {
    name: card.name,
    image: card.card_images?.[0]?.image_url_small,
    tcgplayer: parseFloat(cp.tcgplayer_price) || 0,
    cardmarket: parseFloat(cp.cardmarket_price) || 0,
    ebay: parseFloat(cp.ebay_price) || 0,
    amazon: parseFloat(cp.amazon_price) || 0,
    coolstuffinc: parseFloat(cp.coolstuffinc_price) || 0,
  }
}

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

/**
 * Fetch card prices for collectible holdings that have cardGame set.
 * Returns: { [holdingId]: { price, updatedAt } }
 */
export async function fetchCardPrices(collectibleHoldings) {
  const results = {}
  const tasks = []

  for (const h of collectibleHoldings) {
    if (!h.cardGame || h.cardGame === "other") continue

    tasks.push((async () => {
      if (h.cardGame === "pokemon") {
        const data = await fetchPokemonPrice(h.cardName || h.label, h.setId, h.cardNumber)
        if (!data?.prices) return

        // Pick variant: use holding's variant, fall back through common ones
        const variant = h.variant || "holofoil"
        const variantPrices = data.prices[variant]
          || data.prices.holofoil
          || data.prices.normal
          || data.prices.reverseHolofoil
          || data.prices["1stEditionHolofoil"]
          || Object.values(data.prices)[0]

        if (variantPrices?.market) {
          results[h.id] = { price: variantPrices.market, updatedAt: data.updatedAt }
        } else if (variantPrices?.mid) {
          results[h.id] = { price: variantPrices.mid, updatedAt: data.updatedAt }
        }

      } else if (h.cardGame === "yugioh") {
        const data = await fetchYugiohPrice(h.cardName || h.label)
        if (!data || data.tcgplayer <= 0) return
        results[h.id] = { price: data.tcgplayer, updatedAt: new Date().toISOString().split("T")[0] }
      }
    })())
  }

  // Batch 4 at a time
  for (let i = 0; i < tasks.length; i += 4) {
    await Promise.all(tasks.slice(i, i + 4))
  }

  if (import.meta.env.DEV) console.log(`[Cards] fetched prices for ${Object.keys(results).length}/${tasks.length} cards`)
  return results
}
