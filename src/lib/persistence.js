/**
 * Portfolio persistence layer.
 * 
 * Strategy: localStorage for instant reads, Supabase for cross-device sync.
 * - On load: read localStorage immediately, then fetch from Supabase and merge (latest wins)
 * - On save: write to localStorage immediately, debounce write to Supabase
 * - If Supabase is unavailable, falls back to localStorage-only gracefully
 */
import { supabase } from "./supabase";

const TABLE = "portfolio_data";
const ROW_ID = "default";

// ─── localStorage helpers ───────────────────────────────────────────────────
const LS_KEYS = {
  holdings: "optlab:portfolio:holdings",
  closedTrades: "optlab:portfolio:closed",
  snapshots: "optlab:portfolio:snapshots",
  lastSync: "optlab:portfolio:lastSync",
};

function lsGet(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

function lsSet(key, data) {
  try { localStorage.setItem(key, JSON.stringify(data)); } catch { /* full */ }
}

// ─── Supabase operations ────────────────────────────────────────────────────
async function cloudLoad() {
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("holdings, closed_trades, snapshots, updated_at")
      .eq("id", ROW_ID)
      .single();

    if (error) {
      if (import.meta.env.DEV) console.warn("[Sync] cloud load failed:", error.message);
      return null;
    }
    return {
      holdings: data.holdings || [],
      closedTrades: data.closed_trades || [],
      snapshots: data.snapshots || [],
      updatedAt: data.updated_at,
    };
  } catch (err) {
    if (import.meta.env.DEV) console.warn("[Sync] cloud load error:", err.message);
    return null;
  }
}

async function cloudSave(holdings, closedTrades, snapshots) {
  try {
    const { error } = await supabase
      .from(TABLE)
      .upsert({
        id: ROW_ID,
        holdings,
        closed_trades: closedTrades,
        snapshots,
        updated_at: new Date().toISOString(),
      });

    if (error) {
      if (import.meta.env.DEV) console.warn("[Sync] cloud save failed:", error.message);
      return false;
    }
    lsSet(LS_KEYS.lastSync, new Date().toISOString());
    return true;
  } catch (err) {
    if (import.meta.env.DEV) console.warn("[Sync] cloud save error:", err.message);
    return false;
  }
}

// ─── Debounced cloud save ───────────────────────────────────────────────────
let saveTimer = null;
const DEBOUNCE_MS = 2000; // wait 2s after last change before syncing

function debouncedCloudSave(holdings, closedTrades, snapshots) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    cloudSave(holdings, closedTrades, snapshots);
  }, DEBOUNCE_MS);
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Load portfolio data. Returns localStorage data immediately.
 * Call syncFromCloud() after mount to check for newer cloud data.
 */
export function loadPortfolio() {
  return {
    holdings: lsGet(LS_KEYS.holdings, []),
    closedTrades: lsGet(LS_KEYS.closedTrades, []),
    snapshots: lsGet(LS_KEYS.snapshots, []),
  };
}

/**
 * Save portfolio data to localStorage immediately and queue a cloud sync.
 */
export function savePortfolio(holdings, closedTrades, snapshots) {
  lsSet(LS_KEYS.holdings, holdings);
  lsSet(LS_KEYS.closedTrades, closedTrades);
  lsSet(LS_KEYS.snapshots, snapshots);
  debouncedCloudSave(holdings, closedTrades, snapshots);
}

/**
 * Fetch from cloud and return data if it's newer than local.
 * Returns null if local is already up to date or cloud is unavailable.
 */
export async function syncFromCloud() {
  const cloud = await cloudLoad();
  if (!cloud) return null;

  const lastSync = lsGet(LS_KEYS.lastSync, null);
  const cloudTime = new Date(cloud.updatedAt).getTime();
  const localTime = lastSync ? new Date(lastSync).getTime() : 0;

  // Cloud is newer — use cloud data
  if (cloudTime > localTime) {
    lsSet(LS_KEYS.holdings, cloud.holdings);
    lsSet(LS_KEYS.closedTrades, cloud.closedTrades);
    lsSet(LS_KEYS.snapshots, cloud.snapshots);
    lsSet(LS_KEYS.lastSync, cloud.updatedAt);
    if (import.meta.env.DEV) console.log("[Sync] loaded newer data from cloud");
    return cloud;
  }

  // Local is newer or same — push local to cloud
  if (localTime > cloudTime) {
    const local = loadPortfolio();
    cloudSave(local.holdings, local.closedTrades, local.snapshots);
    if (import.meta.env.DEV) console.log("[Sync] pushed newer local data to cloud");
  }

  return null;
}

/**
 * Force push current local data to cloud (for manual sync button).
 */
export async function forcePushToCloud() {
  const local = loadPortfolio();
  return cloudSave(local.holdings, local.closedTrades, local.snapshots);
}

/**
 * Force pull from cloud, overwriting local (for manual sync button).
 */
export async function forcePullFromCloud() {
  const cloud = await cloudLoad();
  if (!cloud) return null;
  lsSet(LS_KEYS.holdings, cloud.holdings);
  lsSet(LS_KEYS.closedTrades, cloud.closedTrades);
  lsSet(LS_KEYS.snapshots, cloud.snapshots);
  lsSet(LS_KEYS.lastSync, cloud.updatedAt);
  return cloud;
}


// ─── PORTFOLIO SNAPSHOTS (time-series in Supabase) ──────────────────────────
const SNAP_TABLE = "portfolio_snapshots";
const LS_LAST_SNAPSHOT = "optlab:portfolio:lastSnapshotTime";
const SNAPSHOT_INTERVAL_MS = 2 * 60 * 60 * 1000;

export function shouldTakeSnapshot() {
  try {
    const last = localStorage.getItem(LS_LAST_SNAPSHOT);
    if (!last) return true;
    return (Date.now() - new Date(last).getTime()) >= SNAPSHOT_INTERVAL_MS;
  } catch { return true; }
}

export async function saveSnapshot({ totalValue, marketValue, collectibleValue, cashValue, costBasis, unrealizedPnl, source = "live" }) {
  try {
    const now = new Date().toISOString();
    const { error } = await supabase.from(SNAP_TABLE).insert({
      timestamp: now, total_value: totalValue, market_value: marketValue,
      collectible_value: collectibleValue, cash_value: cashValue,
      cost_basis: costBasis, unrealized_pnl: unrealizedPnl, source,
    });
    if (error) { if (import.meta.env.DEV) console.warn("[Snapshot] save failed:", error.message); return false; }
    localStorage.setItem(LS_LAST_SNAPSHOT, now);
    if (import.meta.env.DEV) console.log("[Snapshot] saved: $" + totalValue.toFixed(2) + " (" + source + ")");
    return true;
  } catch (err) { if (import.meta.env.DEV) console.warn("[Snapshot] error:", err.message); return false; }
}

export async function saveSnapshotBatch(snapshots) {
  if (!snapshots || snapshots.length === 0) return false;
  try {
    const rows = snapshots.map(s => ({
      timestamp: s.timestamp, total_value: s.totalValue, market_value: s.marketValue || 0,
      collectible_value: s.collectibleValue || 0, cash_value: s.cashValue || 0,
      cost_basis: s.costBasis || 0, unrealized_pnl: s.unrealizedPnl || 0, source: s.source || "backfill",
    }));
    const { error } = await supabase.from(SNAP_TABLE).insert(rows);
    if (error) { if (import.meta.env.DEV) console.warn("[Snapshot] batch failed:", error.message); return false; }
    if (import.meta.env.DEV) console.log("[Snapshot] backfilled " + rows.length + " snapshots");
    return true;
  } catch (err) { if (import.meta.env.DEV) console.warn("[Snapshot] batch error:", err.message); return false; }
}

export async function loadSnapshots(daysBack = 365) {
  try {
    const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase.from(SNAP_TABLE)
      .select("timestamp, total_value, market_value, collectible_value, cash_value, cost_basis, unrealized_pnl, source")
      .gte("timestamp", since).order("timestamp", { ascending: true });
    if (error) { if (import.meta.env.DEV) console.warn("[Snapshot] load failed:", error.message); return []; }
    return (data || []).map(row => ({
      date: row.timestamp, totalValue: parseFloat(row.total_value), costBasis: parseFloat(row.cost_basis),
      marketValue: parseFloat(row.market_value), collectibleValue: parseFloat(row.collectible_value),
      cashValue: parseFloat(row.cash_value), unrealizedPnl: parseFloat(row.unrealized_pnl), source: row.source,
    }));
  } catch (err) { if (import.meta.env.DEV) console.warn("[Snapshot] load error:", err.message); return []; }
}

export async function getSnapshotCount() {
  try {
    const { count, error } = await supabase.from(SNAP_TABLE).select("id", { count: "exact", head: true });
    if (error) return 0;
    return count || 0;
  } catch { return 0; }
}
