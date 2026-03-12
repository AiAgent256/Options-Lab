/**
 * useCardPrices.js — Card pricing from multiple sources
 *
 * Pokemon (raw):   pokemontcg.io    → TCGPlayer market prices
 * Yu-Gi-Oh (raw):  ygoprodeck.com   → TCGPlayer prices
 * Graded cards:    pricecharting.com → PSA/BGS/CGC graded prices
 *
 * All requests proxy through Vite dev server / Vercel to avoid CORS.
 */

// ─── GRADE PARSING ────────────────────────────────────────────────────────────

/**
 * Parse a grade string like "PSA 10", "BGS 9.5", "CGC 9", "SGC 10", "Raw"
 * Returns { company, grade } or null if ungraded/raw.
 */
function parseGrade(gradeStr) {
  if (!gradeStr) return null
  const s = gradeStr.trim().toUpperCase()
  if (s === "RAW" || s === "UNGRADED" || s === "") return null

  const m = s.match(/^(PSA|BGS|CGC|SGC)\s*([\d.]+)$/i)
  if (!m) return null
  return { company: m[1].toUpperCase(), grade: parseFloat(m[2]) }
}

/**
 * Map a parsed grade to the PriceCharting API field name.
 * PriceCharting reuses video game field names for cards:
 *   loose-price    = ungraded
 *   cib-price      = grade 7/7.5
 *   new-price      = grade 8/8.5
 *   graded-price   = grade 9 (all companies)
 *   box-only-price = grade 9.5
 *   manual-only-price = PSA 10
 *   bgs-10-price   = BGS 10
 *   condition-17-price = CGC 10
 *   condition-18-price = SGC 10
 */
function gradeToField(parsed) {
  if (!parsed) return "loose-price"
  const { company, grade } = parsed

  if (grade === 10) {
    if (company === "BGS") return "bgs-10-price"
    if (company === "CGC") return "condition-17-price"
    if (company === "SGC") return "condition-18-price"
    return "manual-only-price" // PSA 10 or generic 10
  }
  if (grade >= 9.5) return "box-only-price"
  if (grade >= 9) return "graded-price"
  if (grade >= 8) return "new-price"
  if (grade >= 7) return "cib-price"
  return "loose-price"
}

// ─── PRICECHARTING ────────────────────────────────────────────────────────────

// Cache PriceCharting product IDs to avoid repeated searches (1 req/sec limit)
const pcIdCache = {}

async function fetchPriceChartingPrice(cardName, gradeStr) {
  try {
    if (!cardName) return null

    const parsed = parseGrade(gradeStr)
    const field = gradeToField(parsed)

    // Step 1: Search for the product (or use cached ID)
    const cacheKey = cardName.trim().toLowerCase()
    let productId = pcIdCache[cacheKey]

    if (!productId) {
      const searchUrl = `/api/pricecharting/products?q=${encodeURIComponent(cardName)}`
      if (import.meta.env.DEV) console.log(`[PC] searching: ${cardName}`)
      const searchRes = await fetch(searchUrl)

      if (!searchRes.ok) {
        if (searchRes.status === 503) {
          if (import.meta.env.DEV) console.warn(`[PC] API key not configured`)
          return null
        }
        if (import.meta.env.DEV) console.warn(`[PC] search ${cardName} → ${searchRes.status}`)
        return null
      }

      const searchData = await searchRes.json()
      if (searchData.status !== "success" || !searchData.products?.length) {
        if (import.meta.env.DEV) console.warn(`[PC] ${cardName}: no results`)
        return null
      }

      productId = searchData.products[0].id
      pcIdCache[cacheKey] = productId
      if (import.meta.env.DEV) console.log(`[PC] ${cardName} → id=${productId} (${searchData.products[0]["product-name"]})`)
    }

    // Step 2: Get prices for the product
    const priceUrl = `/api/pricecharting/product?id=${productId}`
    if (import.meta.env.DEV) console.log(`[PC] fetching prices: id=${productId} field=${field}`)
    const priceRes = await fetch(priceUrl)

    if (!priceRes.ok) {
      if (import.meta.env.DEV) console.warn(`[PC] product ${productId} → ${priceRes.status}`)
      return null
    }

    const priceData = await priceRes.json()
    if (priceData.status !== "success") return null

    // Prices are in pennies — convert to dollars
    const pennies = priceData[field]
    if (!pennies || pennies <= 0) {
      // Fall back to ungraded price if graded price not available
      const fallback = priceData["loose-price"]
      if (import.meta.env.DEV) console.warn(`[PC] ${cardName}: no ${field} price, fallback ungraded=$${fallback ? (fallback / 100).toFixed(2) : "N/A"}`)
      if (fallback && fallback > 0) return { price: fallback / 100, field: "loose-price", productName: priceData["product-name"] }
      return null
    }

    const price = pennies / 100
    if (import.meta.env.DEV) console.log(`[PC] ${priceData["product-name"]}: ${field}=$${price.toFixed(2)}`)

    return { price, field, productName: priceData["product-name"] }
  } catch (e) {
    if (import.meta.env.DEV) console.warn(`[PC] err:`, e.message)
    return null
  }
}

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
      prices: tcg.prices,
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
 * Fetch card prices for collectible holdings.
 *
 * Routing logic:
 *   - Graded cards (grade matches PSA/BGS/CGC/SGC pattern) → PriceCharting
 *   - Raw Pokemon → pokemontcg.io
 *   - Raw Yu-Gi-Oh → ygoprodeck.com
 *   - Other/no cardGame → skipped
 *
 * Returns: { [holdingId]: { price, updatedAt } }
 */
export async function fetchCardPrices(collectibleHoldings) {
  const results = {}
  const rawFns = []
  const gradedFns = []

  for (const h of collectibleHoldings) {
    if (!h.cardGame || h.cardGame === "other") continue

    const isGraded = parseGrade(h.grade) !== null

    const fn = async () => {
      // Graded cards → PriceCharting (has PSA/BGS/CGC specific prices)
      if (isGraded) {
        const searchName = h.cardName || h.label
        const data = await fetchPriceChartingPrice(searchName, h.grade)
        if (data) {
          results[h.id] = { price: data.price, updatedAt: new Date().toISOString().split("T")[0] }
          return
        }
        // Fall through to raw pricing if PriceCharting unavailable
      }

      // Raw cards → game-specific APIs
      if (h.cardGame === "pokemon") {
        const data = await fetchPokemonPrice(h.cardName || h.label, h.setId, h.cardNumber)
        if (!data?.prices) return

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
    }

    if (isGraded) gradedFns.push(fn)
    else rawFns.push(fn)
  }

  // Raw card lookups in parallel (4 at a time) — Pokemon/YGO APIs are generous
  for (let i = 0; i < rawFns.length; i += 4) {
    await Promise.all(rawFns.slice(i, i + 4).map(fn => fn()))
  }

  // Graded lookups sequentially — PriceCharting has 1 req/sec limit
  for (const fn of gradedFns) {
    await fn()
  }

  const total = rawFns.length + gradedFns.length
  if (import.meta.env.DEV) console.log(`[Cards] fetched prices for ${Object.keys(results).length}/${total} cards (${gradedFns.length} graded via PriceCharting)`)
  return results
}
