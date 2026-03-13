/**
 * Vercel Cron Job — Hourly portfolio snapshot
 *
 * Runs every hour (even when the browser is closed) to record portfolio value.
 * Reads holdings from Supabase, fetches current prices from Coinbase/Yahoo,
 * and inserts an OHLC-compatible snapshot into portfolio_snapshots.
 *
 * Configure in vercel.json:
 *   "crons": [{ "path": "/api/cron/snapshot", "schedule": "0 * * * *" }]
 *
 * Env vars: CRON_SECRET (optional, for auth)
 */

import { createClient } from "@supabase/supabase-js"

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "https://fquisivajgslrcvdfrrv.supabase.co"
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_Z82GMfIx2TsiCqRPZAWIUw_5SsvzL6y"

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// ─── SYMBOL MAPS ────────────────────────────────────────────────────────────
// Canonical source: src/utils/symbols.js — keep in sync when adding symbols.
import { COINBASE_PRODUCTS as COINBASE_MAP } from "../../src/utils/symbols.js"

// ─── PRICE FETCHERS (server-side, no proxy needed) ──────────────────────────

async function fetchCoinbasePrice(cbSymbol) {
  try {
    const res = await fetch(`https://api.exchange.coinbase.com/products/${cbSymbol}/ticker`)
    if (!res.ok) return null
    const data = await res.json()
    return parseFloat(data.price) || null
  } catch { return null }
}

async function fetchYahooPrice(ticker) {
  try {
    const res = await fetch(
      `https://query2.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`,
      { headers: { "User-Agent": "Mozilla/5.0" } }
    )
    if (!res.ok) return null
    const data = await res.json()
    const meta = data.chart?.result?.[0]?.meta
    return meta?.regularMarketPrice || null
  } catch { return null }
}

// ─── HANDLER ────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  // Auth check — Vercel cron sends this header
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && req.headers["authorization"] !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: "Unauthorized" })
  }

  try {
    // 1. Load holdings from Supabase
    const { data: row, error: loadErr } = await supabase
      .from("portfolio_data")
      .select("holdings")
      .eq("id", "default")
      .single()

    if (loadErr || !row?.holdings?.length) {
      return res.status(200).json({ status: "skip", reason: "no holdings" })
    }

    const holdings = row.holdings

    // 2. Fetch current prices for market holdings
    const marketHoldings = holdings.filter(h => (h.assetClass || "market") === "market")
    const collectibleHoldings = holdings.filter(h => h.assetClass === "collectible")
    const cashHoldings = holdings.filter(h => h.assetClass === "cash")

    const prices = {}

    // Batch fetch prices (4 at a time)
    for (let i = 0; i < marketHoldings.length; i += 4) {
      const batch = marketHoldings.slice(i, i + 4)
      await Promise.all(batch.map(async (h) => {
        const sym = h.symbol.toUpperCase()
        if (prices[sym]) return

        // Crypto → Coinbase
        const cbSym = COINBASE_MAP[sym] || (h.type !== "equity" ? `${sym}-USD` : null)
        if (cbSym) {
          const p = await fetchCoinbasePrice(cbSym)
          if (p) { prices[sym] = p; return }
        }

        // Equities → Yahoo
        if (h.type === "equity" || /^[A-Z]{1,5}$/.test(sym)) {
          const p = await fetchYahooPrice(sym)
          if (p) { prices[sym] = p; return }
        }
      }))
    }

    // 3. Compute portfolio value
    let marketValue = 0, collectibleValue = 0, cashValue = 0, costBasis = 0

    marketHoldings.forEach(h => {
      const sym = h.symbol.toUpperCase()
      const p = prices[sym] || 0
      const lev = h.leverage || 1
      const margin = (h.costBasis * h.qty) / lev
      const pnl = (p - h.costBasis) * h.qty
      marketValue += margin + pnl
      costBasis += margin
    })

    collectibleHoldings.forEach(h => {
      collectibleValue += (h.manualPrice || 0) * h.qty
    })

    cashHoldings.forEach(h => {
      cashValue += h.qty
      costBasis += h.qty
    })

    const totalValue = marketValue + collectibleValue + cashValue

    if (totalValue <= 0) {
      return res.status(200).json({ status: "skip", reason: "zero value" })
    }

    // 4. Save snapshot to Supabase
    const now = new Date().toISOString()
    const { error: snapErr } = await supabase.from("portfolio_snapshots").insert({
      timestamp: now,
      total_value: totalValue,
      market_value: marketValue,
      collectible_value: collectibleValue,
      cash_value: cashValue,
      cost_basis: costBasis,
      unrealized_pnl: totalValue - costBasis,
      source: "cron",
    })

    if (snapErr) {
      console.error("[Cron] snapshot save failed:", snapErr.message)
      return res.status(500).json({ error: "snapshot save failed", detail: snapErr.message })
    }

    const priceCount = Object.keys(prices).length
    console.log(`[Cron] snapshot saved: $${totalValue.toFixed(2)} (${priceCount} prices fetched, ${marketHoldings.length} market, ${collectibleHoldings.length} collectible, ${cashHoldings.length} cash)`)

    return res.status(200).json({
      status: "ok",
      totalValue: totalValue.toFixed(2),
      pricesFetched: priceCount,
      timestamp: now,
    })
  } catch (err) {
    console.error("[Cron] error:", err.message)
    return res.status(500).json({ error: err.message })
  }
}
