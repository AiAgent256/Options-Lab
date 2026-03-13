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
 * Quick-access symbols for the MultiChart view.
 */
export const QUICK_SYMBOLS = [
  { label: "BTC", sym: "COINBASE:BTCUSD", cat: "crypto" },
  { label: "ETH", sym: "COINBASE:ETHUSD", cat: "crypto" },
  { label: "SOL", sym: "COINBASE:SOLUSD", cat: "crypto" },
  { label: "HYPE", sym: "COINBASE:HYPEUSD", cat: "crypto" },
  { label: "ZRO", sym: "COINBASE:ZROUSD", cat: "crypto" },
  { label: "CC", sym: "PHEMEX:CCUSDT", cat: "crypto" },
  { label: "MSTR", sym: "NASDAQ:MSTR", cat: "equity" },
  { label: "SMR", sym: "NYSE:SMR", cat: "equity" },
  { label: "AAOI", sym: "NASDAQ:AAOI", cat: "equity" },
  { label: "COIN", sym: "NASDAQ:COIN", cat: "equity" },
  { label: "MARA", sym: "NASDAQ:MARA", cat: "equity" },
  { label: "RIOT", sym: "NASDAQ:RIOT", cat: "equity" },
  { label: "SPY", sym: "AMEX:SPY", cat: "index" },
  { label: "QQQ", sym: "NASDAQ:QQQ", cat: "index" },
  { label: "NVDA", sym: "NASDAQ:NVDA", cat: "equity" },
  { label: "TSLA", sym: "NASDAQ:TSLA", cat: "equity" },
];
