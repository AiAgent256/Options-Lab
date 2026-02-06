# Options Lab

Institutional-grade options analysis platform with real-time market data, TradingView charting, and Black-Scholes pricing.

![Options Lab](https://img.shields.io/badge/React-18-blue) ![Vite](https://img.shields.io/badge/Vite-5-purple) ![License](https://img.shields.io/badge/License-MIT-green)

## Features

### Live Market Data
- **Binance WebSocket** — Real-time crypto prices (BTC, ETH, SOL) with auto-sync to simulator
- **TradingView Advanced Chart** — Full interactive chart with indicators, drawing tools, and real-time data for any tradeable asset
- **Split-pane layout** — Chart and simulator side-by-side with resizable divider

### Options Simulator
- **Black-Scholes pricing** with dividend yield support
- **Greeks** — Delta, Gamma, Theta, Vega, Rho with sensitivity charts
- **P&L Explorer** — Interactive stock price × time surface
- **IV Matrix** — Implied volatility sensitivity analysis
- **Multi-leg strategies** — Presets for common strategies (spreads, straddles, iron condors, etc.)

### Portfolio Tracker
- **Holdings management** — Add positions with symbol, cost basis, quantity, leverage, entry date
- **Live crypto prices** — Auto-fetches from Binance REST API, polls every 5s
- **Historical charts** — Fetches daily candles from Binance (free, no key) since entry date
- **Portfolio value chart** — Aggregated value over time with P&L overlay and cost basis line
- **Allocation pie chart** — Visual breakdown of position weights
- **Per-holding P&L charts** — Individual sparklines showing price vs. cost basis
- **Leverage tracking** — Positions with leverage show amplified returns correctly
- **Card + Table views** — Toggle between visual cards or dense spreadsheet layout
- **Import/Export** — JSON export for backup, import to merge positions
- **Cross-tab navigation** — Click chart icon on any holding to jump to full TradingView chart in Simulator tab
- **TradingView mini widgets** — Fallback charts for equities without Binance data

### Compare & Roll Planning
- **Compare Contracts** — Side-by-side analysis of different strikes, expirations, and types
- **Roll Planner** — Chain sequential options to extend beyond available LEAP expiries
- **Roll Optimizer** — Find optimal roll timing based on stock price trajectory forecasts

### Reporting
- **Download Report** — Institutional-quality PDF/HTML report with SVG charts, P&L surfaces, Greek profiles, and scenario analysis

## Quick Start

```bash
# Clone the repository
git clone https://github.com/your-username/options-lab.git
cd options-lab

# Install dependencies
npm install

# Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Project Structure

```
options-lab/
├── index.html                          # Entry point
├── package.json                        # Dependencies & scripts
├── vite.config.js                      # Vite configuration
├── src/
│   ├── main.jsx                        # React entry
│   ├── App.jsx                         # Layout, tab routing, symbol picker, data orchestration
│   ├── components/
│   │   ├── OptionsSimulator.jsx        # Full options analysis engine (~3700 lines)
│   │   ├── Portfolio.jsx               # Portfolio tracker with live prices & historical charts
│   │   ├── TradingViewChart.jsx        # TradingView Advanced Chart widget
│   │   └── LiveTicker.jsx              # Real-time price ticker
│   └── hooks/
│       ├── useBinanceWebSocket.js      # Binance WebSocket for live streaming
│       └── useBinanceKlines.js         # Binance REST API for historical candles
```

## Architecture

### Data Flow

```
                                    ┌─────────────────────────────────────────┐
                                    │             App.jsx                     │
                                    │  [Simulator] [Portfolio] tab routing    │
                                    └──────────┬──────────────┬───────────────┘
                                               │              │
                  ┌────────────────────────────┘              └───────────────────────┐
                  ▼                                                                    ▼
    ┌──────── Simulator Tab ────────┐                          ┌──── Portfolio Tab ────┐
    │                               │                          │                       │
    │  Binance WS ──→ LiveTicker    │                          │  Binance REST ──→     │
    │       │                       │    chart nav button       │  fetchBinanceTickers  │
    │       └──→ OptionsSimulator   │  ◄─────────────────────  │  fetchMultiKlines     │
    │             (livePrice prop)  │                          │       │               │
    │                               │                          │       ▼               │
    │  TradingView ──→ Chart Widget │                          │  Portfolio.jsx        │
    └───────────────────────────────┘                          │  (cards, table,       │
                                                               │   charts, P&L)        │
                                                               └───────────────────────┘
```

When **Live Sync** is enabled, the Binance WebSocket price automatically flows into the simulator's stock price input, causing all Black-Scholes calculations, Greeks, and P&L projections to update in real-time.

### Layout Modes

| Mode | Description |
|------|-------------|
| **Split** | Chart left, simulator right (resizable) |
| **Chart Top** | Chart on top, simulator below |
| **Simulator** | Full-screen simulator only |
| **Chart** | Full-screen chart only |

## Adding Data Providers

The architecture is designed for easy extension. To add a new data source:

### Equities (Real-time)

For live stock data (MSTR, etc.), you'll need a paid provider. Options:

1. **Polygon.io** ($29/mo) — REST + WebSocket, includes options chains
2. **Tradier** (free with brokerage account) — Excellent options chain data
3. **Alpha Vantage** (free tier, limited) — Basic quotes + options

Example: Adding Polygon.io:

```javascript
// src/hooks/usePolygonWebSocket.js
export function usePolygonWebSocket(symbol, apiKey) {
  // Connect to wss://socket.polygon.io/stocks
  // Send: {"action":"auth","params":"API_KEY"}
  // Send: {"action":"subscribe","params":"T.MSTR"}
  // Receive: real-time trades
}
```

### Options Chains

To auto-populate strike/expiration/premium from live data:

```javascript
// src/hooks/useOptionsChain.js
// Tradier: GET https://api.tradier.com/v1/markets/options/chains
// Polygon: GET https://api.polygon.io/v3/reference/options/contracts
```

### Environment Variables

Create `.env.local` for API keys:

```env
VITE_POLYGON_API_KEY=your_key_here
VITE_TRADIER_API_KEY=your_key_here
```

Access in code: `import.meta.env.VITE_POLYGON_API_KEY`

## Deployment

### Vercel (recommended)

```bash
npm install -g vercel
vercel
```

### Netlify

```bash
npm run build
# Deploy the `dist/` directory
```

### Docker

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
```

## Key Technical Details

- **Black-Scholes implementation** includes continuous dividend yield adjustment
- **Implied volatility** solved via Newton-Raphson with bisection fallback
- **TradingView widget** is the free embeddable version — no API key required
- **Binance WebSocket** uses the miniTicker stream (~1 update/sec, very lightweight)
- **SVG charts** in reports are generated from raw data — vector quality at any print resolution
- **Scenario storage** uses localStorage for persistence across sessions

## License

MIT
