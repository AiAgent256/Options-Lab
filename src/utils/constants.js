/**
 * Theme constants — single source of truth for the UI.
 * 
 * Every color, font, and spacing value that was previously hard-coded
 * hundreds of times across inline styles now lives here.
 */

export const COLORS = {
  // Backgrounds
  bg: {
    primary: "#0a0c10",
    secondary: "#0d1017",
    elevated: "#121620",
    input: "#0a0c10",
  },

  // Borders
  border: {
    primary: "#1a1e2e",
    secondary: "#222838",
    subtle: "#1a1e2e60",
  },

  // Text
  text: {
    primary: "#e2e6f0",
    secondary: "#b0b8c8",
    muted: "#6a7488",
    dim: "#4a5268",
    faint: "#3a4258",
    ghost: "#2a3248",
  },

  // Accents — ONE accent color (blue)
  accent: {
    blue: "#3b82f6",
    blueBg: "#3b82f618",
    blueBorder: "#3b82f640",
    blueHover: "#3b82f620",
  },

  // Semantic — red/green for P&L only
  positive: {
    text: "#22c55e",
    bg: "#22c55e15",
    border: "#22c55e40",
  },
  negative: {
    text: "#ef4444",
    bg: "#ef444420",
    border: "#ef444430",
  },

  // Chart palette for multi-series
  chartPalette: ["#3b82f6", "#8b5cf6", "#22c55e", "#f59e0b", "#ef4444", "#06b6d4", "#ec4899", "#84cc16"],
};

export const FONTS = {
  mono: "'JetBrains Mono', monospace",
  ui: "'DM Sans', sans-serif",
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
