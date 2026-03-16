import React, { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "../lib/supabase";
import { COLORS, FONTS } from "../utils/constants";
import { S, pnlColor } from "../utils/styles";
import { fmtDollar, fmtPnl, fmtPnlPct, fmtPrice } from "../utils/format";

// ─── DATA FETCHING ──────────────────────────────────────────────────────────

async function fetchAccount() {
  const { data } = await supabase
    .from("rh_account_snapshots")
    .select("*")
    .order("timestamp", { ascending: false })
    .limit(1);
  return data?.[0] || null;
}

async function fetchStockPositions() {
  const { data } = await supabase
    .from("rh_stock_positions")
    .select("*")
    .gt("quantity", 0)
    .order("equity", { ascending: false });
  return data || [];
}

async function fetchOptionPositions() {
  const { data } = await supabase
    .from("rh_option_positions")
    .select("*")
    .gt("quantity", 0)
    .order("equity", { ascending: false });
  return data || [];
}

async function fetchStockOrders(limit = 50) {
  const { data } = await supabase
    .from("rh_stock_orders")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  return data || [];
}

async function fetchOptionOrders(limit = 50) {
  const { data } = await supabase
    .from("rh_option_orders")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  return data || [];
}

async function fetchAccountHistory(days = 30) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("rh_account_snapshots")
    .select("timestamp, equity")
    .gte("timestamp", since)
    .order("timestamp", { ascending: true });
  return data || [];
}

// ─── BADGE COMPONENT ────────────────────────────────────────────────────────

function Badge({ text, color }) {
  return <span style={S.badge(color)}>{text}</span>;
}

function StateBadge({ state }) {
  const colors = {
    filled: COLORS.positive.text,
    confirmed: COLORS.accent.blue,
    partially_filled: "#f59e0b",
    cancelled: COLORS.text.dim,
    pending: "#f59e0b",
    queued: COLORS.text.muted,
    failed: COLORS.negative.text,
    rejected: COLORS.negative.text,
  };
  return <Badge text={state} color={colors[state] || COLORS.text.dim} />;
}

function SideBadge({ side }) {
  return <Badge text={side} color={side === "buy" ? COLORS.positive.text : COLORS.negative.text} />;
}

function TypeBadge({ type }) {
  return <Badge text={type} color={type === "call" ? COLORS.positive.text : COLORS.negative.text} />;
}

// ─── SOURCE TAG ─────────────────────────────────────────────────────────────

function SourceTag() {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "2px 8px", borderRadius: 3, fontSize: 8,
      fontFamily: FONTS.mono, fontWeight: 600, letterSpacing: "0.5px",
      background: "#00c80518", color: "#00c805", border: "1px solid #00c80530",
      textTransform: "uppercase",
    }}>
      RH
    </span>
  );
}

// ─── MAIN COMPONENT ─────────────────────────────────────────────────────────

export default function Robinhood() {
  const [account, setAccount] = useState(null);
  const [stocks, setStocks] = useState([]);
  const [options, setOptions] = useState([]);
  const [stockOrders, setStockOrders] = useState([]);
  const [optionOrders, setOptionOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastSync, setLastSync] = useState(null);
  const [orderTab, setOrderTab] = useState("stocks");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [acc, stk, opt, sOrd, oOrd] = await Promise.all([
        fetchAccount(),
        fetchStockPositions(),
        fetchOptionPositions(),
        fetchStockOrders(),
        fetchOptionOrders(),
      ]);
      setAccount(acc);
      setStocks(stk);
      setOptions(opt);
      setStockOrders(sOrd);
      setOptionOrders(oOrd);
      if (acc?.timestamp) setLastSync(new Date(acc.timestamp).toLocaleString());
    } catch (err) {
      console.error("[Robinhood] fetch failed:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Summary
  const summary = useMemo(() => {
    const stockEquity = stocks.reduce((s, p) => s + (parseFloat(p.equity) || 0), 0);
    const stockPnl = stocks.reduce((s, p) => s + (parseFloat(p.unrealized_pnl) || 0), 0);
    const optionEquity = options.reduce((s, p) => s + (parseFloat(p.equity) || 0), 0);
    const optionPnl = options.reduce((s, p) => s + (parseFloat(p.unrealized_pnl) || 0), 0);
    const equity = account ? parseFloat(account.equity) : stockEquity + optionEquity;
    const cash = account ? parseFloat(account.cash) : 0;
    const buyingPower = account ? parseFloat(account.buying_power) : 0;
    return { equity, cash, buyingPower, stockEquity, stockPnl, optionEquity, optionPnl, totalPnl: stockPnl + optionPnl };
  }, [account, stocks, options]);

  if (loading && !account) {
    return (
      <div style={{ ...S.container, display: "flex", alignItems: "center", justifyContent: "center", height: "60vh" }}>
        <div style={{ color: COLORS.text.dim, fontSize: 12 }}>Loading Robinhood data...</div>
      </div>
    );
  }

  if (!account && stocks.length === 0) {
    return (
      <div style={{ ...S.container, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "60vh", gap: 12 }}>
        <div style={{ fontSize: 13, color: COLORS.text.secondary }}>No Robinhood data yet</div>
        <div style={{ fontSize: 10, color: COLORS.text.dim, maxWidth: 400, textAlign: "center", lineHeight: 1.6 }}>
          Set up the robinhood_sync service to start pulling data. See robinhood_sync/README for setup instructions.
        </div>
      </div>
    );
  }

  return (
    <div style={S.container}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 16, fontFamily: FONTS.ui, fontWeight: 700, letterSpacing: "-0.3px" }}>
            Robinhood <SourceTag />
          </h2>
          {lastSync && <div style={{ fontSize: 9, color: COLORS.text.dim, marginTop: 3 }}>Last sync: {lastSync}</div>}
        </div>
        <button style={S.btnPrimary} onClick={refresh}>↻ Refresh</button>
      </div>

      {/* Summary Cards */}
      <div style={S.summaryRow}>
        {[
          { label: "Account Equity", value: fmtDollar(summary.equity), color: COLORS.text.primary },
          { label: "Cash", value: fmtDollar(summary.cash), color: COLORS.text.primary },
          { label: "Buying Power", value: fmtDollar(summary.buyingPower), color: COLORS.text.primary },
          { label: "Stock Equity", value: fmtDollar(summary.stockEquity), color: COLORS.text.primary },
          { label: "Option Equity", value: fmtDollar(summary.optionEquity), color: COLORS.text.primary },
          { label: "Unrealized P&L", value: fmtPnl(summary.totalPnl), color: pnlColor(summary.totalPnl) },
        ].map((c, i) => (
          <div key={i} style={{ ...S.summaryCard, ...(i === 0 ? { borderLeft: `3px solid #00c805` } : {}) }}>
            <div style={S.cardLabel}>{c.label}</div>
            <div style={{ ...S.cardValue, color: c.color }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Stock Positions */}
      <div style={{ marginBottom: 24 }}>
        <div style={S.sectionTitle}>
          <span>Stock Positions</span><div style={S.divider} />
          <span style={{ fontSize: 10, color: COLORS.text.muted }}>{fmtDollar(summary.stockEquity)}</span>
        </div>
        <div style={S.card}>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>Symbol</th>
                <th style={S.thRight}>Qty</th>
                <th style={S.thRight}>Avg Cost</th>
                <th style={S.thRight}>Price</th>
                <th style={S.thRight}>Equity</th>
                <th style={S.thRight}>P&L</th>
                <th style={S.thRight}>P&L %</th>
              </tr>
            </thead>
            <tbody>
              {stocks.length === 0 ? (
                <tr><td colSpan={7} style={{ ...S.td, textAlign: "center", color: COLORS.text.dim, padding: 20 }}>No stock positions</td></tr>
              ) : stocks.map((p) => (
                <tr key={p.symbol}>
                  <td style={{ ...S.td, fontWeight: 600, color: COLORS.text.primary }}>
                    {p.symbol}
                    {p.name && <span style={{ fontSize: 9, color: COLORS.text.dim, marginLeft: 6 }}>{p.name}</span>}
                  </td>
                  <td style={S.tdRight}>{parseFloat(p.quantity).toFixed(2)}</td>
                  <td style={S.tdRight}>{fmtPrice(parseFloat(p.average_cost))}</td>
                  <td style={S.tdRight}>{fmtPrice(parseFloat(p.current_price))}</td>
                  <td style={S.tdRight}>{fmtDollar(parseFloat(p.equity))}</td>
                  <td style={{ ...S.tdRight, color: pnlColor(parseFloat(p.unrealized_pnl)) }}>
                    {fmtPnl(parseFloat(p.unrealized_pnl))}
                  </td>
                  <td style={{ ...S.tdRight, color: pnlColor(parseFloat(p.pnl_pct)) }}>
                    {fmtPnlPct(parseFloat(p.pnl_pct))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {stocks.length > 0 && (
            <div style={S.subtotalRow}>
              <span>{stocks.length} positions</span>
              <span>
                <span style={{ color: COLORS.text.dim, marginRight: 16 }}>P&L:</span>
                <span style={{ color: pnlColor(summary.stockPnl) }}>{fmtPnl(summary.stockPnl)}</span>
                <span style={{ color: COLORS.text.dim, marginLeft: 16, marginRight: 16 }}>Value:</span>
                <span style={{ color: COLORS.text.primary }}>{fmtDollar(summary.stockEquity)}</span>
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Option Positions */}
      <div style={{ marginBottom: 24 }}>
        <div style={S.sectionTitle}>
          <span>Option Positions</span><div style={S.divider} />
          <span style={{ fontSize: 10, color: COLORS.text.muted }}>{fmtDollar(summary.optionEquity)}</span>
        </div>
        <div style={S.card}>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>Contract</th>
                <th style={S.th}>Type</th>
                <th style={S.thRight}>Qty</th>
                <th style={S.thRight}>Strike</th>
                <th style={S.thRight}>Expiry</th>
                <th style={S.thRight}>Mark</th>
                <th style={S.thRight}>Equity</th>
                <th style={S.thRight}>P&L</th>
                <th style={S.thRight}>δ</th>
                <th style={S.thRight}>θ</th>
                <th style={S.thRight}>IV</th>
              </tr>
            </thead>
            <tbody>
              {options.length === 0 ? (
                <tr><td colSpan={11} style={{ ...S.td, textAlign: "center", color: COLORS.text.dim, padding: 20 }}>No option positions</td></tr>
              ) : options.map((p, i) => (
                <tr key={i}>
                  <td style={{ ...S.td, fontWeight: 600, color: COLORS.text.primary }}>{p.chain_symbol}</td>
                  <td style={S.td}><TypeBadge type={p.option_type} /></td>
                  <td style={S.tdRight}>{parseFloat(p.quantity).toFixed(0)}</td>
                  <td style={S.tdRight}>{fmtPrice(parseFloat(p.strike_price))}</td>
                  <td style={{ ...S.tdRight, fontSize: 10 }}>{p.expiration_date}</td>
                  <td style={S.tdRight}>{fmtPrice(parseFloat(p.mark_price))}</td>
                  <td style={S.tdRight}>{fmtDollar(parseFloat(p.equity))}</td>
                  <td style={{ ...S.tdRight, color: pnlColor(parseFloat(p.unrealized_pnl)) }}>
                    {fmtPnl(parseFloat(p.unrealized_pnl))}
                  </td>
                  <td style={{ ...S.tdRight, color: COLORS.text.dim }}>{p.delta ? parseFloat(p.delta).toFixed(3) : "—"}</td>
                  <td style={{ ...S.tdRight, color: COLORS.text.dim }}>{p.theta ? parseFloat(p.theta).toFixed(3) : "—"}</td>
                  <td style={{ ...S.tdRight, color: COLORS.text.dim }}>{p.implied_volatility ? (parseFloat(p.implied_volatility) * 100).toFixed(1) + "%" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {options.length > 0 && (
            <div style={S.subtotalRow}>
              <span>{options.length} contracts</span>
              <span>
                <span style={{ color: COLORS.text.dim, marginRight: 16 }}>P&L:</span>
                <span style={{ color: pnlColor(summary.optionPnl) }}>{fmtPnl(summary.optionPnl)}</span>
                <span style={{ color: COLORS.text.dim, marginLeft: 16, marginRight: 16 }}>Value:</span>
                <span style={{ color: COLORS.text.primary }}>{fmtDollar(summary.optionEquity)}</span>
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Order History */}
      <div style={{ marginBottom: 24 }}>
        <div style={S.sectionTitle}>
          <span>Order History</span><div style={S.divider} />
          <div style={{ display: "flex", gap: 2 }}>
            {["stocks", "options"].map(t => (
              <button key={t} onClick={() => setOrderTab(t)} style={{
                ...S.btn, padding: "3px 10px", fontSize: 9, textTransform: "capitalize",
                ...(orderTab === t ? { background: COLORS.accent.blueBg, borderColor: COLORS.accent.blueBorder, color: COLORS.accent.blue } : {}),
              }}>{t}</button>
            ))}
          </div>
        </div>
        <div style={S.card}>
          {orderTab === "stocks" ? (
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>Date</th>
                  <th style={S.th}>Symbol</th>
                  <th style={S.th}>Side</th>
                  <th style={S.th}>Type</th>
                  <th style={S.thRight}>Qty</th>
                  <th style={S.thRight}>Price</th>
                  <th style={S.thRight}>Filled</th>
                  <th style={S.th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {stockOrders.length === 0 ? (
                  <tr><td colSpan={8} style={{ ...S.td, textAlign: "center", color: COLORS.text.dim, padding: 20 }}>No stock orders</td></tr>
                ) : stockOrders.map((o) => (
                  <tr key={o.id}>
                    <td style={{ ...S.td, fontSize: 10 }}>{new Date(o.created_at).toLocaleDateString()}</td>
                    <td style={{ ...S.td, fontWeight: 600, color: COLORS.text.primary }}>{o.symbol}</td>
                    <td style={S.td}><SideBadge side={o.side} /></td>
                    <td style={{ ...S.td, color: COLORS.text.dim }}>{o.order_type}</td>
                    <td style={S.tdRight}>{parseFloat(o.quantity).toFixed(2)}</td>
                    <td style={S.tdRight}>{o.price ? fmtPrice(parseFloat(o.price)) : "—"}</td>
                    <td style={S.tdRight}>{o.executed_price ? fmtPrice(parseFloat(o.executed_price)) : "—"}</td>
                    <td style={S.td}><StateBadge state={o.state} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>Date</th>
                  <th style={S.th}>Symbol</th>
                  <th style={S.th}>Contract</th>
                  <th style={S.th}>Side</th>
                  <th style={S.thRight}>Qty</th>
                  <th style={S.thRight}>Price</th>
                  <th style={S.thRight}>Filled</th>
                  <th style={S.th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {optionOrders.length === 0 ? (
                  <tr><td colSpan={8} style={{ ...S.td, textAlign: "center", color: COLORS.text.dim, padding: 20 }}>No option orders</td></tr>
                ) : optionOrders.map((o) => (
                  <tr key={o.id}>
                    <td style={{ ...S.td, fontSize: 10 }}>{new Date(o.created_at).toLocaleDateString()}</td>
                    <td style={{ ...S.td, fontWeight: 600, color: COLORS.text.primary }}>{o.chain_symbol}</td>
                    <td style={{ ...S.td, fontSize: 10 }}>
                      {o.strike_price && o.option_type && o.expiration_date
                        ? `$${parseFloat(o.strike_price).toFixed(0)} ${o.option_type?.toUpperCase()} ${o.expiration_date}`
                        : "—"}
                    </td>
                    <td style={S.td}><SideBadge side={o.side} /></td>
                    <td style={S.tdRight}>{parseFloat(o.quantity).toFixed(0)}</td>
                    <td style={S.tdRight}>{o.price ? fmtPrice(parseFloat(o.price)) : "—"}</td>
                    <td style={S.tdRight}>{o.executed_price ? fmtPrice(parseFloat(o.executed_price)) : "—"}</td>
                    <td style={S.td}><StateBadge state={o.state} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
