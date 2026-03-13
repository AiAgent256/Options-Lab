/**
 * Canonical symbol maps — single source of truth for exchange product IDs.
 *
 * Used by: liveData.js, useMarketData.js, api/cron/snapshot.js
 * When adding a new symbol, add it here and all consumers get it.
 */

// Coinbase Exchange API product IDs (spot trading)
// NOTE: Some tokens (e.g. ZRO) are on Coinbase retail but may not be on the Exchange API.
// Consumers should handle 404s gracefully and fall back to Phemex/CoinGecko.
export const COINBASE_PRODUCTS = {
  BTC: "BTC-USD", ETH: "ETH-USD", SOL: "SOL-USD", DOGE: "DOGE-USD",
  XRP: "XRP-USD", ADA: "ADA-USD", AVAX: "AVAX-USD", DOT: "DOT-USD",
  LINK: "LINK-USD", NEAR: "NEAR-USD", SUI: "SUI-USD", APT: "APT-USD",
  ARB: "ARB-USD", OP: "OP-USD", MATIC: "MATIC-USD", SEI: "SEI-USD",
  INJ: "INJ-USD", TIA: "TIA-USD", RENDER: "RENDER-USD", HYPE: "HYPE-USD",
  LTC: "LTC-USD", UNI: "UNI-USD", AAVE: "AAVE-USD", ATOM: "ATOM-USD",
  FIL: "FIL-USD", PEPE: "PEPE-USD", SHIB: "SHIB-USD", FET: "FET-USD",
  ZRO: "ZRO-USD",
}

// Phemex perpetual contract symbols
export const PHEMEX_PRODUCTS = {
  BTC: "BTCUSDT", ETH: "ETHUSDT", SOL: "SOLUSDT", DOGE: "DOGEUSDT",
  XRP: "XRPUSDT", ADA: "ADAUSDT", AVAX: "AVAXUSDT", DOT: "DOTUSDT",
  LINK: "LINKUSDT", NEAR: "NEARUSDT", SUI: "SUIUSDT", APT: "APTUSDT",
  ARB: "ARBUSDT", OP: "OPUSDT", SEI: "SEIUSDT", INJ: "INJUSDT",
  TIA: "TIAUSDT", WIF: "WIFUSDT", HYPE: "HYPEUSDT",
  RENDER: "RENDERUSDT", FET: "FETUSDT", TAO: "TAOUSDT",
  CC: "CCUSDT", PEPE: "1000PEPEUSDT", ZRO: "ZROUSDT",
}

// Yahoo Finance overrides — commodities, futures, and non-standard tickers
// Maps normalized symbol → Yahoo Finance ticker
export const YAHOO_OVERRIDES = {
  // Copper
  XCU: "HG=F", XCUUSD: "HG=F", COPPER: "HG=F",
  // Gold
  XAU: "GC=F", XAUUSD: "GC=F", GOLD: "GC=F",
  // Silver
  XAG: "SI=F", XAGUSD: "SI=F", SILVER: "SI=F",
  // Oil & Gas
  OIL: "CL=F", NATGAS: "NG=F",
}

// CoinGecko coin IDs (free API fallback)
export const COINGECKO_IDS = {
  BTC: "bitcoin", ETH: "ethereum", SOL: "solana", DOGE: "dogecoin",
  XRP: "ripple", ADA: "cardano", AVAX: "avalanche-2", DOT: "polkadot",
  LINK: "chainlink", NEAR: "near", SUI: "sui", APT: "aptos",
  ARB: "arbitrum", OP: "optimism", MATIC: "matic-network", SEI: "sei-network",
  INJ: "injective-protocol", TIA: "celestia", RENDER: "render-token",
  FET: "artificial-superintelligence-alliance", HYPE: "hyperliquid",
  WIF: "dogwifcoin", TAO: "bittensor",
  ZRO: "layerzero", PEPE: "pepe", CC: "cross-the-ages",
  ATOM: "cosmos", UNI: "uniswap", LTC: "litecoin",
}
