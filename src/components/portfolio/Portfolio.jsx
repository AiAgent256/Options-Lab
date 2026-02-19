import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { fetchTickers, fetchAllKlines } from "../../hooks/useMarketData";
import { fmtDollar, fmtPnl, fmtPnlPct, fmtPrice } from "../../utils/format";
import { COLORS, FONTS } from "../../utils/constants";

// ─── PERSISTENCE ────────────────────────────────────────────────────────────
const KEYS = {
  holdings: "optlab:portfolio:holdings",
  closedTrades: "optlab:portfolio:closed",
  snapshots: "optlab:portfolio:snapshots",
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

const ASSET_CLASS_LABELS = {
  market: "Market Assets",
  collectible: "Collectibles",
  cash: "Cash & Margin",
};

const ASSET_CLASS_COLORS = {
  market: COLORS.accent.blue,
  collectible: "#c084fc",
  cash: "#34d399",
};

const DEFAULT_HOLDINGS = [];

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
  summaryRow: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 24 },
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
  subtotalRow: {
    padding: "8px 12px", background: COLORS.bg.primary, borderTop: `1px solid ${COLORS.border.secondary}`,
    display: "flex", justifyContent: "space-between", fontSize: 11, fontWeight: 600,
  },
  badge: (color) => ({
    display: "inline-block", padding: "2px 6px", borderRadius: 3, fontSize: 8,
    fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px",
    background: color + "22", color: color, border: `1px solid ${color}44`,
  }),
};

const pnlColor = (v) => v >= 0 ? COLORS.positive.text : COLORS.negative.text;

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

function Row({ label, children, flex }) {
  return (
    <div style={{ flex }}>
      <div style={{ fontSize: 9, color: COLORS.text.dim, textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}

// ─── UPDATE VALUE MODAL ─────────────────────────────────────────────────────
function UpdateValueModal({ holding, onSave, onCancel }) {
  const [val, setVal] = useState(String(holding.manualPrice || ""));
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000,
      display: "flex", alignItems: "center", justifyContent: "center",
    }} onClick={onCancel}>
      <div style={{
        background: COLORS.bg.secondary, border: `1px solid ${COLORS.border.secondary}`,
        borderRadius: 12, padding: 24, minWidth: 340, fontFamily: FONTS.mono,
      }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.text.primary, marginBottom: 16, fontFamily: FONTS.display }}>
          Update Value: {holding.label || holding.symbol}
        </div>
        <Row label="Current estimated value per unit">
          <input style={{ ...S.input, width: "100%", marginBottom: 12 }} type="number" step="any"
            value={val} onChange={e => setVal(e.target.value)} autoFocus
            onKeyDown={e => e.key === "Enter" && onSave(parseFloat(val) || 0)} />
        </Row>
        {holding.costBasis > 0 && val && (
          <div style={{
            padding: 10, background: COLORS.bg.primary, borderRadius: 6,
            border: `1px solid ${COLORS.border.primary}`, marginBottom: 12,
          }}>
            <div style={{ fontSize: 9, color: COLORS.text.dim, marginBottom: 4 }}>PREVIEW (per unit)</div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
              <span style={{ color: COLORS.text.muted }}>Paid: {fmtPrice(holding.costBasis)}</span>
              <span style={{ color: COLORS.text.muted }}>Now: {fmtPrice(parseFloat(val))}</span>
            </div>
            <div style={{
              fontSize: 14, fontWeight: 700, marginTop: 6,
              color: pnlColor((parseFloat(val) || 0) - holding.costBasis),
            }}>
              {fmtPnl(((parseFloat(val) || 0) - holding.costBasis) * holding.qty)}
              <span style={{ fontSize: 10, marginLeft: 6 }}>
                ({fmtPnlPct(holding.costBasis > 0 ? ((parseFloat(val) || 0) - holding.costBasis) / holding.costBasis : 0)})
              </span>
            </div>
          </div>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <button style={{ ...S.btnPrimary, flex: 1, padding: "8px 16px" }}
            onClick={() => onSave(parseFloat(val) || 0)}>Save</button>
          <button style={{ ...S.btn, padding: "8px 16px" }} onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ─── ADD ASSET MODAL ────────────────────────────────────────────────────────
function AddAssetModal({ onAdd, onCancel, nextId }) {
  const [assetClass, setAssetClass] = useState("market");
  const [symbol, setSymbol] = useState("");
  const [label, setLabel] = useState("");
  const [qty, setQty] = useState("1");
  const [costBasis, setCostBasis] = useState("");
  const [manualPrice, setManualPrice] = useState("");
  const [type, setType] = useState("crypto");
  const [leverage, setLeverage] = useState("1");
  const [openDate, setOpenDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [notes, setNotes] = useState("");
  const [grade, setGrade] = useState("");
  const [cardSet, setCardSet] = useState("");

  const handleAdd = () => {
    const sym = symbol.trim().toUpperCase() || label.trim().toUpperCase().replace(/\s+/g, "_") || "ITEM";
    const holding = {
      id: nextId,
      assetClass,
      symbol: sym,
      label: label.trim() || sym,
      type: assetClass === "market" ? type : assetClass,
      exchange: assetClass === "market" ? "auto" : null,
      qty: parseFloat(qty) || 1,
      costBasis: assetClass === "cash" ? 0 : (parseFloat(costBasis) || 0),
      leverage: assetClass === "market" ? (parseFloat(leverage) || 1) : 1,
      manualPrice: assetClass !== "market" ? (parseFloat(manualPrice) || parseFloat(costBasis) || 0) : null,
      manualPriceDate: assetClass !== "market" ? new Date().toISOString().split("T")[0] : null,
      openDate,
      notes: notes.trim(),
      ...(assetClass === "collectible" ? { grade: grade.trim(), cardSet: cardSet.trim() } : {}),
    };
    onAdd(holding);
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000,
      display: "flex", alignItems: "center", justifyContent: "center",
    }} onClick={onCancel}>
      <div style={{
        background: COLORS.bg.secondary, border: `1px solid ${COLORS.border.secondary}`,
        borderRadius: 12, padding: 24, minWidth: 420, maxWidth: 480, fontFamily: FONTS.mono,
        maxHeight: "85vh", overflowY: "auto",
      }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.text.primary, marginBottom: 16, fontFamily: FONTS.display }}>
          Add Asset
        </div>
        <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
          {Object.entries(ASSET_CLASS_LABELS).map(([key, lbl]) => (
            <button key={key} onClick={() => setAssetClass(key)} style={{
              ...S.btn, flex: 1, padding: "8px 12px", textAlign: "center",
              ...(assetClass === key ? {
                background: ASSET_CLASS_COLORS[key] + "22",
                borderColor: ASSET_CLASS_COLORS[key],
                color: ASSET_CLASS_COLORS[key],
              } : {}),
            }}>{lbl}</button>
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {assetClass === "market" && (
            <Row label="Symbol">
              <input style={{ ...S.input, width: "100%" }} placeholder="BTC, ETH, MSTR..." value={symbol}
                onChange={e => setSymbol(e.target.value)} autoFocus />
            </Row>
          )}
          {assetClass === "collectible" && (
            <>
              <Row label="Card / Item Name">
                <input style={{ ...S.input, width: "100%" }} placeholder="Charizard EX 105/112" value={label}
                  onChange={e => setLabel(e.target.value)} autoFocus />
              </Row>
              <div style={{ display: "flex", gap: 8 }}>
                <Row label="Set" flex={1}>
                  <input style={{ ...S.input, width: "100%" }} placeholder="EX FireRed" value={cardSet}
                    onChange={e => setCardSet(e.target.value)} />
                </Row>
                <Row label="Grade" flex={1}>
                  <input style={{ ...S.input, width: "100%" }} placeholder="PSA 9" value={grade}
                    onChange={e => setGrade(e.target.value)} />
                </Row>
              </div>
            </>
          )}
          {assetClass === "cash" && (
            <Row label="Account Label">
              <input style={{ ...S.input, width: "100%" }} placeholder="Coinbase Margin, Savings..." value={label}
                onChange={e => setLabel(e.target.value)} autoFocus />
            </Row>
          )}
          {assetClass === "market" && (
            <div style={{ display: "flex", gap: 8 }}>
              <Row label="Type" flex={1}>
                <select style={{ ...S.input, width: "100%" }} value={type} onChange={e => setType(e.target.value)}>
                  <option value="crypto">Crypto</option>
                  <option value="equity">Equity</option>
                </select>
              </Row>
              <Row label="Leverage" flex={1}>
                <input style={{ ...S.input, width: "100%" }} type="number" min="1" step="1" value={leverage}
                  onChange={e => setLeverage(e.target.value)} />
              </Row>
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <Row label={assetClass === "cash" ? "Amount (USD)" : "Quantity"} flex={1}>
              <input style={{ ...S.input, width: "100%" }} type="number" step="any" value={qty}
                onChange={e => setQty(e.target.value)} />
            </Row>
            {assetClass !== "cash" && (
              <Row label="Cost Basis (per unit)" flex={1}>
                <input style={{ ...S.input, width: "100%" }} type="number" step="any" value={costBasis}
                  onChange={e => setCostBasis(e.target.value)} />
              </Row>
            )}
          </div>
          {assetClass === "collectible" && (
            <Row label="Current Value (per unit)">
              <input style={{ ...S.input, width: "100%" }} type="number" step="any" value={manualPrice}
                onChange={e => setManualPrice(e.target.value)} placeholder="What it's worth today" />
            </Row>
          )}
          <Row label="Date Acquired">
            <input style={{ ...S.input, width: "100%" }} type="date" value={openDate}
              onChange={e => setOpenDate(e.target.value)} />
          </Row>
          <Row label="Notes (optional)">
            <input style={{ ...S.input, width: "100%" }} value={notes}
              onChange={e => setNotes(e.target.value)} placeholder="Any extra info..." />
          </Row>
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button style={{ ...S.btnPrimary, flex: 1, padding: "8px 16px" }} onClick={handleAdd}>+ Add</button>
            <button style={{ ...S.btn, padding: "8px 16px" }} onClick={onCancel}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── MAIN ───────────────────────────────────────────────────────────────────
export default function Portfolio({ onNavigateToChart }) {
  const [holdings, setHoldings] = useState(() => loadJSON(KEYS.holdings, DEFAULT_HOLDINGS));
  const [closedTrades, setClosedTrades] = useState(() => loadJSON(KEYS.closedTrades, []));
  const [snapshots, setSnapshots] = useState(() => loadJSON(KEYS.snapshots, []));
  const [prices, setPrices] = useState({});
  const [klineData, setKlineData] = useState({});
  const [loading, setLoading] = useState(false);
  const [chartLoading, setChartLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [nextId, setNextId] = useState(() => {
    const allIds = [...loadJSON(KEYS.holdings, DEFAULT_HOLDINGS).map(h => h.id), ...loadJSON(KEYS.closedTrades, []).map(t => t.id)];
    return Math.max(0, ...allIds) + 1;
  });

  const [showAddModal, setShowAddModal] = useState(false);
  const [closingHolding, setClosingHolding] = useState(null);
  const [updatingHolding, setUpdatingHolding] = useState(null);
  const [closePrice, setClosePrice] = useState("");
  const [closeDate, setCloseDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [closeQty, setCloseQty] = useState("");
  const [closeNotes, setCloseNotes] = useState("");
  const [chartRange, setChartRange] = useState(90);
  const importRef = useRef(null);

  const marketHoldings = useMemo(() => holdings.filter(h => (h.assetClass || "market") === "market"), [holdings]);
  const collectibleHoldings = useMemo(() => holdings.filter(h => h.assetClass === "collectible"), [holdings]);
  const cashHoldings = useMemo(() => holdings.filter(h => h.assetClass === "cash"), [holdings]);

  useEffect(() => { saveJSON(KEYS.holdings, holdings); }, [holdings]);
  useEffect(() => { saveJSON(KEYS.closedTrades, closedTrades); }, [closedTrades]);
  useEffect(() => { saveJSON(KEYS.snapshots, snapshots); }, [snapshots]);

  const refreshPrices = useCallback(async () => {
    if (marketHoldings.length === 0) { setLastRefresh(new Date()); return; }
    setLoading(true);
    try {
      const result = await fetchTickers(marketHoldings);
      setPrices(result);
      setLastRefresh(new Date());
      const today = new Date().toISOString().split("T")[0];
      const lastSnap = snapshots[snapshots.length - 1];
      if (!lastSnap || lastSnap.date !== today) {
        let totalValue = 0;
        marketHoldings.forEach(h => { totalValue += ((result[h.symbol.toUpperCase()]?.price || 0) * h.qty) / (h.leverage || 1); });
        collectibleHoldings.forEach(h => { totalValue += (h.manualPrice || 0) * h.qty; });
        cashHoldings.forEach(h => { totalValue += h.qty; });
        if (totalValue > 0) setSnapshots(prev => [...prev.slice(-365), { date: today, value: totalValue }]);
      }
    } catch (err) {
      if (import.meta.env.DEV) console.error("[Portfolio] refresh failed:", err);
    } finally { setLoading(false); }
  }, [marketHoldings, collectibleHoldings, cashHoldings, snapshots]);

  const refreshChart = useCallback(async () => {
    if (marketHoldings.length === 0) return;
    setChartLoading(true);
    try {
      const startTime = Date.now() - chartRange * 24 * 60 * 60 * 1000;
      const requests = marketHoldings.map(h => ({ symbol: h.symbol, type: h.type, exchange: h.exchange, startTime }));
      setKlineData(await fetchAllKlines(requests));
    } catch (err) {
      if (import.meta.env.DEV) console.error("[Portfolio] chart data failed:", err);
    } finally { setChartLoading(false); }
  }, [marketHoldings, chartRange]);

  useEffect(() => { refreshPrices(); const i = setInterval(refreshPrices, 30000); return () => clearInterval(i); }, [refreshPrices]);
  useEffect(() => { refreshChart(); }, [refreshChart]);

  const chartData = useMemo(() => {
    if (Object.keys(klineData).length === 0) return [];
    const assetDayPrice = {};
    marketHoldings.forEach(h => {
      const key = h.symbol.toUpperCase();
      const klines = klineData[key];
      if (!klines) return;
      if (!assetDayPrice[key]) assetDayPrice[key] = {};
      klines.forEach(k => {
        const day = k.date?.slice(0, 10);
        if (!day || !k.close) return;
        assetDayPrice[key][day] = k.close;
      });
    });
    const allDates = new Set();
    Object.values(assetDayPrice).forEach(dm => Object.keys(dm).forEach(d => allDates.add(d)));
    const collectibleTotal = collectibleHoldings.reduce((s, h) => s + (h.manualPrice || 0) * h.qty, 0);
    const cashTotal = cashHoldings.reduce((s, h) => s + h.qty, 0);
    const staticTotal = collectibleTotal + cashTotal;
    const totalCost = holdings.reduce((sum, h) => {
      if ((h.assetClass || "market") === "cash") return sum + h.qty;
      return sum + (h.costBasis * h.qty) / (h.leverage || 1);
    }, 0);
    return [...allDates].sort().map(date => {
      let mv = 0;
      marketHoldings.forEach(h => {
        const price = assetDayPrice[h.symbol.toUpperCase()]?.[date];
        if (price != null) mv += (price * h.qty) / (h.leverage || 1);
      });
      return { date, totalValue: mv + staticTotal, costBasis: totalCost };
    });
  }, [klineData, marketHoldings, collectibleHoldings, cashHoldings, holdings]);

  const summary = useMemo(() => {
    let marketValue = 0, marketCost = 0, marketPnl = 0;
    const enrichedMarket = marketHoldings.map(h => {
      const pd = prices[h.symbol.toUpperCase()];
      const cp = pd?.price || 0, ch = pd?.change || 0, lev = h.leverage || 1;
      const mv = (cp * h.qty) / lev;           // margin value (capital at risk)
      const ct = (h.costBasis * h.qty) / lev;   // margin cost (capital deployed)
      const pnl = (cp - h.costBasis) * h.qty;   // notional P&L — what actually hits your account
      const pp = ct > 0 ? pnl / ct : 0;         // return on margin
      marketValue += mv; marketCost += ct; marketPnl += pnl;
      return { ...h, currentPrice: cp, change24h: ch, marketValue: mv, costTotal: ct, pnl, pnlPct: pp };
    });
    let collectibleValue = 0, collectibleCost = 0;
    const enrichedCollectibles = collectibleHoldings.map(h => {
      const cp = h.manualPrice || 0, mv = cp * h.qty, ct = h.costBasis * h.qty;
      const pnl = mv - ct, pp = ct > 0 ? pnl / ct : 0;
      collectibleValue += mv; collectibleCost += ct;
      return { ...h, currentPrice: cp, change24h: 0, marketValue: mv, costTotal: ct, pnl, pnlPct: pp };
    });
    const cashValue = cashHoldings.reduce((s, h) => s + h.qty, 0);
    const totalValue = marketValue + collectibleValue + cashValue;
    const totalCost = marketCost + collectibleCost + cashValue;
    const collectiblePnl = collectibleValue - collectibleCost;
    const totalPnl = marketPnl + collectiblePnl;
    const totalPnlPct = totalCost > 0 ? totalPnl / totalCost : 0;
    const realizedPnl = closedTrades.reduce((s, t) => s + (t.realizedPnl || 0), 0);
    return { enrichedMarket, enrichedCollectibles, marketValue, marketCost, collectibleValue, collectibleCost, cashValue, totalValue, totalCost, totalPnl, totalPnlPct, realizedPnl };
  }, [marketHoldings, collectibleHoldings, cashHoldings, prices, closedTrades]);

  const addHolding = useCallback((h) => { setHoldings(prev => [...prev, h]); setNextId(p => p + 1); setShowAddModal(false); }, []);
  const removeHolding = useCallback((id) => { setHoldings(prev => prev.filter(h => h.id !== id)); }, []);
  const updateManualPrice = useCallback((id, np) => {
    setHoldings(prev => prev.map(h => h.id === id ? { ...h, manualPrice: np, manualPriceDate: new Date().toISOString().split("T")[0] } : h));
    setUpdatingHolding(null);
  }, []);
  const updateCashAmount = useCallback((id, nq) => { setHoldings(prev => prev.map(h => h.id === id ? { ...h, qty: nq } : h)); }, []);

  const startCloseTrade = useCallback((holding) => {
    setClosingHolding(holding);
    const ac = holding.assetClass || "market";
    setClosePrice(ac === "market" ? String(prices[holding.symbol.toUpperCase()]?.price || "") : String(holding.manualPrice || ""));
    setCloseQty(String(holding.qty));
    setCloseDate(new Date().toISOString().split("T")[0]);
    setCloseNotes("");
  }, [prices]);

  const confirmCloseTrade = useCallback(() => {
    if (!closingHolding) return;
    const qty = parseFloat(closeQty) || closingHolding.qty;
    const exitPrice = parseFloat(closePrice) || 0;
    const realizedPnl = (exitPrice - closingHolding.costBasis) * qty;
    setClosedTrades(prev => [{
      id: nextId, symbol: closingHolding.symbol, label: closingHolding.label || closingHolding.symbol,
      type: closingHolding.type, assetClass: closingHolding.assetClass || "market", qty,
      costBasis: closingHolding.costBasis, exitPrice, openDate: closingHolding.openDate || "—",
      closeDate, realizedPnl,
      pnlPct: closingHolding.costBasis > 0 ? (exitPrice - closingHolding.costBasis) / closingHolding.costBasis : 0,
      notes: closeNotes,
    }, ...prev]);
    setNextId(p => p + 1);
    if (qty >= closingHolding.qty) setHoldings(prev => prev.filter(h => h.id !== closingHolding.id));
    else setHoldings(prev => prev.map(h => h.id === closingHolding.id ? { ...h, qty: h.qty - qty } : h));
    setClosingHolding(null);
  }, [closingHolding, closePrice, closeQty, closeDate, closeNotes, nextId]);

  const deleteClosedTrade = useCallback((id) => { setClosedTrades(prev => prev.filter(t => t.id !== id)); }, []);

  const exportPortfolio = useCallback(() => {
    const data = { version: 2, exportDate: new Date().toISOString(), holdings, closedTrades, snapshots };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `optionslab-portfolio-${new Date().toISOString().split("T")[0]}.json`;
    a.click(); URL.revokeObjectURL(url);
  }, [holdings, closedTrades, snapshots]);

  const importPortfolio = useCallback((e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (data.holdings) setHoldings(data.holdings);
        if (data.closedTrades) setClosedTrades(data.closedTrades);
        if (data.snapshots) setSnapshots(data.snapshots);
        const allIds = [...(data.holdings || []).map(h => h.id), ...(data.closedTrades || []).map(t => t.id)];
        setNextId(Math.max(0, ...allIds) + 1);
      } catch { alert("Invalid portfolio file"); }
    };
    reader.readAsText(file); e.target.value = "";
  }, []);

  // ── RENDER ──
  return (
    <div style={S.container}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, fontFamily: FONTS.display, color: COLORS.text.primary, letterSpacing: "-0.3px" }}>Portfolio Tracker</div>
          <div style={{ fontSize: 9, color: COLORS.text.dim, marginTop: 4 }}>
            {lastRefresh ? `Updated ${lastRefresh.toLocaleTimeString()}` : "Loading..."}{loading && " • Refreshing..."}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button style={S.btnPrimary} onClick={() => setShowAddModal(true)}>+ Add Asset</button>
          <button style={S.btn} onClick={refreshPrices} disabled={loading}>⟳ Refresh</button>
          <button style={S.btn} onClick={exportPortfolio}>↓ Export</button>
          <button style={S.btn} onClick={() => importRef.current?.click()}>↑ Import</button>
          <input ref={importRef} type="file" accept=".json" style={{ display: "none" }} onChange={importPortfolio} />
        </div>
      </div>

      {/* Summary */}
      <div style={S.summaryRow}>
        {[
          { label: "Total Net Worth", value: fmtDollar(summary.totalValue), color: COLORS.text.primary },
          { label: "Market Assets", value: fmtDollar(summary.marketValue), color: ASSET_CLASS_COLORS.market },
          { label: "Collectibles", value: fmtDollar(summary.collectibleValue), color: ASSET_CLASS_COLORS.collectible },
          { label: "Cash & Margin", value: fmtDollar(summary.cashValue), color: ASSET_CLASS_COLORS.cash },
          { label: "Unrealized P&L", value: `${fmtDollar(summary.totalPnl)} (${fmtPnlPct(summary.totalPnlPct)})`, color: pnlColor(summary.totalPnl) },
          { label: "Realized P&L", value: fmtDollar(summary.realizedPnl), color: pnlColor(summary.realizedPnl) },
        ].map((c, i) => (
          <div key={i} style={S.summaryCard}>
            <div style={S.cardLabel}>{c.label}</div>
            <div style={{ ...S.cardValue, color: c.color }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Chart */}
      <div style={{ marginBottom: 24 }}>
        <div style={S.sectionTitle}>
          <span>Portfolio Performance</span><div style={S.divider} />
          <div style={{ display: "flex", gap: 2 }}>
            {[1, 7, 30, 90, 180, 365].map(d => (
              <button key={d} onClick={() => setChartRange(d)} style={{
                ...S.btn, padding: "3px 10px", fontSize: 9,
                ...(chartRange === d ? { background: COLORS.accent.blueBg, borderColor: COLORS.accent.blueBorder, color: COLORS.accent.blue } : {}),
              }}>{d}d</button>
            ))}
          </div>
        </div>
        <div style={{ ...S.card, padding: "16px 8px 8px" }}>
          {chartLoading && chartData.length === 0 ? (
            <div style={{ height: 280, display: "flex", alignItems: "center", justifyContent: "center", color: COLORS.text.dim, fontSize: 11 }}>Loading chart data...</div>
          ) : chartData.length === 0 ? (
            <div style={{ height: 280, display: "flex", alignItems: "center", justifyContent: "center", color: COLORS.text.dim, fontSize: 11 }}>No historical data. Add market assets and refresh.</div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <defs>
                  <linearGradient id="portfolioGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={COLORS.accent.blue} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={COLORS.accent.blue} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={COLORS.border.primary} strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fill: COLORS.text.dim, fontSize: 9 }} tickLine={false}
                  axisLine={{ stroke: COLORS.border.primary }}
                  tickFormatter={d => { const dt = new Date(d); return `${dt.getMonth() + 1}/${dt.getDate()}`; }}
                  interval="preserveStartEnd" minTickGap={60} />
                <YAxis tick={{ fill: COLORS.text.dim, fontSize: 9 }} tickLine={false}
                  axisLine={{ stroke: COLORS.border.primary }}
                  tickFormatter={v => v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v.toFixed(0)}`}
                  domain={["auto", "auto"]} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="totalValue" name="Portfolio" stroke={COLORS.accent.blue} strokeWidth={2} fill="url(#portfolioGrad)" />
                <Line type="monotone" dataKey="costBasis" name="Cost Basis" stroke={COLORS.text.dim} strokeWidth={1} strokeDasharray="6 3" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Market Assets */}
      <div style={{ marginBottom: 24 }}>
        <div style={S.sectionTitle}>
          <span style={{ color: ASSET_CLASS_COLORS.market }}>Market Assets</span><div style={S.divider} />
          <span style={{ fontSize: 10, color: COLORS.text.muted }}>{fmtDollar(summary.marketValue)}</span>
        </div>
        <div style={S.card}>
          <table style={S.table}>
            <thead><tr>{["Asset", "Qty", "Lev", "Cost Basis", "Price", "24h", "Value", "P&L", "P&L %", ""].map(c => <th key={c} style={S.th}>{c}</th>)}</tr></thead>
            <tbody>
              {summary.enrichedMarket.length === 0 ? (
                <tr><td colSpan={10} style={{ ...S.td, textAlign: "center", color: COLORS.text.dim, padding: 20 }}>No market assets</td></tr>
              ) : summary.enrichedMarket.map(h => (
                <tr key={h.id}>
                  <td style={{ ...S.td, fontWeight: 600, color: COLORS.text.primary }}>{h.label || h.symbol}<span style={{ marginLeft: 6, fontSize: 9, color: COLORS.text.dim }}>{h.symbol}</span></td>
                  <td style={S.td}>{h.qty}</td>
                  <td style={{ ...S.td, color: (h.leverage || 1) > 1 ? COLORS.warning.text : COLORS.text.dim }}>{(h.leverage || 1) > 1 ? `${h.leverage}×` : "1×"}</td>
                  <td style={S.td}>{fmtPrice(h.costBasis)}</td>
                  <td style={{ ...S.td, color: h.currentPrice > 0 ? COLORS.text.primary : COLORS.text.dim }}>{h.currentPrice > 0 ? fmtPrice(h.currentPrice) : "—"}</td>
                  <td style={{ ...S.td, color: pnlColor(h.change24h) }}>{h.change24h ? `${h.change24h >= 0 ? "+" : ""}${h.change24h.toFixed(2)}%` : "—"}</td>
                  <td style={S.td}>{h.currentPrice > 0 ? fmtDollar(h.marketValue) : "—"}</td>
                  <td style={{ ...S.td, color: pnlColor(h.pnl), fontWeight: 500 }}>{h.currentPrice > 0 ? fmtPnl(h.pnl) : "—"}</td>
                  <td style={{ ...S.td, color: pnlColor(h.pnlPct) }}>{h.currentPrice > 0 ? fmtPnlPct(h.pnlPct) : "—"}</td>
                  <td style={{ ...S.td, whiteSpace: "nowrap" }}>
                    <button style={S.btnSuccess} onClick={() => startCloseTrade(h)}>Close</button>{" "}
                    <button style={S.btnDanger} onClick={() => removeHolding(h.id)}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Collectibles */}
      <div style={{ marginBottom: 24 }}>
        <div style={S.sectionTitle}>
          <span style={{ color: ASSET_CLASS_COLORS.collectible }}>Collectibles</span><div style={S.divider} />
          <span style={{ fontSize: 10, color: COLORS.text.muted }}>{fmtDollar(summary.collectibleValue)}</span>
        </div>
        <div style={S.card}>
          <table style={S.table}>
            <thead><tr>{["Item", "Qty", "Grade", "Paid", "Current Value", "Total Value", "P&L", "P&L %", "Updated", ""].map(c => <th key={c} style={S.th}>{c}</th>)}</tr></thead>
            <tbody>
              {summary.enrichedCollectibles.length === 0 ? (
                <tr><td colSpan={10} style={{ ...S.td, textAlign: "center", color: COLORS.text.dim, padding: 20 }}>No collectibles yet. Click "+ Add Asset" to add Pokemon cards.</td></tr>
              ) : summary.enrichedCollectibles.map(h => (
                <tr key={h.id}>
                  <td style={{ ...S.td, fontWeight: 600, color: COLORS.text.primary, maxWidth: 200 }}>
                    <div>{h.label || h.symbol}</div>
                    {h.cardSet && <div style={{ fontSize: 9, color: COLORS.text.dim, marginTop: 2 }}>{h.cardSet}</div>}
                    {h.notes && <div style={{ fontSize: 9, color: COLORS.text.dim, marginTop: 1, fontStyle: "italic" }}>{h.notes}</div>}
                  </td>
                  <td style={S.td}>{h.qty}</td>
                  <td style={S.td}>{h.grade ? <span style={S.badge(ASSET_CLASS_COLORS.collectible)}>{h.grade}</span> : "—"}</td>
                  <td style={S.td}>{fmtPrice(h.costBasis)}</td>
                  <td style={{ ...S.td, color: COLORS.text.primary, cursor: "pointer", textDecoration: "underline dotted" }}
                    onClick={() => setUpdatingHolding(h)} title="Click to update">{fmtPrice(h.manualPrice || 0)}</td>
                  <td style={S.td}>{fmtDollar(h.marketValue)}</td>
                  <td style={{ ...S.td, color: pnlColor(h.pnl), fontWeight: 500 }}>{fmtPnl(h.pnl)}</td>
                  <td style={{ ...S.td, color: pnlColor(h.pnlPct) }}>{fmtPnlPct(h.pnlPct)}</td>
                  <td style={{ ...S.td, fontSize: 9, color: COLORS.text.dim }}>{h.manualPriceDate || "—"}</td>
                  <td style={{ ...S.td, whiteSpace: "nowrap" }}>
                    <button style={S.btnSuccess} onClick={() => startCloseTrade(h)}>Sell</button>{" "}
                    <button style={S.btnDanger} onClick={() => removeHolding(h.id)}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {summary.enrichedCollectibles.length > 0 && (
            <div style={S.subtotalRow}>
              <span style={{ color: ASSET_CLASS_COLORS.collectible }}>{summary.enrichedCollectibles.length} item{summary.enrichedCollectibles.length > 1 ? "s" : ""}</span>
              <div style={{ display: "flex", gap: 16 }}>
                <span style={{ color: COLORS.text.dim }}>Cost: {fmtDollar(summary.collectibleCost)}</span>
                <span style={{ color: ASSET_CLASS_COLORS.collectible }}>Value: {fmtDollar(summary.collectibleValue)}</span>
                <span style={{ color: pnlColor(summary.collectibleValue - summary.collectibleCost), fontWeight: 600 }}>{fmtPnl(summary.collectibleValue - summary.collectibleCost)}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Cash */}
      <div style={{ marginBottom: 24 }}>
        <div style={S.sectionTitle}>
          <span style={{ color: ASSET_CLASS_COLORS.cash }}>Cash & Margin Accounts</span><div style={S.divider} />
          <span style={{ fontSize: 10, color: COLORS.text.muted }}>{fmtDollar(summary.cashValue)}</span>
        </div>
        <div style={S.card}>
          <table style={S.table}>
            <thead><tr>{["Account", "Balance", "Notes", ""].map(c => <th key={c} style={S.th}>{c}</th>)}</tr></thead>
            <tbody>
              {cashHoldings.length === 0 ? (
                <tr><td colSpan={4} style={{ ...S.td, textAlign: "center", color: COLORS.text.dim, padding: 20 }}>No cash accounts.</td></tr>
              ) : cashHoldings.map(h => (
                <tr key={h.id}>
                  <td style={{ ...S.td, fontWeight: 600, color: COLORS.text.primary }}>{h.label || h.symbol}</td>
                  <td style={S.td}>
                    <input style={{ ...S.input, width: 120, border: "none", background: "transparent", color: ASSET_CLASS_COLORS.cash, fontWeight: 600, fontSize: 12, padding: 0 }}
                      type="number" step="any" value={h.qty} onChange={e => updateCashAmount(h.id, parseFloat(e.target.value) || 0)} />
                  </td>
                  <td style={{ ...S.td, fontSize: 9, color: COLORS.text.dim }}>{h.notes || "—"}</td>
                  <td style={S.td}><button style={S.btnDanger} onClick={() => removeHolding(h.id)}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Closed Trades */}
      <div style={{ marginBottom: 24 }}>
        <div style={S.sectionTitle}><span>Closed Trades</span><div style={S.divider} /></div>
        <div style={S.card}>
          <table style={S.table}>
            <thead><tr>{["Asset", "Type", "Qty", "Entry", "Exit", "Open", "Close", "Realized P&L", "Return", "Notes", ""].map(c => <th key={c} style={S.th}>{c}</th>)}</tr></thead>
            <tbody>
              {closedTrades.length === 0 ? (
                <tr><td colSpan={11} style={{ ...S.td, textAlign: "center", color: COLORS.text.dim, padding: 24 }}>No closed trades yet.</td></tr>
              ) : closedTrades.map(t => (
                <tr key={t.id}>
                  <td style={{ ...S.td, fontWeight: 600, color: COLORS.text.primary }}>{t.label || t.symbol}</td>
                  <td style={S.td}><span style={S.badge(ASSET_CLASS_COLORS[t.assetClass || "market"])}>{(t.assetClass || "market").slice(0, 6)}</span></td>
                  <td style={S.td}>{t.qty}</td>
                  <td style={S.td}>{fmtPrice(t.costBasis)}</td>
                  <td style={S.td}>{fmtPrice(t.exitPrice)}</td>
                  <td style={{ ...S.td, fontSize: 10 }}>{t.openDate}</td>
                  <td style={{ ...S.td, fontSize: 10 }}>{t.closeDate}</td>
                  <td style={{ ...S.td, color: pnlColor(t.realizedPnl), fontWeight: 600 }}>{fmtPnl(t.realizedPnl)}</td>
                  <td style={{ ...S.td, color: pnlColor(t.pnlPct) }}>{fmtPnlPct(t.pnlPct)}</td>
                  <td style={{ ...S.td, fontSize: 9, color: COLORS.text.dim, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis" }}>{t.notes || "—"}</td>
                  <td style={S.td}><button style={S.btnDanger} onClick={() => deleteClosedTrade(t.id)}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modals */}
      {showAddModal && <AddAssetModal onAdd={addHolding} onCancel={() => setShowAddModal(false)} nextId={nextId} />}
      {updatingHolding && <UpdateValueModal holding={updatingHolding} onSave={(p) => updateManualPrice(updatingHolding.id, p)} onCancel={() => setUpdatingHolding(null)} />}
      {closingHolding && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setClosingHolding(null)}>
          <div style={{ background: COLORS.bg.secondary, border: `1px solid ${COLORS.border.secondary}`, borderRadius: 12, padding: 24, minWidth: 380, maxWidth: 440, fontFamily: FONTS.mono }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.text.primary, marginBottom: 16, fontFamily: FONTS.display }}>
              {closingHolding.assetClass === "collectible" ? "Sell" : "Close"}: {closingHolding.label || closingHolding.symbol}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Row label={`Qty (max ${closingHolding.qty})`}><input style={{ ...S.input, width: "100%" }} type="number" value={closeQty} onChange={e => setCloseQty(e.target.value)} step="any" /></Row>
              <Row label="Exit / Sale Price (per unit)"><input style={{ ...S.input, width: "100%" }} type="number" value={closePrice} onChange={e => setClosePrice(e.target.value)} step="any" /></Row>
              <Row label="Close Date"><input style={{ ...S.input, width: "100%" }} type="date" value={closeDate} onChange={e => setCloseDate(e.target.value)} /></Row>
              <Row label="Notes (optional)"><input style={{ ...S.input, width: "100%" }} value={closeNotes} onChange={e => setCloseNotes(e.target.value)} placeholder="Reason..." /></Row>
              {closePrice && (
                <div style={{ padding: 12, background: COLORS.bg.primary, borderRadius: 6, border: `1px solid ${COLORS.border.primary}` }}>
                  <div style={{ fontSize: 9, color: COLORS.text.dim, marginBottom: 6 }}>PREVIEW</div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                    <span style={{ color: COLORS.text.muted }}>Cost: {fmtPrice(closingHolding.costBasis)} × {closeQty || closingHolding.qty}</span>
                    <span style={{ color: COLORS.text.muted }}>Exit: {fmtPrice(parseFloat(closePrice))} × {closeQty || closingHolding.qty}</span>
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 700, marginTop: 8, color: pnlColor((parseFloat(closePrice) - closingHolding.costBasis) * (parseFloat(closeQty) || closingHolding.qty)) }}>
                    {fmtPnl((parseFloat(closePrice) - closingHolding.costBasis) * (parseFloat(closeQty) || closingHolding.qty))}
                  </div>
                </div>
              )}
              <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                <button style={{ ...S.btnPrimary, flex: 1, padding: "8px 16px" }} onClick={confirmCloseTrade}>Confirm</button>
                <button style={{ ...S.btn, padding: "8px 16px" }} onClick={() => setClosingHolding(null)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
