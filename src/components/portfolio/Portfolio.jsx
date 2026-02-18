import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { fetchTickers, fetchAllKlines } from "../../hooks/useMarketData";
import { fmtDollar, fmtPnl, fmtPnlPct } from "../../utils/format";
import { COLORS, FONTS } from "../../utils/constants";

// ─── PERSISTENCE LAYER ──────────────────────────────────────────────────────
// All portfolio state is stored in localStorage under these keys.
// Export/Import allows moving this data between devices.
const KEYS = {
  holdings: "optlab:portfolio:holdings",
  closedTrades: "optlab:portfolio:closed",
  snapshots: "optlab:portfolio:snapshots", // daily portfolio value snapshots
};

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

function saveJSON(key, data) {
  try { localStorage.setItem(key, JSON.stringify(data)); } catch { /* full */ }
}

const DEFAULT_HOLDINGS = [
  { id: 1, symbol: "BTC", type: "crypto", exchange: "coinbase", qty: 1, costBasis: 40000, label: "Bitcoin", openDate: "2024-01-15" },
  { id: 2, symbol: "ETH", type: "crypto", exchange: "coinbase", qty: 10, costBasis: 2200, label: "Ethereum", openDate: "2024-02-01" },
  { id: 3, symbol: "SOL", type: "crypto", exchange: "coinbase", qty: 50, costBasis: 80, label: "Solana", openDate: "2024-03-10" },
];

// ─── STYLES ─────────────────────────────────────────────────────────────────
const S = {
  container: { padding: 24, maxWidth: 1400, margin: "0 auto", fontFamily: FONTS.mono, color: COLORS.text.primary },
  sectionTitle: {
    fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1.2px",
    color: COLORS.text.dim, marginBottom: 12, display: "flex", alignItems: "center", gap: 8,
  },
  divider: { flex: 1, height: 1, background: COLORS.border.primary },
  card: {
    background: COLORS.bg.elevated, border: `1px solid ${COLORS.border.secondary}`,
    borderRadius: 8, overflow: "hidden",
  },
  summaryRow: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 24 },
  summaryCard: { padding: "14px 16px", background: COLORS.bg.elevated, border: `1px solid ${COLORS.border.secondary}`, borderRadius: 8 },
  cardLabel: { fontSize: 9, color: COLORS.text.dim, textTransform: "uppercase", letterSpacing: "0.5px" },
  cardValue: { fontSize: 18, fontWeight: 600, marginTop: 4 },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 11 },
  th: {
    padding: "10px 12px", textAlign: "left", fontSize: 9, color: COLORS.text.dim,
    textTransform: "uppercase", letterSpacing: "0.5px", borderBottom: `1px solid ${COLORS.border.secondary}`,
    background: COLORS.bg.elevated, position: "sticky", top: 0,
  },
  td: { padding: "10px 12px", borderBottom: `1px solid ${COLORS.border.primary}`, color: COLORS.text.secondary },
  btn: {
    padding: "5px 12px", fontSize: 10, fontFamily: FONTS.mono, cursor: "pointer", borderRadius: 4,
    border: `1px solid ${COLORS.border.secondary}`, background: COLORS.bg.elevated, color: COLORS.text.muted,
    transition: "all 0.15s",
  },
  btnPrimary: {
    padding: "5px 12px", fontSize: 10, fontFamily: FONTS.mono, cursor: "pointer", borderRadius: 4,
    border: `1px solid ${COLORS.accent.blueBorder}`, background: COLORS.accent.blueBg, color: COLORS.accent.blue,
  },
  btnDanger: {
    padding: "4px 8px", fontSize: 9, fontFamily: FONTS.mono, cursor: "pointer", borderRadius: 3,
    border: `1px solid ${COLORS.negative.border}`, background: COLORS.negative.bg, color: COLORS.negative.text,
  },
  btnSuccess: {
    padding: "4px 8px", fontSize: 9, fontFamily: FONTS.mono, cursor: "pointer", borderRadius: 3,
    border: `1px solid ${COLORS.positive.border}`, background: COLORS.positive.bg, color: COLORS.positive.text,
  },
  input: {
    background: COLORS.bg.input, border: `1px solid ${COLORS.border.secondary}`, color: COLORS.text.primary,
    padding: "5px 8px", borderRadius: 4, fontFamily: FONTS.mono, fontSize: 11, outline: "none", width: 100,
  },
};

const pnlColor = (v) => v >= 0 ? COLORS.positive.text : COLORS.negative.text;

// ─── CHART TOOLTIP ──────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: COLORS.bg.elevated, border: `1px solid ${COLORS.border.secondary}`,
      borderRadius: 6, padding: "8px 12px", fontSize: 10, fontFamily: FONTS.mono,
    }}>
      <div style={{ color: COLORS.text.dim, marginBottom: 4 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color, display: "flex", gap: 8 }}>
          <span>{p.name}:</span>
          <span style={{ fontWeight: 600 }}>{fmtDollar(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

// ─── MAIN COMPONENT ─────────────────────────────────────────────────────────
export default function Portfolio({ onNavigateToChart }) {
  // ── State ──
  const [holdings, setHoldings] = useState(() => loadJSON(KEYS.holdings, DEFAULT_HOLDINGS));
  const [closedTrades, setClosedTrades] = useState(() => loadJSON(KEYS.closedTrades, []));
  const [snapshots, setSnapshots] = useState(() => loadJSON(KEYS.snapshots, []));
  const [prices, setPrices] = useState({});
  const [klineData, setKlineData] = useState({});
  const [loading, setLoading] = useState(false);
  const [chartLoading, setChartLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [nextId, setNextId] = useState(() => {
    const allIds = [
      ...loadJSON(KEYS.holdings, DEFAULT_HOLDINGS).map(h => h.id),
      ...loadJSON(KEYS.closedTrades, []).map(t => t.id),
    ];
    return Math.max(0, ...allIds) + 1;
  });

  // Close trade modal
  const [closingHolding, setClosingHolding] = useState(null);
  const [closePrice, setClosePrice] = useState("");
  const [closeDate, setCloseDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [closeQty, setCloseQty] = useState("");
  const [closeNotes, setCloseNotes] = useState("");

  // Add holding form
  const [newSymbol, setNewSymbol] = useState("");
  const [newQty, setNewQty] = useState("");
  const [newCost, setNewCost] = useState("");
  const [newType, setNewType] = useState("crypto");
  const [newDate, setNewDate] = useState(() => new Date().toISOString().split("T")[0]);

  // Chart range
  const [chartRange, setChartRange] = useState(90); // days

  // Import ref
  const importRef = useRef(null);

  // ── Persist ──
  useEffect(() => { saveJSON(KEYS.holdings, holdings); }, [holdings]);
  useEffect(() => { saveJSON(KEYS.closedTrades, closedTrades); }, [closedTrades]);
  useEffect(() => { saveJSON(KEYS.snapshots, snapshots); }, [snapshots]);

  // ── Fetch live prices ──
  const refreshPrices = useCallback(async () => {
    if (holdings.length === 0) return;
    setLoading(true);
    try {
      const result = await fetchTickers(holdings);
      setPrices(result);
      setLastRefresh(new Date());

      // Take a daily snapshot (max 1 per day)
      const today = new Date().toISOString().split("T")[0];
      const lastSnap = snapshots[snapshots.length - 1];
      if (!lastSnap || lastSnap.date !== today) {
        let totalValue = 0;
        holdings.forEach(h => {
          const p = result[h.symbol.toUpperCase()]?.price || 0;
          totalValue += p * h.qty;
        });
        if (totalValue > 0) {
          const newSnap = { date: today, value: totalValue };
          setSnapshots(prev => [...prev.slice(-365), newSnap]); // keep 1 year
        }
      }
    } catch (err) {
      if (import.meta.env.DEV) console.error("[Portfolio] refresh failed:", err);
    } finally {
      setLoading(false);
    }
  }, [holdings, snapshots]);

  // ── Fetch historical klines for chart ──
  const refreshChart = useCallback(async () => {
    if (holdings.length === 0) return;
    setChartLoading(true);
    try {
      const startTime = Date.now() - chartRange * 24 * 60 * 60 * 1000;
      const requests = holdings.map(h => ({
        symbol: h.symbol, type: h.type, exchange: h.exchange, startTime,
      }));
      const result = await fetchAllKlines(requests);
      setKlineData(result);
    } catch (err) {
      if (import.meta.env.DEV) console.error("[Portfolio] chart data failed:", err);
    } finally {
      setChartLoading(false);
    }
  }, [holdings, chartRange]);

  // Auto-refresh prices on mount and every 30s
  useEffect(() => {
    refreshPrices();
    const interval = setInterval(refreshPrices, 30000);
    return () => clearInterval(interval);
  }, [refreshPrices]);

  // Fetch chart data on mount and range change
  useEffect(() => { refreshChart(); }, [refreshChart]);

  // ── Portfolio value chart data ──
  const chartData = useMemo(() => {
    if (Object.keys(klineData).length === 0) return [];

    // Build a unified timeline: for each date, sum (holding qty × price) across all assets
    const dateMap = {};

    holdings.forEach(h => {
      const key = h.symbol.toUpperCase();
      const klines = klineData[key];
      if (!klines) return;
      klines.forEach(k => {
        const day = k.date?.slice(0, 10);
        if (!day) return;
        if (!dateMap[day]) dateMap[day] = { date: day, totalValue: 0, breakdown: {} };
        const val = k.close * h.qty;
        dateMap[day].totalValue += val;
        dateMap[day].breakdown[key] = (dateMap[day].breakdown[key] || 0) + val;
      });
    });

    // Also add cost basis line
    const totalCost = holdings.reduce((sum, h) => sum + h.costBasis * h.qty, 0);

    return Object.values(dateMap)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(d => ({ ...d, costBasis: totalCost }));
  }, [klineData, holdings]);

  // ── Summary calculations ──
  const summary = useMemo(() => {
    let totalValue = 0, totalCost = 0;
    const enriched = holdings.map(h => {
      const key = h.symbol.toUpperCase();
      const priceData = prices[key];
      const currentPrice = priceData?.price || 0;
      const change24h = priceData?.change || 0;
      const marketValue = currentPrice * h.qty;
      const costTotal = h.costBasis * h.qty;
      const pnl = marketValue - costTotal;
      const pnlPct = costTotal > 0 ? pnl / costTotal : 0;
      totalValue += marketValue;
      totalCost += costTotal;
      return { ...h, currentPrice, change24h, marketValue, costTotal, pnl, pnlPct };
    });
    const totalPnl = totalValue - totalCost;
    const totalPnlPct = totalCost > 0 ? totalPnl / totalCost : 0;

    // Closed trades summary
    const realizedPnl = closedTrades.reduce((sum, t) => sum + (t.realizedPnl || 0), 0);

    return { enriched, totalValue, totalCost, totalPnl, totalPnlPct, realizedPnl };
  }, [holdings, prices, closedTrades]);

  // ── Actions ──
  const addHolding = useCallback(() => {
    const sym = newSymbol.trim().toUpperCase();
    if (!sym) return;
    setHoldings(prev => [...prev, {
      id: nextId, symbol: sym, type: newType, exchange: "auto",
      qty: parseFloat(newQty) || 0, costBasis: parseFloat(newCost) || 0,
      label: sym, openDate: newDate,
    }]);
    setNextId(p => p + 1);
    setNewSymbol(""); setNewQty(""); setNewCost("");
  }, [newSymbol, newQty, newCost, newType, newDate, nextId]);

  const removeHolding = useCallback((id) => {
    setHoldings(prev => prev.filter(h => h.id !== id));
  }, []);

  // ── Close Trade ──
  const startCloseTrade = useCallback((holding) => {
    setClosingHolding(holding);
    const key = holding.symbol.toUpperCase();
    const livePrice = prices[key]?.price;
    setClosePrice(livePrice ? String(livePrice) : "");
    setCloseQty(String(holding.qty));
    setCloseDate(new Date().toISOString().split("T")[0]);
    setCloseNotes("");
  }, [prices]);

  const confirmCloseTrade = useCallback(() => {
    if (!closingHolding) return;
    const qty = parseFloat(closeQty) || closingHolding.qty;
    const exitPrice = parseFloat(closePrice) || 0;
    const realizedPnl = (exitPrice - closingHolding.costBasis) * qty;

    const trade = {
      id: nextId,
      symbol: closingHolding.symbol,
      label: closingHolding.label || closingHolding.symbol,
      type: closingHolding.type,
      qty,
      costBasis: closingHolding.costBasis,
      exitPrice,
      openDate: closingHolding.openDate || "—",
      closeDate,
      realizedPnl,
      pnlPct: closingHolding.costBasis > 0 ? (exitPrice - closingHolding.costBasis) / closingHolding.costBasis : 0,
      notes: closeNotes,
    };
    setClosedTrades(prev => [trade, ...prev]);
    setNextId(p => p + 1);

    // If partial close, reduce qty; if full, remove
    if (qty >= closingHolding.qty) {
      setHoldings(prev => prev.filter(h => h.id !== closingHolding.id));
    } else {
      setHoldings(prev => prev.map(h =>
        h.id === closingHolding.id ? { ...h, qty: h.qty - qty } : h
      ));
    }
    setClosingHolding(null);
  }, [closingHolding, closePrice, closeQty, closeDate, closeNotes, nextId]);

  const deleteClosedTrade = useCallback((id) => {
    setClosedTrades(prev => prev.filter(t => t.id !== id));
  }, []);

  // ── Export / Import ──
  const exportPortfolio = useCallback(() => {
    const data = {
      version: 1,
      exportDate: new Date().toISOString(),
      holdings,
      closedTrades,
      snapshots,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `optionslab-portfolio-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [holdings, closedTrades, snapshots]);

  const importPortfolio = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (data.holdings) setHoldings(data.holdings);
        if (data.closedTrades) setClosedTrades(data.closedTrades);
        if (data.snapshots) setSnapshots(data.snapshots);
        // Reset next ID
        const allIds = [
          ...(data.holdings || []).map(h => h.id),
          ...(data.closedTrades || []).map(t => t.id),
        ];
        setNextId(Math.max(0, ...allIds) + 1);
      } catch (err) {
        alert("Invalid portfolio file");
      }
    };
    reader.readAsText(file);
    e.target.value = ""; // reset input
  }, []);

  // ────────────────────────────────────────────────────────────────────────────
  // RENDER
  // ────────────────────────────────────────────────────────────────────────────
  return (
    <div style={S.container}>
      {/* ── HEADER ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, fontFamily: FONTS.display, color: COLORS.text.primary, letterSpacing: "-0.3px" }}>
            Portfolio Tracker
          </div>
          <div style={{ fontSize: 9, color: COLORS.text.dim, marginTop: 4 }}>
            {lastRefresh ? `Updated ${lastRefresh.toLocaleTimeString()}` : "Loading..."}
            {loading && " • Refreshing..."}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button style={S.btn} onClick={refreshPrices} disabled={loading}>⟳ Refresh</button>
          <button style={S.btn} onClick={exportPortfolio}>↓ Export</button>
          <button style={S.btn} onClick={() => importRef.current?.click()}>↑ Import</button>
          <input ref={importRef} type="file" accept=".json" style={{ display: "none" }} onChange={importPortfolio} />
        </div>
      </div>

      {/* ── SUMMARY CARDS ── */}
      <div style={S.summaryRow}>
        <div style={S.summaryCard}>
          <div style={S.cardLabel}>Portfolio Value</div>
          <div style={{ ...S.cardValue, color: COLORS.text.primary }}>{fmtDollar(summary.totalValue)}</div>
        </div>
        <div style={S.summaryCard}>
          <div style={S.cardLabel}>Total Cost</div>
          <div style={{ ...S.cardValue, color: COLORS.text.muted }}>{fmtDollar(summary.totalCost)}</div>
        </div>
        <div style={S.summaryCard}>
          <div style={S.cardLabel}>Unrealized P&L</div>
          <div style={{ ...S.cardValue, color: pnlColor(summary.totalPnl) }}>
            {fmtDollar(summary.totalPnl)} ({fmtPnlPct(summary.totalPnlPct)})
          </div>
        </div>
        <div style={S.summaryCard}>
          <div style={S.cardLabel}>Realized P&L</div>
          <div style={{ ...S.cardValue, color: pnlColor(summary.realizedPnl) }}>
            {fmtDollar(summary.realizedPnl)}
          </div>
        </div>
      </div>

      {/* ── PORTFOLIO VALUE CHART ── */}
      <div style={{ marginBottom: 24 }}>
        <div style={S.sectionTitle}>
          <span>Portfolio Performance</span>
          <div style={S.divider} />
          <div style={{ display: "flex", gap: 2 }}>
            {[30, 90, 180, 365].map(d => (
              <button key={d} onClick={() => setChartRange(d)} style={{
                ...S.btn, padding: "3px 10px", fontSize: 9,
                ...(chartRange === d ? { background: COLORS.accent.blueBg, borderColor: COLORS.accent.blueBorder, color: COLORS.accent.blue } : {}),
              }}>
                {d}d
              </button>
            ))}
          </div>
        </div>
        <div style={{ ...S.card, padding: "16px 8px 8px" }}>
          {chartLoading && chartData.length === 0 ? (
            <div style={{ height: 280, display: "flex", alignItems: "center", justifyContent: "center", color: COLORS.text.dim, fontSize: 11 }}>
              Loading chart data...
            </div>
          ) : chartData.length === 0 ? (
            <div style={{ height: 280, display: "flex", alignItems: "center", justifyContent: "center", color: COLORS.text.dim, fontSize: 11 }}>
              No historical data available yet. Add holdings and refresh.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <defs>
                  <linearGradient id="portfolioGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={COLORS.accent.blue} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={COLORS.accent.blue} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={COLORS.border.primary} strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fill: COLORS.text.dim, fontSize: 9 }} tickLine={false}
                  axisLine={{ stroke: COLORS.border.primary }}
                  tickFormatter={(d) => { const dt = new Date(d); return `${dt.getMonth() + 1}/${dt.getDate()}`; }}
                  interval="preserveStartEnd" minTickGap={60} />
                <YAxis tick={{ fill: COLORS.text.dim, fontSize: 9 }} tickLine={false}
                  axisLine={{ stroke: COLORS.border.primary }}
                  tickFormatter={(v) => v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v.toFixed(0)}`}
                  domain={["auto", "auto"]} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="totalValue" name="Portfolio"
                  stroke={COLORS.accent.blue} strokeWidth={2}
                  fill="url(#portfolioGradient)" />
                <Line type="monotone" dataKey="costBasis" name="Cost Basis"
                  stroke={COLORS.text.dim} strokeWidth={1} strokeDasharray="6 3" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* ── OPEN POSITIONS TABLE ── */}
      <div style={{ marginBottom: 24 }}>
        <div style={S.sectionTitle}><span>Open Positions</span><div style={S.divider} /></div>
        <div style={S.card}>
          <table style={S.table}>
            <thead>
              <tr>
                {["Asset", "Qty", "Cost Basis", "Price", "24h", "Value", "P&L", "P&L %", "Actions"].map(col => (
                  <th key={col} style={S.th}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {summary.enriched.length === 0 ? (
                <tr><td colSpan={9} style={{ ...S.td, textAlign: "center", color: COLORS.text.dim, padding: 24 }}>No open positions</td></tr>
              ) : summary.enriched.map(h => (
                <tr key={h.id}>
                  <td style={{ ...S.td, fontWeight: 600, color: COLORS.text.primary }}>
                    {h.label || h.symbol}
                    <span style={{ marginLeft: 6, fontSize: 9, color: COLORS.text.dim }}>{h.symbol}</span>
                  </td>
                  <td style={S.td}>{h.qty}</td>
                  <td style={S.td}>{fmtDollar(h.costBasis)}</td>
                  <td style={{ ...S.td, color: h.currentPrice > 0 ? COLORS.text.primary : COLORS.text.dim }}>
                    {h.currentPrice > 0 ? fmtDollar(h.currentPrice) : "—"}
                  </td>
                  <td style={{ ...S.td, color: pnlColor(h.change24h) }}>
                    {h.change24h ? `${h.change24h >= 0 ? "+" : ""}${h.change24h.toFixed(2)}%` : "—"}
                  </td>
                  <td style={S.td}>{h.currentPrice > 0 ? fmtDollar(h.marketValue) : "—"}</td>
                  <td style={{ ...S.td, color: pnlColor(h.pnl), fontWeight: 500 }}>
                    {h.currentPrice > 0 ? fmtPnl(h.pnl) : "—"}
                  </td>
                  <td style={{ ...S.td, color: pnlColor(h.pnlPct) }}>
                    {h.currentPrice > 0 ? fmtPnlPct(h.pnlPct) : "—"}
                  </td>
                  <td style={{ ...S.td, whiteSpace: "nowrap" }}>
                    <button style={S.btnSuccess} onClick={() => startCloseTrade(h)}>Close</button>
                    {" "}
                    <button style={S.btnDanger} onClick={() => removeHolding(h.id)}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── ADD HOLDING FORM ── */}
      <div style={{
        marginBottom: 24, padding: 16, background: COLORS.bg.elevated,
        border: `1px solid ${COLORS.border.secondary}`, borderRadius: 8,
        display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
      }}>
        <span style={{ fontSize: 10, color: COLORS.text.dim }}>Add Position:</span>
        <input style={S.input} placeholder="Symbol" value={newSymbol}
          onChange={e => setNewSymbol(e.target.value)} onKeyDown={e => e.key === "Enter" && addHolding()} />
        <select style={{ ...S.input, width: 80 }} value={newType} onChange={e => setNewType(e.target.value)}>
          <option value="crypto">Crypto</option>
          <option value="equity">Equity</option>
        </select>
        <input style={{ ...S.input, width: 80 }} type="number" placeholder="Qty" value={newQty}
          onChange={e => setNewQty(e.target.value)} />
        <input style={{ ...S.input, width: 100 }} type="number" placeholder="Cost basis" value={newCost}
          onChange={e => setNewCost(e.target.value)} />
        <input style={{ ...S.input, width: 120 }} type="date" value={newDate}
          onChange={e => setNewDate(e.target.value)} />
        <button style={S.btnPrimary} onClick={addHolding}>+ Add</button>
      </div>

      {/* ── CLOSED TRADES TABLE ── */}
      <div style={{ marginBottom: 24 }}>
        <div style={S.sectionTitle}><span>Closed Trades</span><div style={S.divider} /></div>
        <div style={S.card}>
          <table style={S.table}>
            <thead>
              <tr>
                {["Asset", "Qty", "Entry Price", "Exit Price", "Open Date", "Close Date", "Realized P&L", "Return", "Notes", ""].map(col => (
                  <th key={col} style={S.th}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {closedTrades.length === 0 ? (
                <tr>
                  <td colSpan={10} style={{ ...S.td, textAlign: "center", color: COLORS.text.dim, padding: 24 }}>
                    No closed trades yet. Use the "Close" button on open positions to log exits.
                  </td>
                </tr>
              ) : closedTrades.map(t => (
                <tr key={t.id}>
                  <td style={{ ...S.td, fontWeight: 600, color: COLORS.text.primary }}>
                    {t.label || t.symbol}
                    <span style={{ marginLeft: 6, fontSize: 9, color: COLORS.text.dim }}>{t.symbol}</span>
                  </td>
                  <td style={S.td}>{t.qty}</td>
                  <td style={S.td}>{fmtDollar(t.costBasis)}</td>
                  <td style={S.td}>{fmtDollar(t.exitPrice)}</td>
                  <td style={{ ...S.td, fontSize: 10 }}>{t.openDate}</td>
                  <td style={{ ...S.td, fontSize: 10 }}>{t.closeDate}</td>
                  <td style={{ ...S.td, color: pnlColor(t.realizedPnl), fontWeight: 600 }}>
                    {fmtPnl(t.realizedPnl)}
                  </td>
                  <td style={{ ...S.td, color: pnlColor(t.pnlPct) }}>
                    {fmtPnlPct(t.pnlPct)}
                  </td>
                  <td style={{ ...S.td, fontSize: 9, color: COLORS.text.dim, maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {t.notes || "—"}
                  </td>
                  <td style={S.td}>
                    <button style={S.btnDanger} onClick={() => deleteClosedTrade(t.id)}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── CLOSE TRADE MODAL ── */}
      {closingHolding && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000,
          display: "flex", alignItems: "center", justifyContent: "center",
        }} onClick={() => setClosingHolding(null)}>
          <div style={{
            background: COLORS.bg.secondary, border: `1px solid ${COLORS.border.secondary}`,
            borderRadius: 12, padding: 24, minWidth: 380, maxWidth: 440,
            fontFamily: FONTS.mono,
          }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.text.primary, marginBottom: 16, fontFamily: FONTS.display }}>
              Close Position: {closingHolding.label || closingHolding.symbol}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <div style={{ fontSize: 9, color: COLORS.text.dim, textTransform: "uppercase", marginBottom: 4 }}>Qty to close (max {closingHolding.qty})</div>
                <input style={{ ...S.input, width: "100%" }} type="number" value={closeQty}
                  onChange={e => setCloseQty(e.target.value)} max={closingHolding.qty} step="any" />
              </div>
              <div>
                <div style={{ fontSize: 9, color: COLORS.text.dim, textTransform: "uppercase", marginBottom: 4 }}>Exit Price</div>
                <input style={{ ...S.input, width: "100%" }} type="number" value={closePrice}
                  onChange={e => setClosePrice(e.target.value)} step="any" placeholder="Sale price per unit" />
              </div>
              <div>
                <div style={{ fontSize: 9, color: COLORS.text.dim, textTransform: "uppercase", marginBottom: 4 }}>Close Date</div>
                <input style={{ ...S.input, width: "100%" }} type="date" value={closeDate}
                  onChange={e => setCloseDate(e.target.value)} />
              </div>
              <div>
                <div style={{ fontSize: 9, color: COLORS.text.dim, textTransform: "uppercase", marginBottom: 4 }}>Notes (optional)</div>
                <input style={{ ...S.input, width: "100%" }} type="text" value={closeNotes}
                  onChange={e => setCloseNotes(e.target.value)} placeholder="Stop loss hit, took profits, etc." />
              </div>

              {/* Preview */}
              {closePrice && (
                <div style={{
                  padding: 12, background: COLORS.bg.primary, borderRadius: 6,
                  border: `1px solid ${COLORS.border.primary}`,
                }}>
                  <div style={{ fontSize: 9, color: COLORS.text.dim, marginBottom: 6 }}>PREVIEW</div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                    <span style={{ color: COLORS.text.muted }}>Cost: {fmtDollar(closingHolding.costBasis)} × {closeQty || closingHolding.qty}</span>
                    <span style={{ color: COLORS.text.muted }}>Exit: {fmtDollar(parseFloat(closePrice))} × {closeQty || closingHolding.qty}</span>
                  </div>
                  <div style={{
                    fontSize: 16, fontWeight: 700, marginTop: 8,
                    color: pnlColor((parseFloat(closePrice) - closingHolding.costBasis) * (parseFloat(closeQty) || closingHolding.qty)),
                  }}>
                    {fmtPnl((parseFloat(closePrice) - closingHolding.costBasis) * (parseFloat(closeQty) || closingHolding.qty))}
                  </div>
                </div>
              )}

              <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                <button style={{ ...S.btnPrimary, flex: 1, padding: "8px 16px" }} onClick={confirmCloseTrade}>
                  Confirm Close
                </button>
                <button style={{ ...S.btn, padding: "8px 16px" }} onClick={() => setClosingHolding(null)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
