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
