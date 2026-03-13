/**
 * Theme constants — single source of truth for the UI.
 * 
 * Every color, font, and spacing value that was previously hard-coded
 * hundreds of times across inline styles now lives here.
 */

export const COLORS = {
  bg: {
    primary: "#080a10",
    secondary: "#0c0e16",
    elevated: "#10131b",
    input: "#0a0c12",
  },
  border: {
    primary: "#161a26",
    secondary: "#1c2030",
    subtle: "#161a2660",
    accent: "#2a3048",
  },
  text: {
    primary: "#d8dce6",
    secondary: "#9098a8",
    muted: "#5c6478",
    dim: "#3e4658",
    faint: "#2c3444",
    ghost: "#1e2636",
  },
  accent: {
    blue: "#3b82f6",
    blueBg: "#3b82f614",
    blueBorder: "#3b82f630",
    blueHover: "#3b82f61a",
  },
  positive: {
    text: "#22c55e",
    bg: "#22c55e10",
    border: "#22c55e30",
  },
  negative: {
    text: "#ef4444",
    bg: "#ef444414",
    border: "#ef444425",
  },
  chartPalette: ["#3b82f6", "#8b5cf6", "#22c55e", "#f59e0b", "#ef4444", "#06b6d4", "#ec4899", "#84cc16"],
};

export const FONTS = {
  mono: "'JetBrains Mono', 'SF Mono', monospace",
  ui: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
};

/**
 * Strategy presets for the options simulator.
 * Each preset generates a set of legs from the current spot and strike prices.
 */
export const STRATEGY_PRESETS = {
  custom: { label: "Custom", legs: [] },
  bullCallSpread: {
    label: "Bull Call Spread",
    build: (S, K) => [
      { id: 1, type: "call", dir: "long", strike: K, premium: 0, qty: 1 },
      { id: 2, type: "call", dir: "short", strike: Math.round(S * 1.1), premium: 0, qty: 1 },
    ]
  },
  bearPutSpread: {
    label: "Bear Put Spread",
    build: (S, K) => [
      { id: 1, type: "put", dir: "long", strike: Math.round(S), premium: 0, qty: 1 },
      { id: 2, type: "put", dir: "short", strike: Math.round(S * 0.85), premium: 0, qty: 1 },
    ]
  },
  longStraddle: {
    label: "Long Straddle",
    build: (S) => [
      { id: 1, type: "call", dir: "long", strike: Math.round(S), premium: 0, qty: 1 },
      { id: 2, type: "put", dir: "long", strike: Math.round(S), premium: 0, qty: 1 },
    ]
  },
  longStrangle: {
    label: "Long Strangle",
    build: (S) => [
      { id: 1, type: "call", dir: "long", strike: Math.round(S * 1.05), premium: 0, qty: 1 },
      { id: 2, type: "put", dir: "long", strike: Math.round(S * 0.95), premium: 0, qty: 1 },
    ]
  },
  ironCondor: {
    label: "Iron Condor",
    build: (S) => [
      { id: 1, type: "put", dir: "long", strike: Math.round(S * 0.85), premium: 0, qty: 1 },
      { id: 2, type: "put", dir: "short", strike: Math.round(S * 0.92), premium: 0, qty: 1 },
      { id: 3, type: "call", dir: "short", strike: Math.round(S * 1.08), premium: 0, qty: 1 },
      { id: 4, type: "call", dir: "long", strike: Math.round(S * 1.15), premium: 0, qty: 1 },
    ]
  },
  ironButterfly: {
    label: "Iron Butterfly",
    build: (S) => [
      { id: 1, type: "put", dir: "long", strike: Math.round(S * 0.9), premium: 0, qty: 1 },
      { id: 2, type: "put", dir: "short", strike: Math.round(S), premium: 0, qty: 1 },
      { id: 3, type: "call", dir: "short", strike: Math.round(S), premium: 0, qty: 1 },
      { id: 4, type: "call", dir: "long", strike: Math.round(S * 1.1), premium: 0, qty: 1 },
    ]
  },
};

/**
 * Quick-access symbols for the MultiChart view.
 */
export const QUICK_SYMBOLS = [
  { label: "BTC", sym: "COINBASE:BTCUSD" },
  { label: "ETH", sym: "COINBASE:ETHUSD" },
  { label: "SOL", sym: "COINBASE:SOLUSD" },
  { label: "HYPE", sym: "COINBASE:HYPEUSD" },
  { label: "MSTR", sym: "NASDAQ:MSTR" },
  { label: "SMR", sym: "NYSE:SMR" },
  { label: "AAOI", sym: "NASDAQ:AAOI" },
  { label: "COIN", sym: "NASDAQ:COIN" },
  { label: "MARA", sym: "NASDAQ:MARA" },
  { label: "RIOT", sym: "NASDAQ:RIOT" },
  { label: "SPY", sym: "AMEX:SPY" },
  { label: "QQQ", sym: "NASDAQ:QQQ" },
  { label: "NVDA", sym: "NASDAQ:NVDA" },
  { label: "TSLA", sym: "NASDAQ:TSLA" },
];

/**
 * App-level symbol config for live price feed.
 */
export const LIVE_SYMBOLS = [
  { id: "BTCUSDT", tvSymbol: "COINBASE:BTCUSD", label: "BTC/USDT", type: "crypto" },
  { id: "ETHUSDT", tvSymbol: "COINBASE:ETHUSD", label: "ETH/USDT", type: "crypto" },
  { id: "SOLUSDT", tvSymbol: "COINBASE:SOLUSD", label: "SOL/USDT", type: "crypto" },
];
