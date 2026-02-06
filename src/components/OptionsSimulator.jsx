import { useState, useMemo, useCallback, useEffect } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart, ReferenceLine, Legend, ComposedChart } from "recharts";

// ─── BLACK-SCHOLES ENGINE (with dividend yield) ─────────────────────────────
const normalCDF = (x) => {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1.0 + sign * y);
};
const normalPDF = (x) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

const blackScholes = (S, K, T, r, sigma, type = "call", q = 0) => {
  const empty = { price: 0, delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0 };
  if (!isFinite(S) || !isFinite(K) || !isFinite(T) || !isFinite(r) || !isFinite(sigma) || !isFinite(q)) return empty;
  if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) return { ...empty, price: Math.max(0, type === "call" ? S - K : K - S) };
  const sqrtT = Math.sqrt(T);
  const eqT = Math.exp(-q * T);
  const erT = Math.exp(-r * T);
  const d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  if (!isFinite(d1) || !isFinite(d2)) return empty;
  let price, delta;
  if (type === "call") {
    price = S * eqT * normalCDF(d1) - K * erT * normalCDF(d2);
    delta = eqT * normalCDF(d1);
  } else {
    price = K * erT * normalCDF(-d2) - S * eqT * normalCDF(-d1);
    delta = -eqT * normalCDF(-d1);
  }
  const gamma = eqT * normalPDF(d1) / (S * sigma * sqrtT);
  const theta_call = (-S * eqT * normalPDF(d1) * sigma / (2 * sqrtT) + q * S * eqT * normalCDF(d1) - r * K * erT * normalCDF(d2)) / 365;
  const theta_put = (-S * eqT * normalPDF(d1) * sigma / (2 * sqrtT) - q * S * eqT * normalCDF(-d1) + r * K * erT * normalCDF(-d2)) / 365;
  const theta = type === "call" ? theta_call : theta_put;
  const vega = S * eqT * normalPDF(d1) * sqrtT / 100;
  const rho_call = K * T * erT * normalCDF(d2) / 100;
  const rho_put = -K * T * erT * normalCDF(-d2) / 100;
  const rho = type === "call" ? rho_call : rho_put;
  return { price, delta, gamma, theta, vega, rho };
};

const impliedVol = (marketPrice, S, K, T, r, type = "call", q = 0, initialGuess = 0.3) => {
  if (!isFinite(marketPrice) || !isFinite(S) || !isFinite(K) || !isFinite(T) || !isFinite(r)) return initialGuess;
  if (marketPrice <= 0 || S <= 0 || K <= 0 || T <= 0) return initialGuess;

  // Newton-Raphson with smarter starting point
  let sigma = Math.max(0.01, Math.min(initialGuess, 5));
  let bestSigma = sigma, bestErr = Infinity;

  for (let i = 0; i < 100; i++) {
    const bs = blackScholes(S, K, T, r, sigma, type, q);
    const diff = bs.price - marketPrice;
    const err = Math.abs(diff);
    if (err < bestErr) { bestErr = err; bestSigma = sigma; }
    if (err < 0.0001) return sigma;
    const vegaVal = bs.vega * 100;
    if (vegaVal < 0.00001) break;
    sigma -= diff / vegaVal;
    sigma = Math.max(0.01, Math.min(sigma, 5));
  }
  if (bestErr < 0.01) return bestSigma;

  // Bisection fallback for deep OTM / convergence failures
  let lo = 0.01, hi = 5.0;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    const bs = blackScholes(S, K, T, r, mid, type, q);
    const diff = bs.price - marketPrice;
    if (Math.abs(diff) < 0.0001) return mid;
    if (diff > 0) hi = mid; else lo = mid;
    if (hi - lo < 0.0001) return mid;
  }
  return (lo + hi) / 2;
};

// ─── SAFE INPUT HOOKS (L-001) ───────────────────────────────────────────────
function useNumInput(initial, fallback = 0) {
  const [raw, setRaw] = useState(String(initial));
  const parsed = raw === "" || raw === "-" || raw === "." ? fallback : Number(raw);
  const value = isFinite(parsed) ? parsed : fallback;
  const onChange = useCallback((e) => setRaw(e.target.value), []);
  const set = useCallback((v) => setRaw(String(v)), []);
  return { raw, value, onChange, set };
}
function useOptNumInput(initial = null) {
  const [raw, setRaw] = useState(initial != null ? String(initial) : "");
  const parsed = raw === "" ? null : Number(raw);
  const value = parsed != null && isFinite(parsed) ? parsed : null;
  const onChange = useCallback((e) => setRaw(e.target.value), []);
  const set = useCallback((v) => setRaw(v != null ? String(v) : ""), []);
  return { raw, value, onChange, set };
}

// ─── FORMATTING ─────────────────────────────────────────────────────────────
const fmt = (n, d = 2) => n != null && isFinite(n) ? Number(n).toFixed(d) : "—";
const fmtPct = (n) => n != null && isFinite(n) ? (n * 100).toFixed(1) + "%" : "—";
const addCommas = (s) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const fmtDollar = (n) => {
  if (n == null || !isFinite(n)) return "—";
  const abs = Math.abs(n);
  const str = abs < 0.01 && abs > 0 ? abs.toFixed(4) : abs.toFixed(2);
  return (n < 0 ? "-$" : "$") + addCommas(str);
};
const fmtPnl = (n) => {
  if (n == null || !isFinite(n)) return "—";
  return (n >= 0 ? "+" : "-") + "$" + addCommas(Math.abs(n).toFixed(2));
};
const fmtPnlPct = (n) => {
  if (n == null || !isFinite(n)) return "—";
  return (n >= 0 ? "+" : "") + (n * 100).toFixed(1) + "%";
};

function NumInput({ label, input, step, min, max, placeholder, style }) {
  return (
    <div className="input-group" style={style}>
      <span className="input-label">{label}</span>
      <input type="number" value={input.raw} onChange={input.onChange} step={step} min={min} max={max} placeholder={placeholder} />
    </div>
  );
}

// ─── STRATEGY PRESETS ───────────────────────────────────────────────────────
const PRESETS = {
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

// ─── MAIN APP ───────────────────────────────────────────────────────────────
export default function OptionsSimulator({ livePrice = null, livePriceSymbol = null }) {
  const [activeTab, setActiveTab] = useState("scenario");
  const [showMarketGreeks, setShowMarketGreeks] = useState(false);

  // Core inputs
  const stockPrice = useNumInput(50, 1);
  const strikePrice = useNumInput(30, 1);
  const [optionType, setOptionType] = useState("call");
  const currentOptionPrice = useNumInput(22, 1);
  const riskFreeRate = useNumInput(0.045, 0.045);
  const dividendYield = useNumInput(0, 0);
  const [expirationDate, setExpirationDate] = useState("2028-06-16");
  const [entryDate, setEntryDate] = useState("");  // date of expected entry (drop)
  const expectedDrop = useNumInput(50, 0);
  const investmentAmount = useNumInput(50000, 1000);  // dollar amount to invest
  const ivOverride = useOptNumInput(null);
  const targetEntryOptionPrice = useOptNumInput(null);
  const reboundTarget = useOptNumInput(null);

  // P&L Explorer - evaluation date (days from now)
  const [evalDays, setEvalDays] = useState(0);

  // Market Greeks
  const mktDelta = useOptNumInput(null);
  const mktGamma = useOptNumInput(null);
  const mktTheta = useOptNumInput(null);
  const mktVega = useOptNumInput(null);
  const mktRho = useOptNumInput(null);
  const mktIV = useOptNumInput(null);

  // Multi-leg strategy
  const [legs, setLegs] = useState([]);
  const [nextLegId, setNextLegId] = useState(1);
  const [selectedPreset, setSelectedPreset] = useState("custom");

  // Save/Load
  const [savedScenarios, setSavedScenarios] = useState([]);
  const [scenarioName, setScenarioName] = useState("");
  const [saveStatus, setSaveStatus] = useState("");

  // ─── COMPARE TAB STATE ──────────────────────────────────────────────────
  const [compareContracts, setCompareContracts] = useState([
    { id: 1, label: "LEAP $300", type: "call", strike: 300, expiration: "2028-06-16", premium: 0, iv: 0, color: "#3b82f6" },
    { id: 2, label: "LEAP $500", type: "call", strike: 500, expiration: "2028-06-16", premium: 0, iv: 0, color: "#8b5cf6" },
    { id: 3, label: "LEAP $900", type: "call", strike: 900, expiration: "2028-06-16", premium: 0, iv: 0, color: "#22c55e" },
  ]);
  const [compareNextId, setCompareNextId] = useState(4);
  const [compareTargetPrice, setCompareTargetPrice] = useState(null);
  const [compareEvalDays, setCompareEvalDays] = useState(180);
  const [compareInvestment, setCompareInvestment] = useState(50000);
  const COMPARE_COLORS = ["#3b82f6", "#8b5cf6", "#22c55e", "#f59e0b", "#ef4444", "#06b6d4", "#ec4899", "#84cc16"];

  // ─── ROLL PLANNER STATE ──────────────────────────────────────────────────
  const [compareMode, setCompareMode] = useState("compare"); // "compare" | "roll" | "optimizer"
  const [rollInvestment, setRollInvestment] = useState(50000);
  const [rollTargetPrice, setRollTargetPrice] = useState(null);
  const [rollLegs, setRollLegs] = useState([
    { id: 1, label: "Leg 1 (Current LEAP)", type: "call", strike: 300, expiration: "2027-10-17", premium: 0, iv: 0, rollAfterDays: 365, stockAtRoll: 0 },
    { id: 2, label: "Leg 2 (Roll Into)", type: "call", strike: 300, expiration: "2028-12-15", premium: 0, iv: 0, rollAfterDays: 0, stockAtRoll: 0 },
  ]);
  const [rollNextId, setRollNextId] = useState(3);
  // Stock price path assumption: "linear" (interpolate to target) or "custom" per-roll-point
  const [rollPathMode, setRollPathMode] = useState("linear");
  // IV scenario for rolls: percentage change assumption
  const [rollIVShift, setRollIVShift] = useState(0);
  // Roll friction: bid-ask slippage % per roll
  const [rollSlippage, setRollSlippage] = useState(2);

  // ─── ROLL OPTIMIZER STATE ──────────────────────────────────────────────────
  // Current position
  const [optStrike, setOptStrike] = useState(300);
  const [optType, setOptType] = useState("call");
  const [optExpiry, setOptExpiry] = useState("2027-10-17");
  const [optEntryPrice, setOptEntryPrice] = useState(0); // 0 = auto from BS
  const [optIV, setOptIV] = useState(0); // 0 = use main IV
  const [optInvestment, setOptInvestment] = useState(50000);
  // Roll-into option parameters
  const [rollIntoStrike, setRollIntoStrike] = useState(300);
  const [rollIntoExpiry, setRollIntoExpiry] = useState("2028-12-15");
  const [rollIntoIV, setRollIntoIV] = useState(0);
  // Stock trajectory assumptions
  const [optPeakPrice, setOptPeakPrice] = useState(200); // stock peaks at this price
  const [optPeakDay, setOptPeakDay] = useState(400); // peak happens around this day
  const [optFinalPrice, setOptFinalPrice] = useState(200); // stock at original expiry
  const [optRollSlippage, setOptRollSlippage] = useState(2);

  // ─── LIVE PRICE SYNC ──────────────────────────────────────────────────────
  useEffect(() => {
    if (livePrice != null && livePrice > 0) {
      stockPrice.set(livePrice);
    }
  }, [livePrice]);

  // Load saved scenarios on mount
  useEffect(() => {
    try {
      const keys = Object.keys(localStorage).filter(k => k.startsWith("optlab:"));
      const names = keys.map(k => k.replace("optlab:", ""));
      setSavedScenarios(names);
    } catch { /* storage not available */ }
  }, []);

  const saveScenario = () => {
    if (!scenarioName.trim()) return;
    const key = "optlab:" + scenarioName.trim();
    const data = {
      stockPrice: stockPrice.value, strikePrice: strikePrice.value, optionType,
      currentOptionPrice: currentOptionPrice.value, riskFreeRate: riskFreeRate.value,
      dividendYield: dividendYield.value, expirationDate, entryDate, expectedDrop: expectedDrop.value,
      investmentAmount: investmentAmount.value, ivOverride: ivOverride.value,
      targetEntryOptionPrice: targetEntryOptionPrice.value, reboundTarget: reboundTarget.value,
      legs,
    };
    try {
      localStorage.setItem(key, JSON.stringify(data));
      setSaveStatus("Saved!");
      if (!savedScenarios.includes(scenarioName.trim())) {
        setSavedScenarios(prev => [...prev, scenarioName.trim()]);
      }
      setTimeout(() => setSaveStatus(""), 2000);
    } catch { setSaveStatus("Save failed"); setTimeout(() => setSaveStatus(""), 2000); }
  };

  const loadScenario = (name) => {
    try {
      const raw = localStorage.getItem("optlab:" + name);
      if (raw) {
        const d = JSON.parse(raw);
        stockPrice.set(d.stockPrice); strikePrice.set(d.strikePrice);
        setOptionType(d.optionType || "call");
        currentOptionPrice.set(d.currentOptionPrice); riskFreeRate.set(d.riskFreeRate);
        dividendYield.set(d.dividendYield || 0); setExpirationDate(d.expirationDate);
        if (d.entryDate) setEntryDate(d.entryDate);
        expectedDrop.set(d.expectedDrop);
        if (d.investmentAmount) investmentAmount.set(d.investmentAmount);
        else if (d.contracts) investmentAmount.set(d.contracts * 1000);
        ivOverride.set(d.ivOverride); targetEntryOptionPrice.set(d.targetEntryOptionPrice);
        reboundTarget.set(d.reboundTarget);
        if (d.legs) { setLegs(d.legs); setNextLegId(Math.max(...d.legs.map(l => l.id), 0) + 1); }
        setSaveStatus("Loaded!");
        setTimeout(() => setSaveStatus(""), 2000);
      }
    } catch { setSaveStatus("Load failed"); setTimeout(() => setSaveStatus(""), 2000); }
  };

  const deleteScenario = (name) => {
    try {
      localStorage.removeItem("optlab:" + name);
      setSavedScenarios(prev => prev.filter(n => n !== name));
    } catch {}
  };

  // Strategy leg management
  const addLeg = () => {
    setLegs(prev => [...prev, { id: nextLegId, type: "call", dir: "long", strike: strikePrice.value, premium: 0, qty: 1 }]);
    setNextLegId(prev => prev + 1);
    setSelectedPreset("custom");
  };
  const removeLeg = (id) => { setLegs(prev => prev.filter(l => l.id !== id)); setSelectedPreset("custom"); };
  const updateLeg = (id, field, val) => {
    setLegs(prev => prev.map(l => l.id === id ? { ...l, [field]: val } : l));
    setSelectedPreset("custom");
  };
  const applyPreset = (key) => {
    setSelectedPreset(key);
    if (key === "custom") return;
    const preset = PRESETS[key];
    if (preset && preset.build) {
      const newLegs = preset.build(stockPrice.value, strikePrice.value);
      setLegs(newLegs);
      setNextLegId(Math.max(...newLegs.map(l => l.id), 0) + 1);
    }
  };

  // ─── SINGLE-LEG CALCULATIONS ──────────────────────────────────────────────
  const calculations = useMemo(() => {
    const S = stockPrice.value;
    const K = strikePrice.value;
    const optPx = currentOptionPrice.value;
    const r = riskFreeRate.value;
    const q = dividendYield.value;
    const drop = expectedDrop.value;
    const investment = investmentAmount.value;

    const now = new Date();
    const exp = new Date(expirationDate);
    const T = Math.max((exp - now) / (365.25 * 24 * 60 * 60 * 1000), 0.001);

    // Entry date: if set, calculate T_entry (time from entry to expiry)
    const entryDateObj = entryDate ? new Date(entryDate) : null;
    const daysToEntry = entryDateObj ? Math.max((entryDateObj - now) / (24 * 60 * 60 * 1000), 0) : 0;
    const T_entry = entryDateObj ? Math.max((exp - entryDateObj) / (365.25 * 24 * 60 * 60 * 1000), 0.001) : T;

    const currentIV = mktIV.value != null ? mktIV.value / 100 : impliedVol(optPx, S, K, T, r, optionType, q);
    const activeIV = ivOverride.value != null ? ivOverride.value / 100 : currentIV;

    const bsCurrent = blackScholes(S, K, T, r, activeIV, optionType, q);
    const current = {
      price: bsCurrent.price,
      delta: mktDelta.value != null ? mktDelta.value : bsCurrent.delta,
      gamma: mktGamma.value != null ? mktGamma.value : bsCurrent.gamma,
      theta: mktTheta.value != null ? mktTheta.value : bsCurrent.theta,
      vega: mktVega.value != null ? mktVega.value : bsCurrent.vega,
      rho: mktRho.value != null ? mktRho.value : bsCurrent.rho,
    };
    const greekOverrides = {
      delta: mktDelta.value != null, gamma: mktGamma.value != null,
      theta: mktTheta.value != null, vega: mktVega.value != null,
      rho: mktRho.value != null, iv: mktIV.value != null,
    };

    const droppedPrice = S * (1 - drop / 100);
    // Entry option price uses T_entry (time remaining from entry date to expiry)
    const droppedBSFlat = blackScholes(droppedPrice, K, T_entry, r, activeIV, optionType, q);

    const entryOptionPrice = targetEntryOptionPrice.value || droppedBSFlat.price;
    // Derive number of contracts from investment amount
    const costPerContract = entryOptionPrice * 100;  // 100 shares per contract
    const numContracts = costPerContract > 0 ? Math.max(1, Math.floor(investment / costPerContract)) : 1;
    const principal = numContracts * costPerContract;  // actual capital deployed
    const unusedCash = investment - principal;
    // If no manual entry price override, the IV is just activeIV (no round-trip needed)
    // Only solve for IV when user provides a custom entry price
    const entryIV = targetEntryOptionPrice.value
      ? impliedVol(entryOptionPrice, droppedPrice, K, T_entry, r, optionType, q, activeIV)
      : activeIV;
    const entryGreeks = blackScholes(droppedPrice, K, T_entry, r, entryIV, optionType, q);
    const targetReb = reboundTarget.value || S;

    const scenarios = [];
    const steps = 20;
    const minRebound = Math.max(droppedPrice * 0.5, 0.01);
    const maxRebound = Math.max(S * 3, K * 2, 500);
    const stepSize = steps > 0 ? (maxRebound - minRebound) / steps : 1;

    for (let i = 0; i <= steps; i++) {
      const rsp = minRebound + stepSize * i;
      const row = { stockPrice: rsp };
      [0, 0.25, 0.5, 1.0].forEach((dt) => {
        const remT = Math.max(T_entry - dt, 0.001);
        const ivAdj = rsp > 0 ? activeIV * (1 + 0.1 * (droppedPrice / rsp - 1)) : activeIV;
        const sIV = Math.max(0.1, Math.min(ivAdj, 2));
        const bs = blackScholes(rsp, K, remT, r, sIV, optionType, q);
        row[`price_${dt}`] = bs.price;
        row[`pnl_${dt}`] = (bs.price - entryOptionPrice) * 100;
        row[`pnlPct_${dt}`] = entryOptionPrice > 0 ? (bs.price - entryOptionPrice) / entryOptionPrice : 0;
        row[`delta_${dt}`] = bs.delta;
      });
      scenarios.push(row);
    }

    const pnlStep = Math.max(stepSize / 2, 0.01);
    const pnlData = [];
    for (let p = minRebound; p <= maxRebound; p += pnlStep) {
      pnlData.push({
        stock: p,
        now: (blackScholes(p, K, T_entry, r, activeIV, optionType, q).price - entryOptionPrice) * 100 * numContracts,
        sixMonths: (blackScholes(p, K, Math.max(T_entry - 0.5, 0.001), r, activeIV, optionType, q).price - entryOptionPrice) * 100 * numContracts,
        oneYear: (blackScholes(p, K, Math.max(T_entry - 1, 0.001), r, activeIV, optionType, q).price - entryOptionPrice) * 100 * numContracts,
        expiration: (blackScholes(p, K, 0.001, r, activeIV, optionType, q).price - entryOptionPrice) * 100 * numContracts,
      });
    }

    const greeksData = [];
    for (let p = minRebound; p <= maxRebound; p += pnlStep) {
      const bs = blackScholes(p, K, T_entry, r, activeIV, optionType, q);
      greeksData.push({ stock: p, delta: bs.delta, gamma: bs.gamma, theta: bs.theta, vega: bs.vega });
    }

    // IV Sensitivity Matrix
    const ivSteps = [-20, -15, -10, -5, 0, 5, 10, 15, 20];
    const priceSteps = [];
    for (let pct = -30; pct <= 30; pct += 5) priceSteps.push(pct);
    const ivMatrix = priceSteps.map(pricePct => {
      const simS = S * (1 + pricePct / 100);
      const row = { stockPrice: simS, pricePct };
      ivSteps.forEach(ivDelta => {
        const simIV = Math.max(0.05, activeIV * (1 + ivDelta / 100));
        const bs = blackScholes(simS, K, T, r, simIV, optionType, q);
        const pnl = (bs.price - optPx) * 100;
        row[`iv_${ivDelta}`] = bs.price;
        row[`pnl_${ivDelta}`] = pnl;
      });
      return row;
    });

    // P&L Explorer: calc at specific (price, date) point
    // evalDays is days from ENTRY date (not from now)
    const entryTotalDays = Math.round(T_entry * 365);
    const totalDays = Math.round(T * 365);
    const clampedEvalDays = Math.min(Math.max(evalDays, 0), entryTotalDays);
    const evalT = Math.max(T_entry - clampedEvalDays / 365, 0.001);
    const targetRebPrice = reboundTarget.value || S;
    const evalBS = blackScholes(targetRebPrice, K, evalT, r, activeIV, optionType, q);
    const evalPnl = (evalBS.price - entryOptionPrice) * 100 * numContracts;
    const evalPnlPct = entryOptionPrice > 0 ? (evalBS.price - entryOptionPrice) / entryOptionPrice : 0;

    // Eval date as readable string (from entry date forward)
    const entryMs = entryDateObj ? entryDateObj.getTime() : now.getTime();
    const evalDateObj2 = new Date(entryMs + clampedEvalDays * 24 * 60 * 60 * 1000);
    const evalDateStr = evalDateObj2.toISOString().split("T")[0];
    const entryDateStr = entryDateObj ? entryDate : new Date().toISOString().split("T")[0];

    // Price × Time P&L heatmap surface (expanded range)
    const surfacePriceSteps = [];
    const sliderMax = Math.max(S * 20, K * 6, 2000);
    const surfLow = Math.max(1, Math.round(droppedPrice * 0.3));
    const surfHigh = Math.min(sliderMax, Math.max(S * 4, K * 3, 1000));
    const surfPriceStep = (surfHigh - surfLow) / 14;
    for (let p = surfLow; p <= surfHigh + 0.01; p += surfPriceStep) surfacePriceSteps.push(Math.round(p));

    const surfaceTimeSteps = [];
    const timeStepDays = Math.max(Math.round(entryTotalDays / 8), 1);
    for (let d = 0; d <= entryTotalDays; d += timeStepDays) surfaceTimeSteps.push(d);
    if (surfaceTimeSteps[surfaceTimeSteps.length - 1] < entryTotalDays) surfaceTimeSteps.push(entryTotalDays);

    const pnlSurface = surfacePriceSteps.map(p => {
      const row = { stockPrice: p, pricePct: ((p / S - 1) * 100) };
      surfaceTimeSteps.forEach(d => {
        const remT = Math.max(T_entry - d / 365, 0.001);
        const bs = blackScholes(p, K, remT, r, activeIV, optionType, q);
        row[`pnl_${d}`] = (bs.price - entryOptionPrice) * 100 * numContracts;
        row[`opt_${d}`] = bs.price;
      });
      return row;
    });

    // ─── TIMELINE CHART DATA ────────────────────────────────────────────────
    // Shows option value journey: Today → Entry Date → Recovery → Expiry
    const timelinePoints = 60;
    const totalCalendarDays = totalDays;
    const tStep = Math.max(Math.round(totalCalendarDays / timelinePoints), 1);
    const timelineData = [];

    // Recovery scenarios: what stock price paths look like after entry
    const recoveryTargets = [
      { label: "stock_flat", price: droppedPrice },
      { label: "stock_50pct", price: droppedPrice + (S - droppedPrice) * 0.5 },
      { label: "stock_full", price: S },
      { label: "stock_target", price: targetRebPrice },
    ];

    for (let d = 0; d <= totalCalendarDays; d += tStep) {
      const dayDate = new Date(now.getTime() + d * 24 * 60 * 60 * 1000);
      const remT = Math.max(T - d / 365, 0.001);
      const dateStr = dayDate.toISOString().split("T")[0];
      const isBeforeEntry = d < daysToEntry;
      const entryFrac = daysToEntry > 0 ? Math.min(d / daysToEntry, 1) : 1;

      // Before entry: stock drifts from S toward droppedPrice
      const preEntryStock = isBeforeEntry ? S - (S - droppedPrice) * entryFrac : droppedPrice;
      const preEntryOpt = blackScholes(preEntryStock, K, remT, r, activeIV, optionType, q).price;

      const row = { day: d, date: dateStr };

      if (isBeforeEntry) {
        // Pre-entry: show current option declining as stock drops
        row.preEntry = preEntryOpt;
      } else {
        // Post-entry: show different recovery scenarios
        const daysSinceEntry = d - daysToEntry;
        const totalRecoveryDays = totalCalendarDays - daysToEntry;
        const recovFrac = totalRecoveryDays > 0 ? Math.min(daysSinceEntry / totalRecoveryDays, 1) : 1;

        recoveryTargets.forEach(rt => {
          // Stock linearly interpolates from droppedPrice to target
          const simStock = droppedPrice + (rt.price - droppedPrice) * recovFrac;
          const simOpt = blackScholes(simStock, K, remT, r, activeIV, optionType, q).price;
          row[rt.label] = simOpt;
          row[rt.label + "_pnl"] = (simOpt - entryOptionPrice) * 100 * numContracts;
          row[rt.label + "_stock"] = simStock;
        });
      }

      timelineData.push(row);
    }
    // Make sure we include the last day
    if (timelineData.length > 0 && timelineData[timelineData.length - 1].day < totalCalendarDays) {
      const d = totalCalendarDays;
      const dayDate = new Date(now.getTime() + d * 24 * 60 * 60 * 1000);
      const remT = 0.001;
      const dateStr = dayDate.toISOString().split("T")[0];
      const row = { day: d, date: dateStr };
      recoveryTargets.forEach(rt => {
        const simOpt = blackScholes(rt.price, K, remT, r, activeIV, optionType, q).price;
        row[rt.label] = simOpt;
        row[rt.label + "_pnl"] = (simOpt - entryOptionPrice) * 100 * numContracts;
        row[rt.label + "_stock"] = rt.price;
      });
      timelineData.push(row);
    }

    // ─── TRADE LIFECYCLE: Now → Entry → Eval (for P&L Explorer chart) ───
    // Phase 1: Today → Entry date: stock drifts S → droppedPrice, option adjusts
    // Phase 2: Entry → Eval date: stock moves droppedPrice → targetRebPrice, track P&L
    const lifecycleSteps = 40;
    const lifecycle = [];
    const totalLifecycleDays = Math.round(daysToEntry + clampedEvalDays);
    const lcStep = Math.max(Math.round(totalLifecycleDays / lifecycleSteps), 1);

    for (let d = 0; d <= totalLifecycleDays; d += lcStep) {
      const dayDate = new Date(now.getTime() + d * 24 * 60 * 60 * 1000);
      const dateStr = dayDate.toISOString().split("T")[0];
      const remT = Math.max(T - d / 365, 0.001);
      const isPreEntry = d < daysToEntry;
      const row = { day: d, date: dateStr, phase: isPreEntry ? "pre" : "post" };

      if (isPreEntry) {
        // Stock drifts linearly from S to droppedPrice
        const frac = daysToEntry > 0 ? d / daysToEntry : 1;
        row.stock = S - (S - droppedPrice) * frac;
        row.option = blackScholes(row.stock, K, remT, r, activeIV, optionType, q).price;
        row.pnl = null; // no position yet
      } else {
        // Stock moves linearly from droppedPrice to targetRebPrice
        const postDays = d - daysToEntry;
        const frac = clampedEvalDays > 0 ? Math.min(postDays / clampedEvalDays, 1) : 1;
        row.stock = droppedPrice + (targetRebPrice - droppedPrice) * frac;
        const bs = blackScholes(row.stock, K, remT, r, activeIV, optionType, q);
        row.option = bs.price;
        row.pnl = (bs.price - entryOptionPrice) * 100 * numContracts;
        row.positionValue = bs.price * 100 * numContracts;
        row.principal = principal;
      }
      lifecycle.push(row);
    }
    // Ensure we include the exact endpoints
    if (lifecycle.length === 0 || lifecycle[lifecycle.length - 1].day < totalLifecycleDays) {
      const d = totalLifecycleDays;
      const dayDate = new Date(now.getTime() + d * 24 * 60 * 60 * 1000);
      const remT = Math.max(T - d / 365, 0.001);
      const bs = blackScholes(targetRebPrice, K, remT, r, activeIV, optionType, q);
      lifecycle.push({
        day: d, date: dayDate.toISOString().split("T")[0], phase: "post",
        stock: targetRebPrice, option: bs.price,
        pnl: (bs.price - entryOptionPrice) * 100 * numContracts,
        positionValue: bs.price * 100 * numContracts, principal,
      });
    }

    return {
      T, T_entry, totalDays, entryTotalDays, daysToEntry,
      currentIV, activeIV, current, bsCurrent, greekOverrides,
      droppedPrice, droppedBSFlat, entryOptionPrice, entryIV, entryGreeks,
      scenarios, pnlData, greeksData, ivMatrix, ivSteps, priceSteps,
      targetRebound: targetRebPrice, minRebound, maxRebound, sliderMax,
      evalT, evalBS, evalPnl, evalPnlPct, evalDateStr, clampedEvalDays, entryDateStr,
      pnlSurface, surfacePriceSteps, surfaceTimeSteps,
      timelineData, recoveryTargets, lifecycle,
      S, K, r, q, numContracts, principal, unusedCash, investment, optPx
    };
  }, [
    stockPrice.value, strikePrice.value, optionType, currentOptionPrice.value,
    riskFreeRate.value, dividendYield.value, expirationDate, entryDate, expectedDrop.value, investmentAmount.value,
    ivOverride.value, targetEntryOptionPrice.value, reboundTarget.value, evalDays,
    mktDelta.value, mktGamma.value, mktTheta.value, mktVega.value, mktRho.value, mktIV.value
  ]);

  // ─── MULTI-LEG CALCULATIONS ───────────────────────────────────────────────
  const strategyCalcs = useMemo(() => {
    if (legs.length === 0) return null;
    const { S, K, T, r, q, activeIV } = calculations;

    // Calculate each leg's BS price and auto-fill premium if 0
    const enrichedLegs = legs.map(leg => {
      const legIV = activeIV; // use same IV for now
      const bs = blackScholes(S, leg.strike, T, r, legIV, leg.type, q);
      const effectivePremium = leg.premium > 0 ? leg.premium : bs.price;
      const dirMult = leg.dir === "long" ? 1 : -1;
      return { ...leg, bs, effectivePremium, dirMult, legIV };
    });

    // Net debit/credit
    const netCost = enrichedLegs.reduce((sum, l) => sum + l.dirMult * l.effectivePremium * l.qty * 100, 0);

    // Combined Greeks at current price
    const combinedGreeks = enrichedLegs.reduce((acc, l) => ({
      delta: acc.delta + l.dirMult * l.bs.delta * l.qty * 100,
      gamma: acc.gamma + l.dirMult * l.bs.gamma * l.qty * 100,
      theta: acc.theta + l.dirMult * l.bs.theta * l.qty * 100,
      vega: acc.vega + l.dirMult * l.bs.vega * l.qty * 100,
    }), { delta: 0, gamma: 0, theta: 0, vega: 0 });

    // Combined P&L across price range
    const minP = S * 0.5;
    const maxP = S * 1.5;
    const step = (maxP - minP) / 60;
    const combPnlData = [];
    for (let p = minP; p <= maxP; p += step) {
      let pnlNow = 0, pnl6m = 0, pnl1y = 0, pnlExp = 0;
      enrichedLegs.forEach(l => {
        const bsNow = blackScholes(p, l.strike, T, r, l.legIV, l.type, q);
        const bs6m = blackScholes(p, l.strike, Math.max(T - 0.5, 0.001), r, l.legIV, l.type, q);
        const bs1y = blackScholes(p, l.strike, Math.max(T - 1, 0.001), r, l.legIV, l.type, q);
        const bsE = blackScholes(p, l.strike, 0.001, r, l.legIV, l.type, q);
        pnlNow += l.dirMult * (bsNow.price - l.effectivePremium) * l.qty * 100;
        pnl6m += l.dirMult * (bs6m.price - l.effectivePremium) * l.qty * 100;
        pnl1y += l.dirMult * (bs1y.price - l.effectivePremium) * l.qty * 100;
        pnlExp += l.dirMult * (bsE.price - l.effectivePremium) * l.qty * 100;
      });
      combPnlData.push({ stock: p, now: pnlNow, sixMonths: pnl6m, oneYear: pnl1y, expiration: pnlExp });
    }

    // Max profit / max loss at expiration
    const expiryPnls = combPnlData.map(d => d.expiration);
    const maxProfit = Math.max(...expiryPnls);
    const maxLoss = Math.min(...expiryPnls);

    // Breakevens at expiration (where P&L crosses zero)
    const breakevens = [];
    for (let i = 1; i < combPnlData.length; i++) {
      const prev = combPnlData[i - 1].expiration;
      const curr = combPnlData[i].expiration;
      if ((prev < 0 && curr >= 0) || (prev >= 0 && curr < 0)) {
        const ratio = Math.abs(prev) / (Math.abs(prev) + Math.abs(curr));
        breakevens.push(combPnlData[i - 1].stock + ratio * step);
      }
    }

    return { enrichedLegs, netCost, combinedGreeks, combPnlData, maxProfit, maxLoss, breakevens };
  }, [legs, calculations]);

  // ─── COMPARE TAB CALCULATIONS ────────────────────────────────────────────
  const compareCalcs = useMemo(() => {
    if (compareContracts.length === 0) return null;
    const S = stockPrice.value;
    const r = riskFreeRate.value;
    const q = dividendYield.value;
    const investment = compareInvestment;
    const targetPrice = compareTargetPrice || S;
    const now = new Date();

    // Enrich each contract with BS calculations
    const enriched = compareContracts.map(ct => {
      const exp = new Date(ct.expiration);
      const T = Math.max((exp - now) / (365.25 * 24 * 60 * 60 * 1000), 0.001);
      const totalDays = Math.round(T * 365);

      // Use provided premium or calculate from BS
      const baseIV = ct.iv > 0 ? ct.iv / 100 : (calculations.activeIV || 0.5);
      const bsNow = blackScholes(S, ct.strike, T, r, baseIV, ct.type, q);
      const entryPrice = ct.premium > 0 ? ct.premium : bsNow.price;
      const activeIV = ct.premium > 0 ? impliedVol(ct.premium, S, ct.strike, T, r, ct.type, q, baseIV) : baseIV;

      // Contracts from investment
      const costPerContract = entryPrice * 100;
      const numContracts = costPerContract > 0 ? Math.max(1, Math.floor(investment / costPerContract)) : 1;
      const principal = numContracts * costPerContract;

      // Evaluate at target price and eval date
      const clampedDays = Math.min(Math.max(compareEvalDays, 0), totalDays);
      const evalT = Math.max(T - clampedDays / 365, 0.001);
      const evalBS = blackScholes(targetPrice, ct.strike, evalT, r, activeIV, ct.type, q);
      const evalPnl = (evalBS.price - entryPrice) * 100 * numContracts;
      const evalPnlPct = entryPrice > 0 ? (evalBS.price - entryPrice) / entryPrice : 0;
      const positionValue = evalBS.price * 100 * numContracts;

      // Breakeven at expiry
      const breakeven = ct.type === "call" ? ct.strike + entryPrice : ct.strike - entryPrice;

      // Intrinsic value at target
      const intrinsic = ct.type === "call"
        ? Math.max(0, targetPrice - ct.strike)
        : Math.max(0, ct.strike - targetPrice);
      const expiryPnl = (intrinsic - entryPrice) * 100 * numContracts;

      return {
        ...ct, T, totalDays, activeIV, entryPrice, numContracts, principal, costPerContract,
        clampedDays, evalT, evalBS, evalPnl, evalPnlPct, positionValue,
        breakeven, intrinsic, expiryPnl, bsNow,
      };
    });

    // Find max expiry days across all contracts for slider range
    const maxDays = Math.max(...enriched.map(e => e.totalDays), 30);

    // P&L curves across stock prices for each contract
    const sliderMax = Math.max(S * 4, ...enriched.map(e => e.strike * 2), 500);
    const pnlStep = Math.max(sliderMax / 120, 1);
    const pnlCurves = [];
    for (let p = 1; p <= sliderMax; p += pnlStep) {
      const row = { stock: p };
      enriched.forEach(ct => {
        // At eval date
        const bs = blackScholes(p, ct.strike, ct.evalT, r, ct.activeIV, ct.type, q);
        row[`pnl_${ct.id}`] = (bs.price - ct.entryPrice) * 100 * ct.numContracts;
        row[`pnlPct_${ct.id}`] = ct.entryPrice > 0 ? (bs.price - ct.entryPrice) / ct.entryPrice * 100 : 0;
      });
      // Also at expiry
      enriched.forEach(ct => {
        const bs = blackScholes(p, ct.strike, 0.001, r, ct.activeIV, ct.type, q);
        row[`expiry_${ct.id}`] = (bs.price - ct.entryPrice) * 100 * ct.numContracts;
      });
      pnlCurves.push(row);
    }

    // Return % curves (same investment across all)
    const returnCurves = [];
    for (let p = 1; p <= sliderMax; p += pnlStep) {
      const row = { stock: p };
      enriched.forEach(ct => {
        const bs = blackScholes(p, ct.strike, ct.evalT, r, ct.activeIV, ct.type, q);
        row[`ret_${ct.id}`] = ct.principal > 0 ? ((bs.price - ct.entryPrice) * 100 * ct.numContracts / ct.principal) * 100 : 0;
      });
      returnCurves.push(row);
    }

    // Time decay comparison: value of each contract as days pass (at target price)
    const decaySteps = 40;
    const decayData = [];
    for (let i = 0; i <= decaySteps; i++) {
      const dayFrac = i / decaySteps;
      const row = { dayPct: dayFrac * 100 };
      enriched.forEach(ct => {
        const d = Math.round(dayFrac * ct.totalDays);
        const remT = Math.max(ct.T - d / 365, 0.001);
        const bs = blackScholes(targetPrice, ct.strike, remT, r, ct.activeIV, ct.type, q);
        row[`val_${ct.id}`] = (bs.price - ct.entryPrice) * 100 * ct.numContracts;
        row[`days_${ct.id}`] = d;
      });
      decayData.push(row);
    }

    return { enriched, maxDays, sliderMax, pnlCurves, returnCurves, decayData, targetPrice };
  }, [compareContracts, stockPrice.value, riskFreeRate.value, dividendYield.value,
      compareTargetPrice, compareEvalDays, compareInvestment, calculations.activeIV]);

  // ─── ROLL PLANNER CALCULATIONS ────────────────────────────────────────────
  const rollCalcs = useMemo(() => {
    if (rollLegs.length === 0) return null;
    const S = stockPrice.value;
    const r = riskFreeRate.value;
    const q = dividendYield.value;
    const investment = rollInvestment;
    const finalTarget = rollTargetPrice || S;
    const baseIV = calculations.activeIV || 0.5;
    const now = new Date();
    const slippageMult = 1 - rollSlippage / 100;

    // Sort legs by order (they represent sequential holdings)
    const sortedLegs = [...rollLegs];

    // Calculate the total journey span
    const firstExp = new Date(sortedLegs[0].expiration);
    const lastExp = new Date(sortedLegs[sortedLegs.length - 1].expiration);
    const totalJourneyDays = Math.round((lastExp - now) / (24 * 60 * 60 * 1000));

    // Process each leg sequentially, tracking capital through rolls
    let availableCapital = investment;
    const processedLegs = [];
    let cumulativeRollDays = 0;

    for (let i = 0; i < sortedLegs.length; i++) {
      const leg = sortedLegs[i];
      const exp = new Date(leg.expiration);
      const entryDate = i === 0 ? now : new Date(now.getTime() + cumulativeRollDays * 86400000);
      const T = Math.max((exp - entryDate) / (365.25 * 24 * 60 * 60 * 1000), 0.001);
      const legDays = Math.round(T * 365);

      // Stock price at entry of this leg
      let stockAtEntry;
      if (i === 0) {
        stockAtEntry = S;
      } else if (leg.stockAtRoll > 0) {
        stockAtEntry = leg.stockAtRoll;
      } else if (rollPathMode === "linear") {
        // Linear interpolation from S to finalTarget over total journey
        const frac = totalJourneyDays > 0 ? cumulativeRollDays / totalJourneyDays : 0;
        stockAtEntry = S + (finalTarget - S) * frac;
      } else {
        stockAtEntry = S;
      }

      // IV for this leg
      const legIV = leg.iv > 0 ? leg.iv / 100 : Math.max(0.05, baseIV * (1 + rollIVShift / 100));

      // Entry price
      const bsEntry = blackScholes(stockAtEntry, leg.strike, T, r, legIV, leg.type, q);
      const entryPrice = leg.premium > 0 ? leg.premium : bsEntry.price;

      // How many contracts with available capital
      const costPerContract = entryPrice * 100;
      const numContracts = costPerContract > 0 ? Math.max(1, Math.floor(availableCapital / costPerContract)) : 1;
      const principal = numContracts * costPerContract;
      const unusedCash = availableCapital - principal;

      // Roll or final eval
      const isLastLeg = i === sortedLegs.length - 1;
      const holdDays = isLastLeg ? legDays : Math.min(leg.rollAfterDays || legDays, legDays);
      const exitT = Math.max(T - holdDays / 365, 0.001);

      // Stock at exit
      let stockAtExit;
      if (isLastLeg) {
        stockAtExit = finalTarget;
      } else {
        const nextLeg = sortedLegs[i + 1];
        if (nextLeg.stockAtRoll > 0) {
          stockAtExit = nextLeg.stockAtRoll;
        } else if (rollPathMode === "linear") {
          const exitDay = cumulativeRollDays + holdDays;
          const frac = totalJourneyDays > 0 ? exitDay / totalJourneyDays : 1;
          stockAtExit = S + (finalTarget - S) * frac;
        } else {
          stockAtExit = S;
        }
      }

      const bsExit = blackScholes(stockAtExit, leg.strike, exitT, r, legIV, leg.type, q);
      const exitPrice = bsExit.price;
      const rawExitProceeds = exitPrice * 100 * numContracts;
      const exitProceeds = isLastLeg ? rawExitProceeds : rawExitProceeds * slippageMult;
      const legPnl = exitProceeds - principal;
      const legPnlPct = principal > 0 ? legPnl / principal : 0;

      processedLegs.push({
        ...leg, T, legDays, holdDays, stockAtEntry, stockAtExit, legIV, entryPrice,
        numContracts, principal, unusedCash, exitPrice, exitProceeds, legPnl, legPnlPct,
        entryDayOffset: cumulativeRollDays, exitDayOffset: cumulativeRollDays + holdDays,
        bsEntry, bsExit, isLastLeg, capitalIn: availableCapital,
      });

      // Capital for next leg = exit proceeds + any unused cash
      availableCapital = exitProceeds + unusedCash;
      cumulativeRollDays += holdDays;
    }

    // Overall journey metrics
    const totalPnl = availableCapital - investment;
    const totalPnlPct = investment > 0 ? totalPnl / investment : 0;
    const totalDaysHeld = cumulativeRollDays;

    // Build timeline visualization data
    const timelineSteps = 60;
    const tStep = Math.max(Math.round(totalJourneyDays / timelineSteps), 1);
    const timeline = [];

    for (let d = 0; d <= totalJourneyDays; d += tStep) {
      const row = { day: d, date: new Date(now.getTime() + d * 86400000).toISOString().split("T")[0] };

      // Stock price at this day (linear path)
      const frac = totalJourneyDays > 0 ? d / totalJourneyDays : 1;
      row.stock = S + (finalTarget - S) * frac;

      // Which leg are we in?
      let activeLeg = null;
      let cumDays = 0;
      for (const pl of processedLegs) {
        if (d >= pl.entryDayOffset && d <= pl.exitDayOffset) {
          activeLeg = pl;
          break;
        }
      }

      if (activeLeg) {
        const dayInLeg = d - activeLeg.entryDayOffset;
        const remT = Math.max(activeLeg.T - dayInLeg / 365, 0.001);
        const bs = blackScholes(row.stock, activeLeg.strike, remT, r, activeLeg.legIV, activeLeg.type, q);
        row.optionValue = bs.price;
        row.positionValue = bs.price * 100 * activeLeg.numContracts + activeLeg.unusedCash;
        row.legPnl = (bs.price - activeLeg.entryPrice) * 100 * activeLeg.numContracts;
        row.legLabel = activeLeg.label;
        row.legId = activeLeg.id;
      }

      timeline.push(row);
    }
    // Ensure last point
    if (timeline.length === 0 || timeline[timeline.length - 1].day < totalJourneyDays) {
      const lastLeg = processedLegs[processedLegs.length - 1];
      timeline.push({
        day: totalJourneyDays, date: lastExp.toISOString().split("T")[0],
        stock: finalTarget, optionValue: lastLeg ? lastLeg.exitPrice : 0,
        positionValue: availableCapital, legPnl: totalPnl,
        legLabel: lastLeg?.label, legId: lastLeg?.id,
      });
    }

    // Sensitivity: vary final target price and see total outcome
    const sensitivitySteps = [];
    const maxSens = Math.max(S * 5, 500);
    const sensStep = maxSens / 30;
    for (let p = Math.max(1, sensStep); p <= maxSens; p += sensStep) {
      // Re-run the whole chain with different final target
      let cap = investment;
      let cumD = 0;
      for (let i = 0; i < sortedLegs.length; i++) {
        const leg = sortedLegs[i];
        const exp2 = new Date(leg.expiration);
        const entryD = i === 0 ? now : new Date(now.getTime() + cumD * 86400000);
        const T2 = Math.max((exp2 - entryD) / (365.25 * 24 * 60 * 60 * 1000), 0.001);
        const ld = Math.round(T2 * 365);
        const isLast = i === sortedLegs.length - 1;
        const hd = isLast ? ld : Math.min(leg.rollAfterDays || ld, ld);

        // Stock at entry
        let se;
        if (i === 0) se = S;
        else {
          const f = totalJourneyDays > 0 ? cumD / totalJourneyDays : 0;
          se = S + (p - S) * f;
        }

        const iv2 = leg.iv > 0 ? leg.iv / 100 : Math.max(0.05, baseIV * (1 + rollIVShift / 100));
        const bsE = blackScholes(se, leg.strike, T2, r, iv2, leg.type, q);
        const ep = leg.premium > 0 ? leg.premium : bsE.price;
        const cpc = ep * 100;
        const nc = cpc > 0 ? Math.max(1, Math.floor(cap / cpc)) : 1;
        const pr = nc * cpc;
        const uc = cap - pr;

        // Stock at exit
        let sx;
        if (isLast) sx = p;
        else {
          const ef = totalJourneyDays > 0 ? (cumD + hd) / totalJourneyDays : 1;
          sx = S + (p - S) * ef;
        }

        const exitT2 = Math.max(T2 - hd / 365, 0.001);
        const bsX = blackScholes(sx, leg.strike, exitT2, r, iv2, leg.type, q);
        const xp = bsX.price * 100 * nc;
        cap = (isLast ? xp : xp * slippageMult) + uc;
        cumD += hd;
      }
      sensitivitySteps.push({ targetPrice: p, finalCapital: cap, totalPnl: cap - investment, totalPnlPct: investment > 0 ? (cap - investment) / investment : 0 });
    }

    // IV sensitivity at final target
    const ivSensitivity = [];
    for (let ivShift = -30; ivShift <= 30; ivShift += 5) {
      let cap = investment;
      let cumD = 0;
      for (let i = 0; i < sortedLegs.length; i++) {
        const leg = sortedLegs[i];
        const exp2 = new Date(leg.expiration);
        const entryD = i === 0 ? now : new Date(now.getTime() + cumD * 86400000);
        const T2 = Math.max((exp2 - entryD) / (365.25 * 24 * 60 * 60 * 1000), 0.001);
        const ld = Math.round(T2 * 365);
        const isLast = i === sortedLegs.length - 1;
        const hd = isLast ? ld : Math.min(leg.rollAfterDays || ld, ld);

        let se;
        if (i === 0) se = S;
        else {
          const f = totalJourneyDays > 0 ? cumD / totalJourneyDays : 0;
          se = S + (finalTarget - S) * f;
        }

        const shiftedIV = Math.max(0.05, baseIV * (1 + (rollIVShift + ivShift) / 100));
        const bsE = blackScholes(se, leg.strike, T2, r, shiftedIV, leg.type, q);
        const ep = leg.premium > 0 ? leg.premium : bsE.price;
        const cpc = ep * 100;
        const nc = cpc > 0 ? Math.max(1, Math.floor(cap / cpc)) : 1;
        const pr = nc * cpc;
        const uc = cap - pr;

        let sx;
        if (isLast) sx = finalTarget;
        else {
          const ef = totalJourneyDays > 0 ? (cumD + hd) / totalJourneyDays : 1;
          sx = S + (finalTarget - S) * ef;
        }

        const exitT2 = Math.max(T2 - hd / 365, 0.001);
        const bsX = blackScholes(sx, leg.strike, exitT2, r, shiftedIV, leg.type, q);
        const xp = bsX.price * 100 * nc;
        cap = (isLast ? xp : xp * slippageMult) + uc;
        cumD += hd;
      }
      ivSensitivity.push({ ivShift, finalCapital: cap, totalPnl: cap - investment, totalPnlPct: investment > 0 ? (cap - investment) / investment : 0 });
    }

    return {
      processedLegs, totalPnl, totalPnlPct, totalDaysHeld, totalJourneyDays,
      availableCapital, timeline, sensitivitySteps, ivSensitivity,
      sliderMax: Math.max(S * 5, ...sortedLegs.map(l => l.strike * 2), 500),
    };
  }, [rollLegs, stockPrice.value, riskFreeRate.value, dividendYield.value,
      rollTargetPrice, rollInvestment, rollIVShift, rollSlippage, rollPathMode, calculations.activeIV]);

  // ─── ROLL OPTIMIZER CALCULATIONS ──────────────────────────────────────────
  const optimizerCalcs = useMemo(() => {
    const S = stockPrice.value;
    const r = riskFreeRate.value;
    const q = dividendYield.value;
    const baseIV = calculations.activeIV || 0.5;
    const now = new Date();

    // Current option
    const exp = new Date(optExpiry);
    const T = Math.max((exp - now) / (365.25 * 24 * 60 * 60 * 1000), 0.001);
    const totalDays = Math.round(T * 365);
    const iv = optIV > 0 ? optIV / 100 : baseIV;
    const bsNow = blackScholes(S, optStrike, T, r, iv, optType, q);
    const entryPrice = optEntryPrice > 0 ? optEntryPrice : bsNow.price;
    const costPerContract = entryPrice * 100;
    const numContracts = costPerContract > 0 ? Math.max(1, Math.floor(optInvestment / costPerContract)) : 1;
    const principal = numContracts * costPerContract;

    // Roll-into option
    const rollExp = new Date(rollIntoExpiry);
    const rollT = Math.max((rollExp - now) / (365.25 * 24 * 60 * 60 * 1000), 0.001);
    const rollTotalDays = Math.round(rollT * 365);
    const rollIV = rollIntoIV > 0 ? rollIntoIV / 100 : iv;
    const slippageMult = 1 - optRollSlippage / 100;

    // Stock price path: ramp up to peak, then flatten/drift to final
    const stockAtDay = (d) => {
      if (d <= 0) return S;
      if (d >= totalDays) return optFinalPrice;
      if (d <= optPeakDay) {
        // Ramp from S to peakPrice
        const frac = optPeakDay > 0 ? d / optPeakDay : 1;
        // Use smooth ease-in-out curve
        const smoothFrac = frac * frac * (3 - 2 * frac);
        return S + (optPeakPrice - S) * smoothFrac;
      } else {
        // Drift from peakPrice to finalPrice
        const remainDays = totalDays - optPeakDay;
        const frac = remainDays > 0 ? (d - optPeakDay) / remainDays : 1;
        return optPeakPrice + (optFinalPrice - optPeakPrice) * frac;
      }
    };

    // ─── CORE ANALYSIS: For each possible roll day, calculate outcomes ───
    const dayStep = Math.max(Math.round(totalDays / 80), 1);
    const rollAnalysis = [];

    for (let d = 0; d <= totalDays; d += dayStep) {
      const stockPrice_d = stockAtDay(d);
      const remT = Math.max(T - d / 365, 0.001);
      const daysRemaining = Math.max(totalDays - d, 0);

      // Current option value at this point
      const bsCurrent = blackScholes(stockPrice_d, optStrike, remT, r, iv, optType, q);
      const currentOptValue = bsCurrent.price;
      const positionValue = currentOptValue * 100 * numContracts;
      const currentPnl = positionValue - principal;
      const currentPnlPct = principal > 0 ? currentPnl / principal : 0;

      // Time value vs intrinsic breakdown
      const intrinsic = optType === "call"
        ? Math.max(0, stockPrice_d - optStrike)
        : Math.max(0, optStrike - stockPrice_d);
      const timeValue = Math.max(0, currentOptValue - intrinsic);
      const timeValuePct = currentOptValue > 0 ? timeValue / currentOptValue : 0;

      // Theta at this point (daily decay rate)
      const dailyTheta = bsCurrent.theta; // already per day

      // ─── HOLD SCENARIO: Hold to expiry, stock drifts to finalPrice ───
      // Value at expiry with final stock price
      const expiryIntrinsic = optType === "call"
        ? Math.max(0, optFinalPrice - optStrike)
        : Math.max(0, optStrike - optFinalPrice);
      const holdToExpiryValue = expiryIntrinsic * 100 * numContracts;
      const holdPnl = holdToExpiryValue - principal;

      // ─── ROLL SCENARIO: Sell current, buy roll-into option ───
      // Proceeds from selling current option (with slippage)
      const sellProceeds = positionValue * slippageMult;

      // Roll-into option: time remaining from roll day to roll expiry
      const rollRemT = Math.max(rollT - d / 365, 0.001);
      const bsRollInto = blackScholes(stockPrice_d, rollIntoStrike, rollRemT, r, rollIV, optType, q);
      const rollEntryPrice = bsRollInto.price;
      const rollCostPerContract = rollEntryPrice * 100;
      const rollContracts = rollCostPerContract > 0 ? Math.max(1, Math.floor(sellProceeds / rollCostPerContract)) : 0;
      const rollPrincipal = rollContracts * rollCostPerContract;
      const rollUnusedCash = sellProceeds - rollPrincipal;

      // Roll-into value at ITS expiry (stock at finalPrice for simplicity, or we can extend the path)
      // For the roll option, at its expiry the stock continues the path
      const rollExpiryIntrinsic = optType === "call"
        ? Math.max(0, optFinalPrice - rollIntoStrike)
        : Math.max(0, rollIntoStrike - optFinalPrice);
      const rollExpiryValue = rollExpiryIntrinsic * 100 * rollContracts + rollUnusedCash;

      // But more useful: what's the roll option worth at the ORIGINAL expiry date?
      // (so we compare apples-to-apples at the same endpoint)
      const rollAtOrigExpT = Math.max(rollT - totalDays / 365, 0.001);
      const bsRollAtOrigExp = blackScholes(optFinalPrice, rollIntoStrike, rollAtOrigExpT, r, rollIV, optType, q);
      const rollValueAtOrigExp = bsRollAtOrigExp.price * 100 * rollContracts + rollUnusedCash;
      const rollPnlAtOrigExp = rollValueAtOrigExp - principal;

      // Roll advantage: difference between rolling here vs holding to expiry
      const rollAdvantage = rollPnlAtOrigExp - holdPnl;

      // Also: roll option value at its own expiry (full timeline)
      const rollFullPnl = rollExpiryValue - principal;

      rollAnalysis.push({
        day: d, daysRemaining, stockPrice: stockPrice_d,
        currentOptValue, positionValue, currentPnl, currentPnlPct,
        intrinsic, timeValue, timeValuePct, dailyTheta,
        holdToExpiryValue, holdPnl,
        sellProceeds, rollEntryPrice, rollContracts, rollPrincipal,
        rollValueAtOrigExp, rollPnlAtOrigExp, rollAdvantage,
        rollFullPnl, rollExpiryValue,
        bsCurrent, bsRollInto,
      });
    }
    // Ensure we include the last day
    if (rollAnalysis.length === 0 || rollAnalysis[rollAnalysis.length - 1].day < totalDays) {
      const d = totalDays;
      const stockPrice_d = optFinalPrice;
      const intrinsic = optType === "call" ? Math.max(0, stockPrice_d - optStrike) : Math.max(0, optStrike - stockPrice_d);
      rollAnalysis.push({
        day: d, daysRemaining: 0, stockPrice: stockPrice_d,
        currentOptValue: intrinsic, positionValue: intrinsic * 100 * numContracts,
        currentPnl: intrinsic * 100 * numContracts - principal,
        currentPnlPct: principal > 0 ? (intrinsic * 100 * numContracts - principal) / principal : 0,
        intrinsic, timeValue: 0, timeValuePct: 0, dailyTheta: 0,
        holdToExpiryValue: intrinsic * 100 * numContracts,
        holdPnl: intrinsic * 100 * numContracts - principal,
        sellProceeds: 0, rollEntryPrice: 0, rollContracts: 0, rollPrincipal: 0,
        rollValueAtOrigExp: 0, rollPnlAtOrigExp: -principal, rollAdvantage: 0,
        rollFullPnl: 0, rollExpiryValue: 0,
      });
    }

    // Find optimal roll day (max rollAdvantage)
    const optimalRoll = rollAnalysis.reduce((best, row) =>
      row.rollAdvantage > best.rollAdvantage ? row : best, rollAnalysis[0]);

    // Find max position value point
    const peakValue = rollAnalysis.reduce((best, row) =>
      row.positionValue > best.positionValue ? row : best, rollAnalysis[0]);

    // Find where time value drops below 50% of option value
    const timeValueCritical = rollAnalysis.find(r => r.day > 0 && r.timeValuePct < 0.5 && r.currentOptValue > 0.01);

    // Theta acceleration: find where theta gets worse than -0.5% of position per day
    const thetaCritical = rollAnalysis.find(r => r.day > 0 && r.positionValue > 0 && Math.abs(r.dailyTheta * 100 * numContracts) / r.positionValue > 0.005);

    // ─── MULTI-SCENARIO: vary finalPrice to see how optimal roll day shifts ───
    const scenarioStocks = [];
    const sMin = Math.max(S * 0.5, 1);
    const sMax = Math.max(optStrike * 2, S * 4);
    const sStep = (sMax - sMin) / 12;
    for (let sp = sMin; sp <= sMax; sp += sStep) scenarioStocks.push(Math.round(sp));

    const scenarioMatrix = scenarioStocks.map(finalSP => {
      // For each final stock price, find optimal roll day
      let bestDay = 0, bestAdv = -Infinity;
      const dayPoints = [];

      for (let d = 0; d <= totalDays; d += dayStep * 2) {
        // Stock path with this final price
        const sp_d = (() => {
          if (d <= 0) return S;
          if (d >= totalDays) return finalSP;
          if (d <= optPeakDay) {
            const frac = optPeakDay > 0 ? d / optPeakDay : 1;
            const sf = frac * frac * (3 - 2 * frac);
            return S + (optPeakPrice - S) * sf;
          }
          const rem = totalDays - optPeakDay;
          const frac = rem > 0 ? (d - optPeakDay) / rem : 1;
          return optPeakPrice + (finalSP - optPeakPrice) * frac;
        })();

        const remT = Math.max(T - d / 365, 0.001);
        const bs = blackScholes(sp_d, optStrike, remT, r, iv, optType, q);
        const posVal = bs.price * 100 * numContracts;
        const proceeds = posVal * slippageMult;

        // Hold value
        const holdIntr = optType === "call" ? Math.max(0, finalSP - optStrike) : Math.max(0, optStrike - finalSP);
        const holdVal = holdIntr * 100 * numContracts;

        // Roll value at orig expiry
        const rRemT = Math.max(rollT - d / 365, 0.001);
        const bsR = blackScholes(sp_d, rollIntoStrike, rRemT, r, rollIV, optType, q);
        const rCPC = bsR.price * 100;
        const rNC = rCPC > 0 ? Math.max(1, Math.floor(proceeds / rCPC)) : 0;
        const rUnused = proceeds - rNC * rCPC;
        const rAtOrigExpT = Math.max(rollT - totalDays / 365, 0.001);
        const bsRExp = blackScholes(finalSP, rollIntoStrike, rAtOrigExpT, r, rollIV, optType, q);
        const rVal = bsRExp.price * 100 * rNC + rUnused;

        const adv = rVal - holdVal;
        if (adv > bestAdv) { bestAdv = adv; bestDay = d; }
        dayPoints.push({ day: d, holdPnl: holdVal - principal, rollPnl: rVal - principal, advantage: adv });
      }

      return { finalStockPrice: finalSP, optimalDay: bestDay, bestAdvantage: bestAdv, dayPoints };
    });

    return {
      rollAnalysis, optimalRoll, peakValue, timeValueCritical, thetaCritical,
      totalDays, numContracts, principal, entryPrice, iv, T,
      scenarioMatrix, scenarioStocks, stockAtDay,
      sliderMax: Math.max(S * 5, optStrike * 2, 500),
    };
  }, [stockPrice.value, riskFreeRate.value, dividendYield.value, calculations.activeIV,
      optStrike, optType, optExpiry, optEntryPrice, optIV, optInvestment,
      rollIntoStrike, rollIntoExpiry, rollIntoIV,
      optPeakPrice, optPeakDay, optFinalPrice, optRollSlippage]);

  const c = calculations;

  const tabs = [
    { id: "scenario", label: "Scenario" },
    { id: "returns", label: "Returns" },
    { id: "greeks", label: "Greeks" },
    { id: "pnl", label: "P&L" },
    { id: "compare", label: "Compare" },
    { id: "strategy", label: "Multi-Leg" },
    { id: "ivmatrix", label: "IV Matrix" },
  ];

  const OverrideBadge = () => (
    <span style={{ fontSize: 8, color: "#f59e0b", background: "#f59e0b15", padding: "1px 5px", borderRadius: 3, marginLeft: 4, verticalAlign: "middle" }}>MKT</span>
  );

  // ─── REPORT GENERATOR ──────────────────────────────────────────────────────
  const generateReport = useCallback(() => {
    const now = new Date();
    const dateStr = now.toISOString().split("T")[0];
    const timeStr = now.toTimeString().split(" ")[0];

    // SVG chart builder helper
    const buildSVG = (data, xKey, lines, { width = 700, height = 220, yLabel = "", xLabel = "", showZero = false, yFmt = v => v.toFixed(0), xFmt = v => v.toFixed(0) } = {}) => {
      if (!data || data.length < 2) return "";
      const pad = { top: 25, right: 20, bottom: 35, left: 65 };
      const w = width - pad.left - pad.right;
      const h = height - pad.top - pad.bottom;
      // Compute bounds
      let yMin = Infinity, yMax = -Infinity;
      lines.forEach(l => data.forEach(d => { const v = d[l.key]; if (v != null && isFinite(v)) { yMin = Math.min(yMin, v); yMax = Math.max(yMax, v); } }));
      if (showZero) { yMin = Math.min(yMin, 0); yMax = Math.max(yMax, 0); }
      if (yMin === yMax) { yMin -= 1; yMax += 1; }
      const yPad = (yMax - yMin) * 0.08;
      yMin -= yPad; yMax += yPad;
      const xMin = data[0][xKey], xMax = data[data.length - 1][xKey];
      const xRange = xMax - xMin || 1;
      const sx = v => pad.left + ((v - xMin) / xRange) * w;
      const sy = v => pad.top + h - ((v - yMin) / (yMax - yMin)) * h;

      let svg = `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:${width}px;height:auto;font-family:'Helvetica Neue',Arial,sans-serif">`;
      // Background
      svg += `<rect width="${width}" height="${height}" fill="#fafbfc" rx="4"/>`;
      // Grid lines
      const yTicks = 5;
      for (let i = 0; i <= yTicks; i++) {
        const yv = yMin + (yMax - yMin) * (i / yTicks);
        const y = sy(yv);
        svg += `<line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" stroke="#e5e7eb" stroke-width="0.5"/>`;
        svg += `<text x="${pad.left - 8}" y="${y + 3}" text-anchor="end" fill="#6b7280" font-size="8">${yFmt(yv)}</text>`;
      }
      // X axis ticks
      const xTicks = Math.min(data.length, 8);
      const xStep = Math.max(1, Math.floor(data.length / xTicks));
      for (let i = 0; i < data.length; i += xStep) {
        const xv = data[i][xKey];
        const x = sx(xv);
        svg += `<text x="${x}" y="${height - 8}" text-anchor="middle" fill="#6b7280" font-size="8">${xFmt(xv)}</text>`;
      }
      // Zero line
      if (showZero && yMin < 0 && yMax > 0) {
        svg += `<line x1="${pad.left}" y1="${sy(0)}" x2="${width - pad.right}" y2="${sy(0)}" stroke="#9ca3af" stroke-width="1" stroke-dasharray="4 2"/>`;
      }
      // Lines
      lines.forEach(l => {
        const pts = data.filter(d => d[l.key] != null && isFinite(d[l.key])).map(d => `${sx(d[xKey]).toFixed(1)},${sy(d[l.key]).toFixed(1)}`);
        if (pts.length < 2) return;
        // Optional area fill
        if (l.fill) {
          const zeroY = sy(0);
          svg += `<path d="M${pts[0]} ${pts.map(p => `L${p}`).join(" ")} L${sx(data.filter(d => d[l.key] != null).pop()[xKey]).toFixed(1)},${zeroY.toFixed(1)} L${sx(data.filter(d => d[l.key] != null)[0][xKey]).toFixed(1)},${zeroY.toFixed(1)} Z" fill="${l.fill}" opacity="0.15"/>`;
        }
        svg += `<polyline points="${pts.join(" ")}" fill="none" stroke="${l.color}" stroke-width="${l.width || 1.8}" ${l.dash ? `stroke-dasharray="${l.dash}"` : ""}/>`;
      });
      // Legend
      let lx = pad.left + 5;
      lines.forEach(l => {
        svg += `<line x1="${lx}" y1="10" x2="${lx + 16}" y2="10" stroke="${l.color}" stroke-width="2" ${l.dash ? `stroke-dasharray="${l.dash}"` : ""}/>`;
        svg += `<text x="${lx + 20}" y="13" fill="#374151" font-size="8" font-weight="500">${l.label}</text>`;
        lx += l.label.length * 5.5 + 30;
      });
      // Axis labels
      if (yLabel) svg += `<text x="12" y="${pad.top + h / 2}" fill="#6b7280" font-size="8" transform="rotate(-90 12 ${pad.top + h / 2})">${yLabel}</text>`;
      if (xLabel) svg += `<text x="${pad.left + w / 2}" y="${height - 1}" fill="#6b7280" font-size="8" text-anchor="middle">${xLabel}</text>`;
      svg += "</svg>";
      return svg;
    };

    // ─── Build report sections ───
    const isMultiLeg = legs.length > 0 && strategyCalcs;
    const sc = strategyCalcs;

    // P&L chart
    const pnlChart = buildSVG(c.pnlData, "stock", [
      { key: "now", label: "Now", color: "#2563eb", width: 2.2, fill: "#2563eb" },
      { key: "sixMonths", label: "+6mo", color: "#7c3aed", width: 1.5, dash: "4 3" },
      { key: "oneYear", label: "+1yr", color: "#d97706", width: 1.5, dash: "4 3" },
      { key: "expiration", label: "Expiry", color: "#dc2626", width: 2 },
    ], { yLabel: "P&L ($)", xLabel: "Stock Price ($)", showZero: true, yFmt: v => `$${(v / 1000).toFixed(1)}k`, xFmt: v => `$${v.toFixed(0)}` });

    // Greeks charts
    const greekCharts = ["delta", "gamma", "theta", "vega"].map(gk => {
      const gColors = { delta: "#2563eb", gamma: "#7c3aed", theta: "#dc2626", vega: "#059669" };
      return { key: gk, svg: buildSVG(c.greeksData, "stock", [
        { key: gk, label: gk.charAt(0).toUpperCase() + gk.slice(1), color: gColors[gk], width: 2 }
      ], { height: 140, xFmt: v => `$${v.toFixed(0)}`, yFmt: v => v.toFixed(gk === "gamma" ? 4 : 3) }) };
    });

    // Lifecycle chart
    const lifecycleChart = buildSVG(c.lifecycle.filter(p => p.stock != null), "day", [
      { key: "stock", label: "Stock", color: "#2563eb", width: 2 },
      { key: "option", label: "Option", color: "#7c3aed", width: 1.8, dash: "5 3" },
    ], { xLabel: "Day", yLabel: "Price ($)", xFmt: v => `+${v.toFixed(0)}d`, yFmt: v => `$${v.toFixed(0)}` });

    // Multi-leg P&L chart
    let strategyChart = "";
    if (isMultiLeg) {
      strategyChart = buildSVG(sc.combPnlData, "stock", [
        { key: "now", label: "Now", color: "#2563eb", width: 2.2, fill: "#2563eb" },
        { key: "sixMonths", label: "+6mo", color: "#7c3aed", width: 1.5, dash: "4 3" },
        { key: "expiration", label: "Expiry", color: "#dc2626", width: 2 },
      ], { yLabel: "P&L ($)", xLabel: "Stock Price ($)", showZero: true, yFmt: v => `$${v.toFixed(0)}`, xFmt: v => `$${v.toFixed(0)}` });
    }

    // Roll optimizer charts
    let rollOptCharts = "";
    if (compareMode === "optimizer" && optimizerCalcs) {
      const oc = optimizerCalcs;
      const posChart = buildSVG(oc.rollAnalysis, "day", [
        { key: "positionValue", label: "Position Value", color: "#2563eb", width: 2.2 },
        { key: "currentPnl", label: "P&L", color: "#059669", width: 1.8, dash: "5 3", fill: "#059669" },
      ], { yLabel: "$", xLabel: "Day", showZero: true, yFmt: v => `$${(v / 1000).toFixed(1)}k`, xFmt: v => `+${v.toFixed(0)}d` });

      const advChart = buildSVG(oc.rollAnalysis, "day", [
        { key: "rollAdvantage", label: "Roll Advantage", color: "#0891b2", width: 2.5, fill: "#0891b2" },
        { key: "rollPnlAtOrigExp", label: "Roll P&L", color: "#059669", width: 1.5, dash: "5 3" },
        { key: "holdPnl", label: "Hold P&L", color: "#dc2626", width: 1.5, dash: "5 3" },
      ], { yLabel: "$", xLabel: "Day", showZero: true, yFmt: v => `$${(v / 1000).toFixed(1)}k`, xFmt: v => `+${v.toFixed(0)}d` });

      rollOptCharts = `
        <div class="page-break"></div>
        <h2>Roll Timing Analysis</h2>
        <div class="section-desc">Optimal roll point analysis based on stock price trajectory forecast.</div>
        <div class="metrics-row">
          <div class="metric"><div class="metric-label">Optimal Roll Day</div><div class="metric-value accent">Day ${oc.optimalRoll.day}</div><div class="metric-sub">${oc.optimalRoll.daysRemaining}d before expiry · Stock @ $${oc.optimalRoll.stockPrice.toFixed(0)}</div></div>
          <div class="metric"><div class="metric-label">Peak Position Value</div><div class="metric-value">${fmtDollar(oc.peakValue.positionValue)}</div><div class="metric-sub">Day ${oc.peakValue.day} · ${fmtPnlPct(oc.peakValue.currentPnlPct)} return</div></div>
          <div class="metric"><div class="metric-label">Roll Advantage</div><div class="metric-value ${oc.optimalRoll.rollAdvantage >= 0 ? "green" : "red"}">${fmtPnl(oc.optimalRoll.rollAdvantage)}</div><div class="metric-sub">vs hold to expiry</div></div>
          ${oc.thetaCritical ? `<div class="metric"><div class="metric-label">Theta Danger Zone</div><div class="metric-value amber">Day ${oc.thetaCritical.day}</div><div class="metric-sub">Decay exceeds 0.5%/day</div></div>` : ""}
        </div>
        <h3>Position Value & P&L Over Life</h3>
        ${posChart}
        <h3>Roll vs Hold — Optimal Timing</h3>
        <div class="section-desc">Green zone = rolling beats holding. Peak = best roll point.</div>
        ${advChart}
        <h3>Roll Decision by Stock Outcome</h3>
        <table>
          <thead><tr><th style="text-align:left">Final Stock</th><th>Optimal Day</th><th>Hold P&L</th><th>Roll P&L</th><th>Advantage</th><th>Verdict</th></tr></thead>
          <tbody>
            ${oc.scenarioMatrix.map(row => {
              const holdIntrinsic = optType === "call" ? Math.max(0, row.finalStockPrice - optStrike) : Math.max(0, optStrike - row.finalStockPrice);
              const holdPnl = holdIntrinsic * 100 * oc.numContracts - oc.principal;
              const optDay = row.dayPoints.reduce((best, dp) => dp.advantage > best.advantage ? dp : best, row.dayPoints[0]);
              return `<tr><td style="text-align:left;font-weight:500">${fmtDollar(row.finalStockPrice)} ${row.finalStockPrice >= optStrike ? '<span class="tag-green">ITM</span>' : ""}</td><td>Day ${row.optimalDay}</td><td class="${holdPnl >= 0 ? "green" : "red"}">${fmtPnl(holdPnl)}</td><td class="${optDay.rollPnl >= 0 ? "green" : "red"}">${fmtPnl(optDay.rollPnl)}</td><td style="font-weight:600" class="${row.bestAdvantage >= 0 ? "green" : "red"}">${fmtPnl(row.bestAdvantage)}</td><td style="font-weight:700" class="${row.bestAdvantage > 100 ? "green" : row.bestAdvantage < -100 ? "red" : ""}">${row.bestAdvantage > 100 ? "ROLL" : row.bestAdvantage < -100 ? "HOLD" : "≈ SAME"}</td></tr>`;
            }).join("")}
          </tbody>
        </table>
      `;
    }

    // ─── Assemble HTML ───
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Options Analysis Report — ${dateStr}</title>
<style>
  @page { size: letter; margin: 0.6in 0.65in; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 9.5pt; color: #1f2937; line-height: 1.45; background: #fff; }
  .page-break { page-break-before: always; margin-top: 24px; }
  .header { border-bottom: 2px solid #111827; padding-bottom: 12px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: flex-end; }
  .header h1 { font-size: 18pt; font-weight: 700; color: #111827; letter-spacing: -0.5px; }
  .header-sub { font-size: 8pt; color: #6b7280; text-align: right; line-height: 1.5; }
  .header-badge { display: inline-block; font-size: 7pt; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; padding: 2px 8px; border-radius: 3px; background: #dbeafe; color: #1d4ed8; margin-left: 8px; }
  h2 { font-size: 12pt; font-weight: 700; color: #111827; margin: 20px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #e5e7eb; }
  h3 { font-size: 10pt; font-weight: 600; color: #374151; margin: 14px 0 6px; }
  .section-desc { font-size: 8.5pt; color: #6b7280; margin-bottom: 10px; }
  .metrics-row { display: flex; gap: 10px; margin: 10px 0 14px; flex-wrap: wrap; }
  .metric { flex: 1; min-width: 130px; padding: 10px 12px; border: 1px solid #e5e7eb; border-radius: 6px; background: #f9fafb; }
  .metric-label { font-size: 7.5pt; text-transform: uppercase; letter-spacing: 1px; color: #6b7280; font-weight: 600; margin-bottom: 3px; }
  .metric-value { font-size: 14pt; font-weight: 700; color: #111827; }
  .metric-sub { font-size: 7.5pt; color: #9ca3af; margin-top: 2px; }
  .metric-value.green { color: #059669; }
  .metric-value.red { color: #dc2626; }
  .metric-value.amber { color: #d97706; }
  .metric-value.accent { color: #0891b2; }
  table { width: 100%; border-collapse: collapse; font-size: 8.5pt; margin: 8px 0 12px; }
  th { text-align: right; padding: 5px 8px; font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.8px; color: #6b7280; border-bottom: 2px solid #d1d5db; font-weight: 600; background: #f9fafb; }
  td { text-align: right; padding: 4px 8px; border-bottom: 1px solid #f3f4f6; }
  tr:nth-child(even) td { background: #fafbfc; }
  .green { color: #059669; }
  .red { color: #dc2626; }
  .amber { color: #d97706; }
  .tag-green { font-size: 7pt; font-weight: 600; color: #059669; background: #d1fae5; padding: 1px 5px; border-radius: 2px; margin-left: 4px; }
  .two-col { display: flex; gap: 16px; }
  .two-col > div { flex: 1; }
  .disclaimer { font-size: 7pt; color: #9ca3af; border-top: 1px solid #e5e7eb; padding-top: 8px; margin-top: 20px; line-height: 1.4; }
  .confidential { font-size: 7pt; text-transform: uppercase; letter-spacing: 2px; color: #d1d5db; font-weight: 600; text-align: center; margin-top: 6px; }
  svg { margin: 6px 0 10px; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .no-print { display: none; }
  }
</style>
</head>
<body>

<!-- Header -->
<div class="header">
  <div>
    <h1>Options Analysis Report<span class="header-badge">${isMultiLeg ? "Multi-Leg Strategy" : optionType.toUpperCase()}</span></h1>
  </div>
  <div class="header-sub">
    Generated: ${dateStr} ${timeStr}<br/>
    ${c.K > 0 ? `$${c.K} Strike` : ""} · Exp: ${expirationDate} · ${Math.round(c.T * 365)}d to expiry
  </div>
</div>

<!-- Position Summary -->
<h2>Position Summary</h2>
<div class="metrics-row">
  <div class="metric"><div class="metric-label">Underlying</div><div class="metric-value">${fmtDollar(c.S)}</div></div>
  <div class="metric"><div class="metric-label">Strike</div><div class="metric-value">${fmtDollar(c.K)}</div></div>
  <div class="metric"><div class="metric-label">Option Type</div><div class="metric-value">${optionType.toUpperCase()}</div></div>
  <div class="metric"><div class="metric-label">Current Price</div><div class="metric-value">${fmtDollar(c.optPx)}</div></div>
  <div class="metric"><div class="metric-label">Implied Vol</div><div class="metric-value">${fmtPct(c.activeIV)}</div></div>
  <div class="metric"><div class="metric-label">Time to Expiry</div><div class="metric-value">${fmt(c.T, 2)}y</div><div class="metric-sub">${Math.round(c.T * 365)} days</div></div>
</div>
<div class="metrics-row">
  <div class="metric"><div class="metric-label">Investment</div><div class="metric-value">${fmtDollar(c.investment)}</div></div>
  <div class="metric"><div class="metric-label">Contracts</div><div class="metric-value">${c.numContracts}x</div><div class="metric-sub">@ ${fmtDollar(c.entryOptionPrice)} entry</div></div>
  <div class="metric"><div class="metric-label">Principal Deployed</div><div class="metric-value">${fmtDollar(c.principal)}</div></div>
  <div class="metric"><div class="metric-label">BS Fair Value</div><div class="metric-value">${fmtDollar(c.bsCurrent.price)}</div><div class="metric-sub">${c.bsCurrent.price > c.optPx ? "Undervalued" : "Overvalued"} by ${fmtDollar(Math.abs(c.bsCurrent.price - c.optPx))}</div></div>
  <div class="metric"><div class="metric-label">Max Loss</div><div class="metric-value red">${fmtDollar(c.principal)}</div></div>
  <div class="metric"><div class="metric-label">Breakeven (Expiry)</div><div class="metric-value">${fmtDollar(optionType === "call" ? c.K + c.entryOptionPrice : c.K - c.entryOptionPrice)}</div></div>
</div>

<!-- Greeks -->
<h2>Greeks</h2>
<div class="metrics-row">
  ${[
    { label: "Delta", val: c.current.delta, desc: "$/1 stock move" },
    { label: "Gamma", val: c.current.gamma, desc: "Delta change per $1" },
    { label: "Theta", val: c.current.theta, desc: "Daily time decay" },
    { label: "Vega", val: c.current.vega, desc: "Per 1% IV change" },
    { label: "Rho", val: c.current.rho, desc: "Per 1% rate change" },
  ].map(g => `<div class="metric"><div class="metric-label">${g.label}</div><div class="metric-value">${fmt(g.val, 4)}</div><div class="metric-sub">${g.desc}</div></div>`).join("")}
</div>
<div class="two-col">
  <div>${greekCharts[0].svg}${greekCharts[1].svg}</div>
  <div>${greekCharts[2].svg}${greekCharts[3].svg}</div>
</div>

<!-- Scenario Analysis -->
<h2>Scenario Analysis</h2>
<div class="section-desc">Entry @ ${fmtDollar(c.droppedPrice)} (${expectedDrop.value}% drop) · Rebound target: ${fmtDollar(c.targetRebound)} · Eval: ${c.evalDateStr}</div>
<div class="metrics-row">
  <div class="metric"><div class="metric-label">Option @ Eval</div><div class="metric-value">${fmtDollar(c.evalBS.price)}</div></div>
  <div class="metric"><div class="metric-label">Position P&L</div><div class="metric-value ${c.evalPnl >= 0 ? "green" : "red"}">${fmtPnl(c.evalPnl)}</div></div>
  <div class="metric"><div class="metric-label">Return</div><div class="metric-value ${c.evalPnlPct >= 0 ? "green" : "red"}">${fmtPnlPct(c.evalPnlPct)}</div></div>
</div>

<!-- P&L Curves -->
<h3>P&L Curves — ${c.numContracts} Contract(s)</h3>
${pnlChart}

<!-- Trade Lifecycle -->
<h3>Trade Lifecycle</h3>
<div class="section-desc">${fmtDollar(c.S)} → ${fmtDollar(c.droppedPrice)} (entry) → ${fmtDollar(c.targetRebound)} (eval)</div>
${lifecycleChart}

<!-- P&L Surface -->
<div class="page-break"></div>
<h2>P&L Surface — Price × Time</h2>
<div class="section-desc">${c.numContracts}x contracts · Entry: ${fmtDollar(c.entryOptionPrice)}</div>
<table>
  <thead><tr><th style="text-align:left">Stock</th>${c.surfaceTimeSteps.map(d => `<th>${d === 0 ? "Entry" : d >= c.entryTotalDays ? "Expiry" : `+${d}d`}</th>`).join("")}</tr></thead>
  <tbody>
    ${c.pnlSurface.map(row => `<tr><td style="text-align:left;font-weight:500">${fmtDollar(row.stockPrice)} <span style="color:#9ca3af;font-size:7.5pt">(${row.pricePct >= 0 ? "+" : ""}${fmt(row.pricePct, 0)}%)</span></td>${c.surfaceTimeSteps.map(d => {
      const pnl = row[`pnl_${d}`] || 0;
      return `<td class="${pnl >= 0 ? "green" : "red"}">${pnl >= 0 ? "+" : ""}${(pnl / 1000).toFixed(1)}k</td>`;
    }).join("")}</tr>`).join("")}
  </tbody>
</table>

<!-- IV Sensitivity -->
<h2>IV Sensitivity Matrix</h2>
<div class="section-desc">Option price at Stock × IV combinations · Current: ${fmtDollar(c.optPx)}</div>
<table>
  <thead><tr><th style="text-align:left">Stock</th>${c.ivSteps.map(iv => `<th>IV ${iv >= 0 ? "+" : ""}${iv}%</th>`).join("")}</tr></thead>
  <tbody>
    ${c.ivMatrix.map(row => `<tr><td style="text-align:left;font-weight:500">${fmtDollar(row.stockPrice)} <span style="color:#9ca3af;font-size:7.5pt">(${row.pricePct >= 0 ? "+" : ""}${row.pricePct}%)</span></td>${c.ivSteps.map(iv => {
      const pnl = row[`pnl_${iv}`] || 0;
      return `<td class="${pnl >= 0 ? "green" : "red"}">${fmtDollar(row[`iv_${iv}`])}</td>`;
    }).join("")}</tr>`).join("")}
  </tbody>
</table>

<!-- Quick Scenarios -->
<h2>Quick Scenarios</h2>
<table>
  <thead><tr><th style="text-align:left">Stock Move</th><th>Stock Price</th><th>Option Value</th><th>P&L ($)</th><th>P&L (%)</th></tr></thead>
  <tbody>
    ${[25, 50, 75, 100, 150, 200, 300, 500].map(pct => {
      const simS = c.droppedPrice * (1 + pct / 100);
      const simBS = blackScholes(simS, c.K, c.T, c.r, c.activeIV, optionType, c.q);
      const pnl = (simBS.price - c.entryOptionPrice) * 100 * c.numContracts;
      const ret = c.entryOptionPrice > 0 ? (simBS.price - c.entryOptionPrice) / c.entryOptionPrice : 0;
      return `<tr><td style="text-align:left;font-weight:500">+${pct}%</td><td>${fmtDollar(simS)}</td><td>${fmtDollar(simBS.price)}</td><td class="${pnl >= 0 ? "green" : "red"}" style="font-weight:600">${fmtPnl(pnl)}</td><td class="${ret >= 0 ? "green" : "red"}">${fmtPnlPct(ret)}</td></tr>`;
    }).join("")}
  </tbody>
</table>

${isMultiLeg ? `
<!-- Multi-Leg Strategy -->
<div class="page-break"></div>
<h2>Multi-Leg Strategy</h2>
<div class="metrics-row">
  <div class="metric"><div class="metric-label">Net Cost</div><div class="metric-value">${fmtDollar(Math.abs(sc.netCost))}</div><div class="metric-sub">${sc.netCost > 0 ? "Net Debit" : "Net Credit"}</div></div>
  <div class="metric"><div class="metric-label">Max Profit (Expiry)</div><div class="metric-value green">${sc.maxProfit > 100000 ? "Unlimited" : fmtDollar(sc.maxProfit)}</div></div>
  <div class="metric"><div class="metric-label">Max Loss (Expiry)</div><div class="metric-value red">${fmtDollar(sc.maxLoss)}</div></div>
  <div class="metric"><div class="metric-label">Breakeven(s)</div><div class="metric-value">${sc.breakevens.length > 0 ? sc.breakevens.map(b => fmtDollar(b)).join(", ") : "—"}</div></div>
</div>
<h3>Leg Details</h3>
<table>
  <thead><tr><th style="text-align:left">#</th><th>Type</th><th>Dir</th><th>Strike</th><th>Qty</th><th>Premium</th><th>BS Price</th></tr></thead>
  <tbody>
    ${sc.enrichedLegs.map((l, i) => `<tr><td style="text-align:left">${i + 1}</td><td>${l.type.toUpperCase()}</td><td style="font-weight:600;${l.dir === "long" ? "color:#059669" : "color:#dc2626"}">${l.dir.toUpperCase()}</td><td>${fmtDollar(l.strike)}</td><td>${l.qty}x</td><td>${fmtDollar(l.effectivePremium)}</td><td>${fmtDollar(l.bs.price)}</td></tr>`).join("")}
  </tbody>
</table>
<div class="metrics-row">
  <div class="metric"><div class="metric-label">Position Delta</div><div class="metric-value">${fmt(sc.combinedGreeks.delta, 2)}</div></div>
  <div class="metric"><div class="metric-label">Position Gamma</div><div class="metric-value">${fmt(sc.combinedGreeks.gamma, 2)}</div></div>
  <div class="metric"><div class="metric-label">Position Theta</div><div class="metric-value">${fmt(sc.combinedGreeks.theta, 2)}</div></div>
  <div class="metric"><div class="metric-label">Position Vega</div><div class="metric-value">${fmt(sc.combinedGreeks.vega, 2)}</div></div>
</div>
<h3>Combined P&L Curves</h3>
${strategyChart}
` : ""}

${rollOptCharts}

<!-- Risk Disclosure -->
<div class="disclaimer">
  <strong>DISCLAIMER:</strong> This report is generated from a Black-Scholes model for educational and analytical purposes only. Actual option prices depend on market conditions, liquidity, bid-ask spreads, and factors not captured in BS pricing (skew, term structure, jumps). All Greeks and projections are theoretical estimates. This does not constitute investment advice. Past performance is not indicative of future results. Options trading involves substantial risk of loss and is not appropriate for all investors.
</div>
<div class="confidential">CONFIDENTIAL — FOR INTERNAL USE ONLY</div>

<script>
  // Auto-trigger print dialog
  window.onload = function() { setTimeout(function() { window.print(); }, 500); };
</script>
</body>
</html>`;

    // Open in new window
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
    // Also offer direct download
    const a = document.createElement("a");
    a.href = url;
    a.download = `options-report-${dateStr}.html`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }, [c, calculations, legs, strategyCalcs, compareMode, optimizerCalcs,
      optionType, expirationDate, expectedDrop.value, optStrike, optType,
      rollIntoStrike, optPeakPrice, optPeakDay, optFinalPrice, optRollSlippage]);

  return (
    <div style={{ minHeight: "100vh", background: "#0a0c10", color: "#c8ccd4", fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', monospace" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        input[type="number"], input[type="date"], input[type="text"], select {
          background: #12151c; border: 1px solid #1e2330; color: #e0e4ec;
          padding: 8px 12px; border-radius: 6px; font-family: 'JetBrains Mono', monospace;
          font-size: 13px; width: 100%; outline: none; transition: border-color 0.2s;
        }
        input:focus, select:focus { border-color: #3b82f6; }
        input::placeholder { color: #3a4050; }
        input::-webkit-inner-spin-button { opacity: 0.3; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: #0a0c10; }
        ::-webkit-scrollbar-thumb { background: #1e2330; border-radius: 3px; }
        .green { color: #22c55e; } .red { color: #ef4444; } .blue { color: #3b82f6; } .amber { color: #f59e0b; }
        .tab-btn { padding: 8px 14px; background: transparent; border: none; color: #5a6070; font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 500; cursor: pointer; border-bottom: 2px solid transparent; transition: all 0.2s; text-transform: uppercase; letter-spacing: 0.8px; }
        .tab-btn:hover { color: #8890a0; }
        .tab-btn.active { color: #3b82f6; border-bottom-color: #3b82f6; }
        .card { background: #0f1118; border: 1px solid #1a1d28; border-radius: 10px; padding: 20px; }
        .metric-box { background: #12151c; border: 1px solid #1a1d28; border-radius: 8px; padding: 12px 16px; }
        .label { font-size: 10px; text-transform: uppercase; letter-spacing: 1.5px; color: #4a5060; margin-bottom: 4px; }
        .value { font-size: 18px; font-weight: 600; color: #e0e4ec; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; }
        th { text-align: right; padding: 8px 12px; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #4a5060; border-bottom: 1px solid #1a1d28; font-weight: 500; position: sticky; top: 0; background: #0f1118; }
        th:first-child { text-align: left; }
        td { text-align: right; padding: 6px 12px; border-bottom: 1px solid #111320; font-variant-numeric: tabular-nums; }
        td:first-child { text-align: left; }
        tr:hover td { background: #12151c; }
        .input-group { display: flex; flex-direction: column; gap: 4px; }
        .input-label { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #5a6070; }
        .scenario-header { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: #5a6070; font-weight: 600; }
        .divider { flex: 1; height: 1px; background: #1a1d28; }
        .toggle-btn { background: #12151c; border: 1px solid #1e2330; color: #5a6070; padding: 6px 14px; border-radius: 6px; font-family: 'JetBrains Mono', monospace; font-size: 11px; cursor: pointer; transition: all 0.2s; }
        .toggle-btn:hover { border-color: #3b82f6; color: #8890a0; }
        .toggle-btn.active { border-color: #f59e0b; color: #f59e0b; background: #f59e0b10; }
        .btn { background: #1a1d28; border: 1px solid #252a38; color: #8890a0; padding: 6px 14px; border-radius: 6px; font-family: 'JetBrains Mono', monospace; font-size: 11px; cursor: pointer; transition: all 0.15s; }
        .btn:hover { background: #252a38; color: #e0e4ec; }
        .btn-primary { background: #3b82f620; border-color: #3b82f640; color: #3b82f6; }
        .btn-primary:hover { background: #3b82f630; }
        .btn-danger { background: #ef444410; border-color: #ef444430; color: #ef4444; padding: 4px 8px; font-size: 10px; }
        .btn-danger:hover { background: #ef444420; }
        .override-input { border-color: #f59e0b40 !important; }
      `}</style>

      {/* Header */}
      <div style={{ padding: "16px 28px 0", borderBottom: "1px solid #1a1d28" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#3b82f6", boxShadow: "0 0 12px #3b82f680" }} />
            <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 18, fontWeight: 700, color: "#e0e4ec", letterSpacing: "-0.5px" }}>OPTIONS LAB</span>
            <span style={{ fontSize: 10, color: "#3b82f6", background: "#3b82f615", padding: "2px 8px", borderRadius: 4, letterSpacing: "1px" }}>v0.5</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ fontSize: 11, color: "#4a5060" }}>{optionType.toUpperCase()} · ${strikePrice.value} Strike · {expirationDate}</div>
            <button className="btn btn-primary" onClick={generateReport} style={{ padding: "6px 16px", fontSize: 10, display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 13 }}>↓</span> Download Report
            </button>
          </div>
        </div>
        <div style={{ display: "flex", gap: 0, overflowX: "auto" }}>
          {tabs.map(t => (
            <button key={t.id} className={`tab-btn ${activeTab === t.id ? "active" : ""}`} onClick={() => setActiveTab(t.id)}>{t.label}</button>
          ))}
        </div>
      </div>

      <div style={{ padding: "20px 28px", maxWidth: 1440, margin: "0 auto" }}>
        {/* ─── INPUT PANEL ─── */}
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="scenario-header">
            <span>Position Parameters</span>
            <div className="divider" />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10, marginTop: 10 }}>
            <div className="input-group">
              <span className="input-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                Stock Price
                {livePrice != null && livePrice > 0 && (
                  <span style={{ fontSize: 7, fontWeight: 600, color: "#22c55e", background: "#22c55e15", padding: "1px 5px", borderRadius: 3, letterSpacing: "0.5px" }}>
                    ● LIVE{livePriceSymbol ? ` ${livePriceSymbol}` : ""}
                  </span>
                )}
              </span>
              <input type="number" value={stockPrice.display} onChange={stockPrice.onChange} onBlur={stockPrice.onBlur} step="0.5" style={livePrice ? { borderColor: "#22c55e30" } : {}} />
            </div>
            <NumInput label="Strike Price" input={strikePrice} step="0.5" />
            <div className="input-group">
              <span className="input-label">Option Type</span>
              <select value={optionType} onChange={e => setOptionType(e.target.value)}>
                <option value="call">Call</option>
                <option value="put">Put</option>
              </select>
            </div>
            <NumInput label="Current Opt Price" input={currentOptionPrice} step="0.1" />
            <div className="input-group">
              <span className="input-label">Expiration</span>
              <input type="date" value={expirationDate} onChange={e => setExpirationDate(e.target.value)} />
            </div>
            <NumInput label="Risk-Free Rate" input={riskFreeRate} step="0.005" />
            <NumInput label="Div Yield" input={dividendYield} step="0.005" placeholder="0" />
            <NumInput label="Expected Drop %" input={expectedDrop} step="1" />
            <div className="input-group">
              <span className="input-label">Entry Date</span>
              <input type="date" value={entryDate} onChange={e => setEntryDate(e.target.value)} style={entryDate ? { borderColor: "#f59e0b40" } : {}} />
            </div>
            <NumInput label="Investment $" input={investmentAmount} step="1000" min="100" />
            <NumInput label="IV Override %" input={ivOverride} step="1" placeholder="Auto" />
            <NumInput label="Entry Opt Price" input={targetEntryOptionPrice} step="0.1" placeholder="Auto" />
            <NumInput label="Rebound Target" input={reboundTarget} step="0.5" placeholder={`$${stockPrice.value}`} />
          </div>
        </div>

        {/* ─── SAVE/LOAD BAR ─── */}
        <div className="card" style={{ marginBottom: 20, padding: "12px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "1px", color: "#4a5060", fontWeight: 600 }}>Scenarios</span>
            <input type="text" value={scenarioName} onChange={e => setScenarioName(e.target.value)} placeholder="Scenario name..." style={{ maxWidth: 200 }} />
            <button className="btn btn-primary" onClick={saveScenario}>Save</button>
            {savedScenarios.map(name => (
              <div key={name} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <button className="btn" onClick={() => loadScenario(name)}>{name}</button>
                <button className="btn btn-danger" onClick={() => deleteScenario(name)}>×</button>
              </div>
            ))}
            {saveStatus && <span style={{ fontSize: 11, color: "#22c55e" }}>{saveStatus}</span>}
          </div>
        </div>

        {/* ─── MARKET GREEKS (collapsible) ─── */}
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="scenario-header">
            <span>Market Greeks</span>
            <div className="divider" />
            <button className={`toggle-btn ${showMarketGreeks ? "active" : ""}`} onClick={() => setShowMarketGreeks(!showMarketGreeks)}>
              {showMarketGreeks ? "▾ Active" : "▸ Override"}
            </button>
          </div>
          {showMarketGreeks && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10, marginTop: 10 }}>
              {[
                { label: "Delta", input: mktDelta, step: "0.01", ph: c.bsCurrent.delta },
                { label: "Gamma", input: mktGamma, step: "0.0001", ph: c.bsCurrent.gamma },
                { label: "Theta", input: mktTheta, step: "0.01", ph: c.bsCurrent.theta },
                { label: "Vega", input: mktVega, step: "0.01", ph: c.bsCurrent.vega },
                { label: "Rho", input: mktRho, step: "0.01", ph: c.bsCurrent.rho },
                { label: "IV %", input: mktIV, step: "0.5", ph: c.currentIV * 100 },
              ].map(g => (
                <div key={g.label} className="input-group">
                  <span className="input-label" style={{ color: g.input.value != null ? "#f59e0b" : undefined }}>{g.label}</span>
                  <input type="number" className={g.input.value != null ? "override-input" : ""} value={g.input.raw} onChange={g.input.onChange} step={g.step} placeholder={fmt(g.ph, 4)} />
                  <span style={{ fontSize: 9, color: "#3a4050" }}>BS: {fmt(g.ph, 4)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ─── TAB: SCENARIO ─── */}
        {activeTab === "scenario" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10 }}>
              {[
                { label: "Implied Volatility", value: fmtPct(c.currentIV), cls: "blue", sub: c.greekOverrides.iv ? "from market input" : "from market price", badge: c.greekOverrides.iv },
                { label: "BS Fair Value", value: fmtDollar(c.bsCurrent.price), sub: `${c.bsCurrent.price > c.optPx ? "Under" : "Over"}valued by ${fmtDollar(Math.abs(c.bsCurrent.price - c.optPx))}`, subColor: c.bsCurrent.price > c.optPx ? "#22c55e" : "#ef4444" },
                { label: "Time to Expiry", value: `${fmt(c.T, 2)} yrs`, sub: `${c.totalDays} days` },
                { label: "Entry Date", value: c.daysToEntry > 0 ? `+${Math.round(c.daysToEntry)}d` : "Today", cls: "amber", sub: c.daysToEntry > 0 ? `${c.entryDateStr} · T at entry: ${fmt(c.T_entry, 2)}y` : "No entry date set" },
                { label: "Dropped Price", value: fmtDollar(c.droppedPrice), cls: "red", sub: `-${expectedDrop.value}% from $${stockPrice.value}` },
                { label: "Option @ Entry", value: fmtDollar(c.entryOptionPrice), cls: "green", sub: `Entry IV: ${fmtPct(c.entryIV)} · T: ${fmt(c.T_entry, 2)}y` },
              ].map((m, i) => (
                <div key={i} className="metric-box">
                  <div className="label">{m.label} {m.badge && <OverrideBadge />}</div>
                  <div className={`value ${m.cls || ""}`}>{m.value}</div>
                  <div style={{ fontSize: 10, color: m.subColor || "#4a5060", marginTop: 2 }}>{m.sub}</div>
                </div>
              ))}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              {[
                { title: "CURRENT STATE", color: "#3b82f6", data: c.current, price: c.S, optPrice: c.optPx, hasOvr: true },
                { title: "AT EXPECTED DROP", color: "#ef4444", data: c.entryGreeks, price: c.droppedPrice, optPrice: c.entryOptionPrice },
              ].map((sc, idx) => (
                <div key={idx} className="card" style={{ borderTop: `2px solid ${sc.color}` }}>
                  <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "1.5px", color: sc.color, marginBottom: 14, fontWeight: 600 }}>{sc.title}</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <div><div className="label">Stock</div><div style={{ fontSize: 16, fontWeight: 600, color: "#e0e4ec" }}>{fmtDollar(sc.price)}</div></div>
                    <div><div className="label">Option</div><div style={{ fontSize: 16, fontWeight: 600, color: "#e0e4ec" }}>{fmtDollar(sc.optPrice)}</div></div>
                    {["delta", "gamma", "theta", "vega"].map(gk => (
                      <div key={gk}><div className="label">{gk}{sc.hasOvr && c.greekOverrides[gk] && <OverrideBadge />}</div><div style={{ fontSize: 14, color: "#e0e4ec" }}>{fmt(sc.data[gk], 4)}</div></div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* P&L Explorer — interactive price × date calculator */}
            <div className="card" style={{ borderTop: "2px solid #22c55e" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "1.5px", color: "#22c55e", fontWeight: 600 }}>P&L Explorer</div>
                <div style={{ fontSize: 11, color: "#4a5060" }}>{fmtDollar(c.investment)} → {c.numContracts} contracts ({fmtDollar(c.principal)} deployed{c.unusedCash > 0 ? ` · ${fmtDollar(c.unusedCash)} remainder` : ""})</div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                {/* Left: sliders */}
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  {/* Stock price slider */}
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                      <span className="input-label">Target Stock Price</span>
                      <span style={{ fontSize: 16, fontWeight: 700, color: "#e0e4ec" }}>{fmtDollar(c.targetRebound)}</span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={c.sliderMax}
                      step={Math.max(1, Math.round(c.sliderMax / 500))}
                      value={reboundTarget.value || c.S}
                      onChange={e => reboundTarget.set(+e.target.value)}
                      style={{ width: "100%", accentColor: "#22c55e", cursor: "pointer" }}
                    />
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#3a4050", marginTop: 2 }}>
                      <span>$1</span>
                      <span style={{ color: "#4a5060" }}>Current: {fmtDollar(c.S)}</span>
                      <span>{fmtDollar(c.sliderMax)}</span>
                    </div>
                  </div>

                  {/* Evaluation date slider */}
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                      <span className="input-label">Evaluation Date (from entry)</span>
                      <span style={{ fontSize: 14, fontWeight: 600, color: "#e0e4ec" }}>
                        {c.evalDateStr}
                        <span style={{ color: "#4a5060", fontWeight: 400, marginLeft: 8, fontSize: 11 }}>
                          {c.clampedEvalDays === 0 ? "at entry" : c.clampedEvalDays >= c.entryTotalDays ? "expiry" : `+${c.clampedEvalDays}d`}
                        </span>
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={c.entryTotalDays}
                      step={1}
                      value={c.clampedEvalDays}
                      onChange={e => setEvalDays(+e.target.value)}
                      style={{ width: "100%", accentColor: "#3b82f6", cursor: "pointer" }}
                    />
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#3a4050", marginTop: 2 }}>
                      <span>Entry{c.daysToEntry > 0 ? ` (${c.entryDateStr})` : ""}</span>
                      <span style={{ color: "#4a5060" }}>{Math.round(c.entryTotalDays / 2)}d post-entry</span>
                      <span>Expiry ({c.entryTotalDays}d)</span>
                    </div>
                  </div>

                  {/* Time remaining info */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <div className="metric-box" style={{ padding: "8px 12px" }}>
                      <div className="label">Time to Expiry</div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: "#e0e4ec" }}>{fmt(c.evalT, 3)} yrs</div>
                      <div style={{ fontSize: 10, color: "#4a5060" }}>{Math.round(c.evalT * 365)} days from eval</div>
                    </div>
                    <div className="metric-box" style={{ padding: "8px 12px" }}>
                      <div className="label">Post-Entry Elapsed</div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: "#f59e0b" }}>{fmtPct(c.entryTotalDays > 0 ? c.clampedEvalDays / c.entryTotalDays : 0)}</div>
                      <div style={{ fontSize: 10, color: "#4a5060" }}>{c.clampedEvalDays} of {c.entryTotalDays} days</div>
                    </div>
                  </div>
                </div>

                {/* Right: results */}
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {/* Investment breakdown */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                    <div className="metric-box" style={{ padding: "8px 12px" }}>
                      <div className="label">Contracts</div>
                      <div style={{ fontSize: 16, fontWeight: 600, color: "#e0e4ec" }}>{c.numContracts}</div>
                      <div style={{ fontSize: 9, color: "#3a4050" }}>@ {fmtDollar(c.entryOptionPrice)}/ct</div>
                    </div>
                    <div className="metric-box" style={{ padding: "8px 12px" }}>
                      <div className="label">Principal</div>
                      <div style={{ fontSize: 16, fontWeight: 600, color: "#e0e4ec" }}>{fmtDollar(c.principal)}</div>
                      <div style={{ fontSize: 9, color: "#3a4050" }}>deployed</div>
                    </div>
                    <div className="metric-box" style={{ padding: "8px 12px" }}>
                      <div className="label">Option Value</div>
                      <div style={{ fontSize: 16, fontWeight: 600, color: "#e0e4ec" }}>{fmtDollar(c.evalBS.price)}</div>
                      <div style={{ fontSize: 9, color: "#3a4050" }}>per contract</div>
                    </div>
                  </div>

                  {/* Position value bar: principal vs net vs profit */}
                  {(() => {
                    const positionValue = c.evalBS.price * 100 * c.numContracts;
                    const profit = positionValue - c.principal;
                    const profitPct = c.principal > 0 ? profit / c.principal : 0;
                    const isProfit = profit >= 0;
                    return (
                      <div style={{ padding: "14px 18px", background: "#12151c", borderRadius: 8, border: "1px solid #1a1d28" }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, textAlign: "center" }}>
                          <div>
                            <div className="label">Principal</div>
                            <div style={{ fontSize: 16, fontWeight: 600, color: "#e0e4ec", marginTop: 2 }}>{fmtDollar(c.principal)}</div>
                          </div>
                          <div>
                            <div className="label">Net Position</div>
                            <div style={{ fontSize: 16, fontWeight: 600, color: "#3b82f6", marginTop: 2 }}>{fmtDollar(positionValue)}</div>
                          </div>
                          <div>
                            <div className="label">Profit</div>
                            <div style={{ fontSize: 16, fontWeight: 600, color: isProfit ? "#22c55e" : "#ef4444", marginTop: 2 }}>
                              {fmtPnl(profit)}
                            </div>
                          </div>
                        </div>
                        {/* Visual bar */}
                        <div style={{ marginTop: 10, height: 8, background: "#1a1d28", borderRadius: 4, overflow: "hidden", position: "relative" }}>
                          {(() => {
                            const maxVal = Math.max(c.principal, positionValue);
                            const principalW = maxVal > 0 ? (c.principal / maxVal) * 100 : 50;
                            const posW = maxVal > 0 ? (positionValue / maxVal) * 100 : 50;
                            return (<>
                              <div style={{ position: "absolute", top: 0, left: 0, height: "100%", width: `${principalW}%`, background: "#4a506040", borderRadius: 4 }} />
                              <div style={{ position: "absolute", top: 0, left: 0, height: "100%", width: `${posW}%`, background: isProfit ? "#22c55e60" : "#ef444460", borderRadius: 4 }} />
                            </>);
                          })()}
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 11 }}>
                          <span style={{ color: "#4a5060" }}>{fmtPnlPct(profitPct)} return</span>
                          <span style={{ color: "#4a5060" }}>
                            {c.evalDateStr} · {fmtDollar(c.targetRebound)} stock
                          </span>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Greeks at eval point */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6 }}>
                    {[
                      { label: "Delta", val: c.evalBS.delta, color: "#3b82f6" },
                      { label: "Gamma", val: c.evalBS.gamma, color: "#8b5cf6" },
                      { label: "Theta", val: c.evalBS.theta, color: "#ef4444" },
                      { label: "Vega", val: c.evalBS.vega, color: "#22c55e" },
                    ].map(g => (
                      <div key={g.label} style={{ textAlign: "center", padding: "6px 4px", background: "#12151c", borderRadius: 6, border: "1px solid #1a1d28" }}>
                        <div style={{ fontSize: 9, color: "#4a5060", textTransform: "uppercase", letterSpacing: "0.5px" }}>{g.label}</div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: g.color, marginTop: 2 }}>{fmt(g.val, 4)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Trade Lifecycle Chart: Stock + Option + P&L from Now → Entry → Eval */}
            <div className="card">
              <div className="scenario-header">
                <span>Trade Lifecycle</span>
                <div className="divider" />
                <span style={{ fontSize: 10, color: "#4a5060", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
                  {fmtDollar(c.S)} → {fmtDollar(c.droppedPrice)} (entry) → {fmtDollar(c.targetRebound)} (eval) · {c.numContracts}x @ {fmtDollar(c.entryOptionPrice)}
                </span>
              </div>
              {/* Top chart: Stock & Option Price */}
              <div style={{ marginTop: 8, marginBottom: -5 }}>
                <div style={{ fontSize: 9, color: "#4a5060", textTransform: "uppercase", letterSpacing: "1px", marginBottom: 4, paddingLeft: 20 }}>Stock & Option Price</div>
                <ResponsiveContainer width="100%" height={220}>
                  <ComposedChart data={c.lifecycle} margin={{ top: 10, right: 30, left: 20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1a1d28" />
                    <XAxis
                      dataKey="day" tick={{ fontSize: 9, fill: "#4a5060" }}
                      tickFormatter={d => {
                        if (d === 0) return "Now";
                        if (c.daysToEntry > 0 && Math.abs(d - c.daysToEntry) < (c.daysToEntry + c.clampedEvalDays) / 30) return "Entry";
                        const pt = c.lifecycle.find(p => p.day === d);
                        return pt ? pt.date.slice(5) : `+${d}d`;
                      }}
                    />
                    <YAxis yAxisId="stock" tick={{ fontSize: 9, fill: "#4a5060" }} tickFormatter={v => `$${addCommas(Number(v).toFixed(0))}`} domain={["auto", "auto"]} />
                    <YAxis yAxisId="option" orientation="right" tick={{ fontSize: 9, fill: "#8b5cf6" }} tickFormatter={v => `$${Number(v).toFixed(1)}`} domain={["auto", "auto"]} />
                    <Tooltip
                      contentStyle={{ background: "#12151c", border: "1px solid #1e2330", borderRadius: 6, fontSize: 10, fontFamily: "JetBrains Mono" }}
                      labelFormatter={d => {
                        const pt = c.lifecycle.find(p => p.day === d);
                        const phase = pt?.phase === "pre" ? " (pre-entry)" : " (post-entry)";
                        return pt ? `${pt.date}${phase}` : `Day ${d}`;
                      }}
                      formatter={(v, name) => {
                        if (name === "stock") return [fmtDollar(v), "Stock"];
                        if (name === "option") return [fmtDollar(v), "Option"];
                        return [v, name];
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 10 }} formatter={n => n === "stock" ? "Stock Price" : "Option Price"} />
                    {c.daysToEntry > 0 && (
                      <ReferenceLine x={Math.round(c.daysToEntry)} yAxisId="stock" stroke="#f59e0b" strokeDasharray="5 5" label={{ value: "Entry", position: "top", fill: "#f59e0b", fontSize: 9 }} />
                    )}
                    <ReferenceLine yAxisId="stock" y={c.droppedPrice} stroke="#ef444440" strokeDasharray="3 3" />
                    <ReferenceLine yAxisId="stock" y={c.targetRebound} stroke="#22c55e40" strokeDasharray="3 3" />
                    <Line yAxisId="stock" type="monotone" dataKey="stock" stroke="#3b82f6" strokeWidth={2.5} dot={false} />
                    <Line yAxisId="option" type="monotone" dataKey="option" stroke="#8b5cf6" strokeWidth={2} dot={false} strokeDasharray="6 3" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              {/* Bottom chart: P&L from entry onward */}
              <div style={{ marginTop: 4 }}>
                <div style={{ fontSize: 9, color: "#4a5060", textTransform: "uppercase", letterSpacing: "1px", marginBottom: 4, paddingLeft: 20 }}>Position P&L ({fmtDollar(c.principal)} principal)</div>
                <ResponsiveContainer width="100%" height={180}>
                  <ComposedChart data={c.lifecycle.filter(p => p.phase === "post")} margin={{ top: 10, right: 30, left: 20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="lc-pnl-pos" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#22c55e" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="lc-pnl-neg" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ef4444" stopOpacity={0} />
                        <stop offset="95%" stopColor="#ef4444" stopOpacity={0.2} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1a1d28" />
                    <XAxis
                      dataKey="day" tick={{ fontSize: 9, fill: "#4a5060" }}
                      tickFormatter={d => {
                        if (c.daysToEntry > 0 && Math.abs(d - c.daysToEntry) < 3) return "Entry";
                        const pt = c.lifecycle.find(p => p.day === d);
                        return pt ? pt.date.slice(5) : `+${d}d`;
                      }}
                    />
                    <YAxis tick={{ fontSize: 9, fill: "#4a5060" }} tickFormatter={v => {
                      const abs = Math.abs(v);
                      if (abs >= 1000000) return `${(v/1000000).toFixed(1)}M`;
                      if (abs >= 1000) return `${(v/1000).toFixed(0)}k`;
                      return `$${Number(v).toFixed(0)}`;
                    }} />
                    <Tooltip
                      contentStyle={{ background: "#12151c", border: "1px solid #1e2330", borderRadius: 6, fontSize: 10, fontFamily: "JetBrains Mono" }}
                      labelFormatter={d => {
                        const pt = c.lifecycle.find(p => p.day === d);
                        return pt ? pt.date : `Day ${d}`;
                      }}
                      formatter={(v, name) => {
                        if (name === "pnl") return [fmtPnl(v), "P&L"];
                        if (name === "positionValue") return [fmtDollar(v), "Position"];
                        if (name === "principal") return [fmtDollar(v), "Principal"];
                        return [v, name];
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 10 }} formatter={n => {
                      if (n === "pnl") return "P&L";
                      if (n === "positionValue") return "Position Value";
                      if (n === "principal") return "Principal";
                      return n;
                    }} />
                    <ReferenceLine y={0} stroke="#4a506080" />
                    <Area type="monotone" dataKey="pnl" stroke={c.evalPnl >= 0 ? "#22c55e" : "#ef4444"} fill={c.evalPnl >= 0 ? "url(#lc-pnl-pos)" : "url(#lc-pnl-neg)"} strokeWidth={2.5} dot={false} />
                    <Line type="monotone" dataKey="positionValue" stroke="#3b82f6" strokeWidth={1.5} dot={false} strokeDasharray="4 4" />
                    <Line type="monotone" dataKey="principal" stroke="#4a5060" strokeWidth={1} dot={false} strokeDasharray="2 6" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              {/* Key milestones */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginTop: 10 }}>
                <div style={{ padding: "10px 14px", background: "#12151c", borderRadius: 6, border: "1px solid #1a1d28", borderLeft: "3px solid #e0e4ec" }}>
                  <div style={{ fontSize: 9, color: "#4a5060", textTransform: "uppercase", letterSpacing: "0.5px" }}>Now</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginTop: 6 }}>
                    <div><div style={{ fontSize: 8, color: "#3a4050" }}>Stock</div><div style={{ fontSize: 14, fontWeight: 600, color: "#e0e4ec" }}>{fmtDollar(c.S)}</div></div>
                    <div><div style={{ fontSize: 8, color: "#3a4050" }}>Option</div><div style={{ fontSize: 14, fontWeight: 600, color: "#e0e4ec" }}>{fmtDollar(c.optPx)}</div></div>
                  </div>
                  <div style={{ fontSize: 9, color: "#4a5060", marginTop: 4 }}>T: {fmt(c.T, 2)}y · {new Date().toISOString().split("T")[0]}</div>
                </div>
                <div style={{ padding: "10px 14px", background: "#12151c", borderRadius: 6, border: "1px solid #1a1d28", borderLeft: "3px solid #f59e0b" }}>
                  <div style={{ fontSize: 9, color: "#f59e0b", textTransform: "uppercase", letterSpacing: "0.5px" }}>Entry</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginTop: 6 }}>
                    <div><div style={{ fontSize: 8, color: "#3a4050" }}>Stock</div><div style={{ fontSize: 14, fontWeight: 600, color: "#ef4444" }}>{fmtDollar(c.droppedPrice)}</div></div>
                    <div><div style={{ fontSize: 8, color: "#3a4050" }}>Option</div><div style={{ fontSize: 14, fontWeight: 600, color: "#f59e0b" }}>{fmtDollar(c.entryOptionPrice)}</div></div>
                  </div>
                  <div style={{ fontSize: 9, color: "#4a5060", marginTop: 4 }}>T: {fmt(c.T_entry, 2)}y · {c.entryDateStr}{c.daysToEntry > 0 ? ` (+${Math.round(c.daysToEntry)}d)` : ""}</div>
                </div>
                <div style={{ padding: "10px 14px", background: "#12151c", borderRadius: 6, border: "1px solid #1a1d28", borderLeft: `3px solid ${c.evalPnl >= 0 ? "#22c55e" : "#ef4444"}` }}>
                  <div style={{ fontSize: 9, color: "#22c55e", textTransform: "uppercase", letterSpacing: "0.5px" }}>Evaluation</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginTop: 6 }}>
                    <div><div style={{ fontSize: 8, color: "#3a4050" }}>Stock</div><div style={{ fontSize: 14, fontWeight: 600, color: "#22c55e" }}>{fmtDollar(c.targetRebound)}</div></div>
                    <div><div style={{ fontSize: 8, color: "#3a4050" }}>Option</div><div style={{ fontSize: 14, fontWeight: 600, color: "#22c55e" }}>{fmtDollar(c.evalBS.price)}</div></div>
                  </div>
                  <div style={{ fontSize: 9, color: "#4a5060", marginTop: 4 }}>T: {fmt(c.evalT, 2)}y · {c.evalDateStr} (+{c.clampedEvalDays}d from entry)</div>
                </div>
              </div>
            </div>

            {/* Price × Time P&L Heatmap */}
            <div className="card">
              <div className="scenario-header">
                <span>P&L Surface — Price × Time</span>
                <div className="divider" />
                <span style={{ fontSize: 10, color: "#4a5060", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
                  {c.numContracts}x · Entry: {fmtDollar(c.entryOptionPrice)}
                </span>
              </div>
              <div style={{ overflowX: "auto", marginTop: 12 }}>
                <table>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left" }}>Stock</th>
                      {c.surfaceTimeSteps.map(d => {
                        const isEval = Math.abs(d - c.clampedEvalDays) <= (c.surfaceTimeSteps[1] - c.surfaceTimeSteps[0]) / 2;
                        return (
                          <th key={d} style={{ color: isEval ? "#3b82f6" : d === 0 ? "#e0e4ec" : undefined, fontSize: 9 }}>
                            {d === 0 ? "Entry" : d >= c.entryTotalDays ? "Expiry" : `+${d}d`}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {c.pnlSurface.map((row, i) => {
                      const isCurrentPrice = Math.abs(row.stockPrice - c.S) < (c.surfacePriceSteps[1] - c.surfacePriceSteps[0]) * 0.6;
                      const isTargetPrice = Math.abs(row.stockPrice - c.targetRebound) < (c.surfacePriceSteps[1] - c.surfacePriceSteps[0]) * 0.6;
                      return (
                        <tr key={i}>
                          <td style={{
                            textAlign: "left",
                            fontWeight: isCurrentPrice || isTargetPrice ? 600 : 400,
                            color: isTargetPrice ? "#22c55e" : isCurrentPrice ? "#3b82f6" : "#e0e4ec",
                          }}>
                            {fmtDollar(row.stockPrice)}
                            <span style={{ fontSize: 9, color: "#3a4050", marginLeft: 3 }}>
                              ({row.pricePct >= 0 ? "+" : ""}{fmt(row.pricePct, 0)}%)
                            </span>
                          </td>
                          {c.surfaceTimeSteps.map(d => {
                            const pnl = row[`pnl_${d}`] || 0;
                            const maxPnl = Math.max(...c.pnlSurface.map(r => Math.abs(r[`pnl_${d}`] || 0)), 1);
                            const intensity = Math.min(Math.abs(pnl) / maxPnl, 1) * 0.25;
                            const isEvalCol = Math.abs(d - c.clampedEvalDays) <= (c.surfaceTimeSteps[1] - c.surfaceTimeSteps[0]) / 2;
                            const isHighlight = isEvalCol && (isTargetPrice);
                            return (
                              <td key={d} style={{
                                background: isHighlight
                                  ? (pnl >= 0 ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)")
                                  : (pnl >= 0 ? `rgba(34,197,94,${intensity})` : `rgba(239,68,68,${intensity})`),
                                color: pnl >= 0 ? "#22c55e" : "#ef4444",
                                fontWeight: isHighlight ? 700 : 400,
                                fontSize: 11,
                                border: isHighlight ? "1px solid #22c55e60" : undefined,
                              }}>
                                {pnl >= 0 ? "+" : ""}{(pnl / 1000).toFixed(1)}k
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ fontSize: 10, color: "#3a4050", marginTop: 8 }}>
                Highlighted cell = your selected price ({fmtDollar(c.targetRebound)}) × date ({c.evalDateStr}). {fmtDollar(c.principal)} principal · {c.numContracts} contracts.
              </div>
            </div>

            {/* Timeline: Option Value Journey */}
            <div className="card">
              <div className="scenario-header">
                <span>Option Value Timeline</span>
                <div className="divider" />
                <span style={{ fontSize: 10, color: "#4a5060", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
                  Today ({fmtDollar(c.S)}) → Entry ({fmtDollar(c.droppedPrice)}) → Recovery Scenarios
                </span>
              </div>
              <ResponsiveContainer width="100%" height={340}>
                <ComposedChart data={c.timelineData} margin={{ top: 20, right: 30, left: 20, bottom: 10 }}>
                  <defs>
                    <linearGradient id="tl-pre" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1a1d28" />
                  <XAxis
                    dataKey="day"
                    tick={{ fontSize: 9, fill: "#4a5060" }}
                    tickFormatter={d => {
                      if (d === 0) return "Today";
                      if (c.daysToEntry > 0 && Math.abs(d - c.daysToEntry) < 5) return "Entry";
                      return `+${d}d`;
                    }}
                  />
                  <YAxis tick={{ fontSize: 9, fill: "#4a5060" }} tickFormatter={v => `$${Number(v).toFixed(0)}`} />
                  <Tooltip
                    contentStyle={{ background: "#12151c", border: "1px solid #1e2330", borderRadius: 6, fontSize: 10, fontFamily: "JetBrains Mono" }}
                    labelFormatter={d => {
                      const pt = c.timelineData.find(p => p.day === d);
                      return pt ? `Day ${d} · ${pt.date}` : `Day ${d}`;
                    }}
                    formatter={(v, name) => {
                      const labels = {
                        preEntry: "Pre-Entry",
                        stock_flat: `Flat (${fmtDollar(c.droppedPrice)})`,
                        stock_50pct: "50% Recovery",
                        stock_full: `Full Recovery (${fmtDollar(c.S)})`,
                        stock_target: `Target (${fmtDollar(c.targetRebound)})`,
                      };
                      return [`$${Number(v).toFixed(2)}`, labels[name] || name];
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 10 }} formatter={name => {
                    const labels = {
                      preEntry: "Pre-Entry",
                      stock_flat: `Flat @ ${fmtDollar(c.droppedPrice)}`,
                      stock_50pct: "50% Rebound",
                      stock_full: `Full @ ${fmtDollar(c.S)}`,
                      stock_target: `Target @ ${fmtDollar(c.targetRebound)}`,
                    };
                    return labels[name] || name;
                  }} />
                  {c.daysToEntry > 0 && (
                    <ReferenceLine x={Math.round(c.daysToEntry)} stroke="#f59e0b" strokeDasharray="5 5" label={{ value: "Entry", position: "top", fill: "#f59e0b", fontSize: 10 }} />
                  )}
                  <ReferenceLine y={c.entryOptionPrice} stroke="#22c55e30" strokeDasharray="3 3" />
                  <Area type="monotone" dataKey="preEntry" stroke="#f59e0b" fill="url(#tl-pre)" strokeWidth={2.5} dot={false} connectNulls={false} />
                  <Line type="monotone" dataKey="stock_flat" stroke="#ef4444" strokeWidth={1.5} dot={false} connectNulls={false} strokeDasharray="4 4" />
                  <Line type="monotone" dataKey="stock_50pct" stroke="#f59e0b" strokeWidth={1.5} dot={false} connectNulls={false} strokeDasharray="4 4" />
                  <Line type="monotone" dataKey="stock_full" stroke="#3b82f6" strokeWidth={2} dot={false} connectNulls={false} />
                  <Line type="monotone" dataKey="stock_target" stroke="#22c55e" strokeWidth={2.5} dot={false} connectNulls={false} />
                </ComposedChart>
              </ResponsiveContainer>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginTop: 10 }}>
                {[
                  { label: "Option Now", value: fmtDollar(c.bsCurrent.price), color: "#e0e4ec" },
                  { label: "Option @ Entry", value: fmtDollar(c.entryOptionPrice), color: "#f59e0b" },
                  { label: "Full Recov (Expiry)", value: fmtDollar(blackScholes(c.S, c.K, 0.001, c.r, c.activeIV, optionType, c.q).price), color: "#3b82f6" },
                  { label: "Target (Expiry)", value: fmtDollar(blackScholes(c.targetRebound, c.K, 0.001, c.r, c.activeIV, optionType, c.q).price), color: "#22c55e" },
                ].map(m => (
                  <div key={m.label} className="metric-box" style={{ padding: "8px 12px" }}>
                    <div className="label">{m.label}</div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: m.color }}>{m.value}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <div className="scenario-header"><span>Capital & Risk</span><div className="divider" /></div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10, marginTop: 10 }}>
                <div className="metric-box"><div className="label">Investment</div><div className="value">{fmtDollar(c.investment)}</div></div>
                <div className="metric-box"><div className="label">Principal Deployed</div><div className="value">{fmtDollar(c.principal)}</div><div style={{ fontSize: 10, color: "#4a5060" }}>{c.numContracts} contracts</div></div>
                <div className="metric-box"><div className="label">Max Loss</div><div className="value red">{fmtDollar(c.principal)}</div></div>
                <div className="metric-box"><div className="label">Breakeven (Expiry)</div><div className="value">{fmtDollar(optionType === "call" ? c.K + c.entryOptionPrice : c.K - c.entryOptionPrice)}</div></div>
                <div className="metric-box"><div className="label">Intrinsic</div><div className="value">{fmtDollar(Math.max(0, optionType === "call" ? c.droppedPrice - c.K : c.K - c.droppedPrice))}</div></div>
                <div className="metric-box"><div className="label">Time Value</div><div className="value">{fmtDollar(Math.max(0, c.entryOptionPrice - Math.max(0, optionType === "call" ? c.droppedPrice - c.K : c.K - c.droppedPrice)))}</div></div>
              </div>
            </div>
          </div>
        )}

        {/* ─── TAB: RETURNS ─── */}
        {activeTab === "returns" && (
          <div className="card">
            <div className="scenario-header">
              <span>Return Simulation</span><div className="divider" />
              <span style={{ fontSize: 10, color: "#4a5060", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>Entry: {fmtDollar(c.entryOptionPrice)} @ {fmtDollar(c.droppedPrice)} · {c.numContracts}x</span>
            </div>
            <div style={{ overflowX: "auto", maxHeight: 550, marginTop: 10 }}>
              <table>
                <thead><tr>
                  <th style={{ textAlign: "left" }}>Stock</th><th>Δ%</th><th>Opt (Now)</th><th>P&L (Now)</th><th>Opt (6m)</th><th>P&L (6m)</th><th>Opt (1y)</th><th>P&L (1y)</th><th>Ret%</th><th>Δ</th>
                </tr></thead>
                <tbody>
                  {c.scenarios.map((row, i) => {
                    const isEntry = Math.abs(row.stockPrice - c.droppedPrice) < (c.maxRebound - c.minRebound) / 40;
                    return (
                      <tr key={i} style={isEntry ? { background: "#3b82f610" } : {}}>
                        <td style={{ textAlign: "left", color: "#e0e4ec", fontWeight: isEntry ? 600 : 400 }}>{fmtDollar(row.stockPrice)}{isEntry && <span style={{ color: "#3b82f6", fontSize: 9, marginLeft: 4 }}>▸</span>}</td>
                        <td style={{ color: row.stockPrice >= c.droppedPrice ? "#22c55e" : "#ef4444" }}>{fmt((row.stockPrice - c.droppedPrice) / c.droppedPrice * 100, 1)}%</td>
                        <td>{fmtDollar(row.price_0)}</td>
                        <td style={{ color: (row.pnl_0 || 0) >= 0 ? "#22c55e" : "#ef4444", fontWeight: 500 }}>{fmtPnl((row.pnl_0 || 0) * c.numContracts)}</td>
                        <td>{fmtDollar(row["price_0.5"])}</td>
                        <td style={{ color: (row["pnl_0.5"] || 0) >= 0 ? "#22c55e" : "#ef4444" }}>{fmtPnl((row["pnl_0.5"] || 0) * c.numContracts)}</td>
                        <td>{fmtDollar(row.price_1)}</td>
                        <td style={{ color: (row.pnl_1 || 0) >= 0 ? "#22c55e" : "#ef4444" }}>{fmtPnl((row.pnl_1 || 0) * c.numContracts)}</td>
                        <td style={{ color: (row.pnlPct_0 || 0) >= 0 ? "#22c55e" : "#ef4444", fontWeight: 600 }}>{fmtPnlPct(row.pnlPct_0)}</td>
                        <td>{fmt(row.delta_0, 3)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ─── TAB: GREEKS ─── */}
        {activeTab === "greeks" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              {[
                { key: "delta", label: "Delta", color: "#3b82f6", desc: "$/1 stock move" },
                { key: "gamma", label: "Gamma", color: "#8b5cf6", desc: "δ change/1 stock move" },
                { key: "theta", label: "Theta", color: "#ef4444", desc: "Daily decay" },
                { key: "vega", label: "Vega", color: "#22c55e", desc: "Per 1% IV change" },
              ].map(g => (
                <div key={g.key} className="card">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: g.color }}>{g.label}{c.greekOverrides[g.key] && <OverrideBadge />} <span style={{ fontSize: 10, color: "#4a5060", fontWeight: 400 }}>{g.desc}</span></span>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: g.color }}>{fmt(c.current[g.key], 4)}</div>
                      {c.greekOverrides[g.key] && <div style={{ fontSize: 9, color: "#3a4050" }}>BS: {fmt(c.bsCurrent[g.key], 4)}</div>}
                    </div>
                  </div>
                  <ResponsiveContainer width="100%" height={160}>
                    <AreaChart data={c.greeksData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                      <defs><linearGradient id={`g-${g.key}`} x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={g.color} stopOpacity={0.3} /><stop offset="95%" stopColor={g.color} stopOpacity={0} /></linearGradient></defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1a1d28" />
                      <XAxis dataKey="stock" tick={{ fontSize: 9, fill: "#4a5060" }} tickFormatter={v => `$${Number(v).toFixed(0)}`} />
                      <YAxis tick={{ fontSize: 9, fill: "#4a5060" }} tickFormatter={v => Number(v).toFixed(g.key === "gamma" ? 4 : 3)} />
                      <Tooltip contentStyle={{ background: "#12151c", border: "1px solid #1e2330", borderRadius: 6, fontSize: 10, fontFamily: "JetBrains Mono" }} labelFormatter={v => `$${Number(v).toFixed(2)}`} formatter={v => [Number(v).toFixed(4), g.label]} />
                      <ReferenceLine x={c.S} stroke="#3b82f640" strokeDasharray="3 3" />
                      <Area type="monotone" dataKey={g.key} stroke={g.color} fill={`url(#g-${g.key})`} strokeWidth={2} dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ─── TAB: P&L ─── */}
        {activeTab === "pnl" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div className="card">
              <div className="scenario-header"><span>P&L Curves ({c.numContracts}x)</span><div className="divider" /></div>
              <ResponsiveContainer width="100%" height={380}>
                <ComposedChart data={c.pnlData} margin={{ top: 20, right: 30, left: 20, bottom: 10 }}>
                  <defs><linearGradient id="pg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#22c55e" stopOpacity={0.12} /><stop offset="50%" stopColor="#22c55e" stopOpacity={0} /><stop offset="51%" stopColor="#ef4444" stopOpacity={0} /><stop offset="100%" stopColor="#ef4444" stopOpacity={0.12} /></linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1a1d28" />
                  <XAxis dataKey="stock" tick={{ fontSize: 9, fill: "#4a5060" }} tickFormatter={v => `$${Number(v).toFixed(0)}`} />
                  <YAxis tick={{ fontSize: 9, fill: "#4a5060" }} tickFormatter={v => `$${(v / 1000).toFixed(1)}k`} />
                  <Tooltip contentStyle={{ background: "#12151c", border: "1px solid #1e2330", borderRadius: 6, fontSize: 10, fontFamily: "JetBrains Mono" }} labelFormatter={v => `$${Number(v).toFixed(2)}`} formatter={(v, n) => [`$${Number(v).toFixed(0)}`, n]} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <ReferenceLine y={0} stroke="#4a506060" strokeWidth={2} />
                  <ReferenceLine x={c.droppedPrice} stroke="#f59e0b40" strokeDasharray="5 5" />
                  <ReferenceLine x={c.S} stroke="#3b82f640" strokeDasharray="5 5" />
                  <Area type="monotone" dataKey="now" fill="url(#pg)" stroke="none" />
                  <Line type="monotone" dataKey="now" name="Now" stroke="#3b82f6" strokeWidth={2.5} dot={false} />
                  <Line type="monotone" dataKey="sixMonths" name="+6mo" stroke="#8b5cf6" strokeWidth={1.5} dot={false} strokeDasharray="4 4" />
                  <Line type="monotone" dataKey="oneYear" name="+1yr" stroke="#f59e0b" strokeWidth={1.5} dot={false} strokeDasharray="4 4" />
                  <Line type="monotone" dataKey="expiration" name="Expiry" stroke="#ef4444" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div className="card">
              <div className="scenario-header"><span>Quick Scenarios</span><div className="divider" /></div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, marginTop: 10 }}>
                {[25, 50, 75, 100, 150, 200].map(pct => {
                  const simS = c.droppedPrice * (1 + pct / 100);
                  const simBS = blackScholes(simS, c.K, c.T, c.r, c.activeIV, optionType, c.q);
                  const pnl = (simBS.price - c.entryOptionPrice) * 100 * c.numContracts;
                  const ret = c.entryOptionPrice > 0 ? (simBS.price - c.entryOptionPrice) / c.entryOptionPrice : 0;
                  return (
                    <div key={pct} className="metric-box">
                      <div className="label">+{pct}%</div>
                      <div style={{ fontSize: 12, color: "#e0e4ec" }}>{fmtDollar(simS)}</div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: pnl >= 0 ? "#22c55e" : "#ef4444" }}>{fmtPnl(pnl)}</div>
                      <div style={{ fontSize: 10, color: pnl >= 0 ? "#22c55e80" : "#ef444480" }}>{fmtPnlPct(ret)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ─── TAB: COMPARE ─── */}
        {activeTab === "compare" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {/* Mode Toggle */}
            <div style={{ display: "flex", gap: 8 }}>
              <button className={`btn ${compareMode === "compare" ? "btn-primary" : ""}`} onClick={() => setCompareMode("compare")} style={{ padding: "8px 20px" }}>
                Compare Contracts
              </button>
              <button className={`btn ${compareMode === "roll" ? "btn-primary" : ""}`} onClick={() => setCompareMode("roll")} style={{ padding: "8px 20px" }}>
                Roll Planner
              </button>
              <button className={`btn ${compareMode === "optimizer" ? "btn-primary" : ""}`} onClick={() => setCompareMode("optimizer")} style={{ padding: "8px 20px" }}>
                Roll Optimizer
              </button>
            </div>

            {/* ─── COMPARE MODE ─── */}
            {compareMode === "compare" && (<>
            {/* Contract Builder */}
            <div className="card">
              <div className="scenario-header"><span>Option Contracts</span><div className="divider" />
                <span style={{ fontSize: 10, color: "#4a5060", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
                  Stock: {fmtDollar(stockPrice.value)} · IV: {fmtPct(calculations.activeIV)}
                </span>
              </div>
              <div style={{ overflowX: "auto", marginTop: 12 }}>
                <table>
                  <thead><tr>
                    <th style={{ textAlign: "left", width: 20 }}></th>
                    <th style={{ textAlign: "left" }}>Label</th>
                    <th>Type</th>
                    <th>Strike</th>
                    <th>Expiration</th>
                    <th>Premium</th>
                    <th>IV %</th>
                    <th>BS Price</th>
                    <th></th>
                  </tr></thead>
                  <tbody>
                    {compareContracts.map((ct) => {
                      const exp = new Date(ct.expiration);
                      const T = Math.max((exp - new Date()) / (365.25 * 24 * 60 * 60 * 1000), 0.001);
                      const iv = ct.iv > 0 ? ct.iv / 100 : (calculations.activeIV || 0.5);
                      const bs = blackScholes(stockPrice.value, ct.strike, T, riskFreeRate.value, iv, ct.type, dividendYield.value);
                      return (
                        <tr key={ct.id}>
                          <td style={{ textAlign: "left" }}><div style={{ width: 10, height: 10, borderRadius: "50%", background: ct.color }} /></td>
                          <td style={{ textAlign: "left" }}>
                            <input type="text" value={ct.label} onChange={e => setCompareContracts(prev => prev.map(c => c.id === ct.id ? { ...c, label: e.target.value } : c))} style={{ width: 120, padding: "4px 6px", fontSize: 11 }} />
                          </td>
                          <td>
                            <select value={ct.type} onChange={e => setCompareContracts(prev => prev.map(c => c.id === ct.id ? { ...c, type: e.target.value } : c))} style={{ width: 70, padding: "4px 6px", fontSize: 11 }}>
                              <option value="call">Call</option><option value="put">Put</option>
                            </select>
                          </td>
                          <td><input type="number" value={ct.strike} onChange={e => setCompareContracts(prev => prev.map(c => c.id === ct.id ? { ...c, strike: +e.target.value || 0 } : c))} step="5" style={{ width: 80, padding: "4px 6px", fontSize: 11 }} /></td>
                          <td><input type="date" value={ct.expiration} onChange={e => setCompareContracts(prev => prev.map(c => c.id === ct.id ? { ...c, expiration: e.target.value } : c))} style={{ width: 130, padding: "4px 6px", fontSize: 11 }} /></td>
                          <td><input type="number" value={ct.premium || ""} onChange={e => setCompareContracts(prev => prev.map(c => c.id === ct.id ? { ...c, premium: +e.target.value || 0 } : c))} step="0.5" placeholder={fmt(bs.price, 2)} style={{ width: 80, padding: "4px 6px", fontSize: 11 }} /></td>
                          <td><input type="number" value={ct.iv || ""} onChange={e => setCompareContracts(prev => prev.map(c => c.id === ct.id ? { ...c, iv: +e.target.value || 0 } : c))} step="1" placeholder={fmt(calculations.activeIV * 100, 1)} style={{ width: 60, padding: "4px 6px", fontSize: 11 }} /></td>
                          <td style={{ color: "#4a5060" }}>{fmtDollar(bs.price)}</td>
                          <td><button className="btn btn-danger" onClick={() => setCompareContracts(prev => prev.filter(c => c.id !== ct.id))}>×</button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button className="btn" onClick={() => {
                  const newId = compareNextId;
                  setCompareNextId(prev => prev + 1);
                  setCompareContracts(prev => [...prev, {
                    id: newId,
                    label: `Option ${newId}`,
                    type: "call",
                    strike: strikePrice.value,
                    expiration: expirationDate,
                    premium: 0,
                    iv: 0,
                    color: COMPARE_COLORS[(newId - 1) % COMPARE_COLORS.length],
                  }]);
                }}>+ Add Contract</button>
                <button className="btn" onClick={() => {
                  setCompareContracts([]);
                  setCompareNextId(1);
                }} style={{ color: "#ef4444" }}>Clear All</button>
              </div>
            </div>

            {/* Shared Controls */}
            <div className="card">
              <div className="scenario-header"><span>Evaluation Parameters</span><div className="divider" /></div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginTop: 12 }}>
                {/* Target price slider */}
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                    <span className="input-label">Target Stock Price</span>
                    <span style={{ fontSize: 16, fontWeight: 700, color: "#e0e4ec" }}>{fmtDollar(compareTargetPrice || stockPrice.value)}</span>
                  </div>
                  <input type="range" min={1} max={compareCalcs ? compareCalcs.sliderMax : 1000} step={1}
                    value={compareTargetPrice || stockPrice.value}
                    onChange={e => setCompareTargetPrice(+e.target.value)}
                    style={{ width: "100%", accentColor: "#22c55e", cursor: "pointer" }} />
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#3a4050", marginTop: 2 }}>
                    <span>$1</span>
                    <span style={{ color: "#4a5060" }}>Current: {fmtDollar(stockPrice.value)}</span>
                    <span>{fmtDollar(compareCalcs ? compareCalcs.sliderMax : 1000)}</span>
                  </div>
                </div>
                {/* Eval days slider */}
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                    <span className="input-label">Days from Now</span>
                    <span style={{ fontSize: 16, fontWeight: 700, color: "#e0e4ec" }}>
                      {compareEvalDays}d
                      <span style={{ color: "#4a5060", fontWeight: 400, marginLeft: 8, fontSize: 11 }}>
                        ({new Date(Date.now() + compareEvalDays * 86400000).toISOString().split("T")[0]})
                      </span>
                    </span>
                  </div>
                  <input type="range" min={0} max={compareCalcs ? compareCalcs.maxDays : 1000} step={1}
                    value={compareEvalDays}
                    onChange={e => setCompareEvalDays(+e.target.value)}
                    style={{ width: "100%", accentColor: "#3b82f6", cursor: "pointer" }} />
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#3a4050", marginTop: 2 }}>
                    <span>Today</span>
                    <span>{compareCalcs ? `${compareCalcs.maxDays}d (longest expiry)` : ""}</span>
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 12 }}>
                <div className="input-group" style={{ maxWidth: 200 }}>
                  <span className="input-label">Investment per Contract $</span>
                  <input type="number" value={compareInvestment} onChange={e => setCompareInvestment(+e.target.value || 1000)} step="1000" min="100" />
                </div>
              </div>
            </div>

            {/* Comparison Results Table */}
            {compareCalcs && compareCalcs.enriched.length > 0 && (
              <>
                <div className="card">
                  <div className="scenario-header"><span>Side-by-Side Comparison</span><div className="divider" />
                    <span style={{ fontSize: 10, color: "#4a5060", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
                      Stock → {fmtDollar(compareCalcs.targetPrice)} · +{compareEvalDays}d · {fmtDollar(compareInvestment)} each
                    </span>
                  </div>
                  <div style={{ overflowX: "auto", marginTop: 12 }}>
                    <table>
                      <thead><tr>
                        <th style={{ textAlign: "left" }}>Metric</th>
                        {compareCalcs.enriched.map(ct => (
                          <th key={ct.id} style={{ color: ct.color }}>{ct.label}</th>
                        ))}
                      </tr></thead>
                      <tbody>
                        {[
                          { label: "Strike", fmt: ct => fmtDollar(ct.strike) },
                          { label: "Expiration", fmt: ct => ct.expiration },
                          { label: "Days to Expiry", fmt: ct => `${ct.totalDays}d` },
                          { label: "Entry Price", fmt: ct => fmtDollar(ct.entryPrice) },
                          { label: "IV", fmt: ct => fmtPct(ct.activeIV) },
                          { label: "Contracts", fmt: ct => `${ct.numContracts}x` },
                          { label: "Principal", fmt: ct => fmtDollar(ct.principal) },
                          { label: "Cost/Contract", fmt: ct => fmtDollar(ct.costPerContract) },
                          { label: "", fmt: () => "" },
                          { label: "Option Value @ Eval", fmt: ct => fmtDollar(ct.evalBS.price), color: ct => "#e0e4ec" },
                          { label: "Position Value", fmt: ct => fmtDollar(ct.positionValue), color: ct => "#3b82f6" },
                          { label: "P&L ($)", fmt: ct => fmtPnl(ct.evalPnl), color: ct => ct.evalPnl >= 0 ? "#22c55e" : "#ef4444", bold: true },
                          { label: "P&L (%)", fmt: ct => fmtPnlPct(ct.evalPnlPct), color: ct => ct.evalPnlPct >= 0 ? "#22c55e" : "#ef4444", bold: true },
                          { label: "", fmt: () => "" },
                          { label: "Breakeven (Expiry)", fmt: ct => fmtDollar(ct.breakeven) },
                          { label: "Intrinsic @ Target", fmt: ct => fmtDollar(ct.intrinsic) },
                          { label: "P&L @ Expiry", fmt: ct => fmtPnl(ct.expiryPnl), color: ct => ct.expiryPnl >= 0 ? "#22c55e" : "#ef4444" },
                          { label: "", fmt: () => "" },
                          { label: "Delta", fmt: ct => fmt(ct.evalBS.delta, 4) },
                          { label: "Gamma", fmt: ct => fmt(ct.evalBS.gamma, 4) },
                          { label: "Theta", fmt: ct => fmt(ct.evalBS.theta, 4) },
                          { label: "Vega", fmt: ct => fmt(ct.evalBS.vega, 4) },
                        ].map((row, i) => (
                          <tr key={i} style={row.label === "" ? { height: 4 } : {}}>
                            {row.label ? (
                              <>
                                <td style={{ textAlign: "left", color: "#5a6070", fontWeight: 500 }}>{row.label}</td>
                                {compareCalcs.enriched.map(ct => (
                                  <td key={ct.id} style={{
                                    color: row.color ? row.color(ct) : "#e0e4ec",
                                    fontWeight: row.bold ? 700 : 400,
                                    fontSize: row.bold ? 14 : 12,
                                  }}>{row.fmt(ct)}</td>
                                ))}
                              </>
                            ) : (
                              <td colSpan={compareCalcs.enriched.length + 1} style={{ borderBottom: "1px solid #1e2330" }} />
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Winner highlight */}
                {(() => {
                  const best = [...compareCalcs.enriched].sort((a, b) => b.evalPnlPct - a.evalPnlPct);
                  const winner = best[0];
                  const bestDollar = [...compareCalcs.enriched].sort((a, b) => b.evalPnl - a.evalPnl)[0];
                  return (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <div className="card" style={{ borderTop: `2px solid ${winner.color}`, padding: "16px 20px" }}>
                        <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "1.5px", color: "#4a5060", marginBottom: 6 }}>Best % Return</div>
                        <div style={{ fontSize: 20, fontWeight: 700, color: winner.color }}>{winner.label}</div>
                        <div style={{ fontSize: 16, fontWeight: 600, color: winner.evalPnlPct >= 0 ? "#22c55e" : "#ef4444", marginTop: 4 }}>
                          {fmtPnlPct(winner.evalPnlPct)} ({fmtPnl(winner.evalPnl)})
                        </div>
                        <div style={{ fontSize: 10, color: "#4a5060", marginTop: 4 }}>
                          ${winner.strike} {winner.type} · {winner.numContracts}x @ {fmtDollar(winner.entryPrice)}
                        </div>
                      </div>
                      <div className="card" style={{ borderTop: `2px solid ${bestDollar.color}`, padding: "16px 20px" }}>
                        <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "1.5px", color: "#4a5060", marginBottom: 6 }}>Best $ Return</div>
                        <div style={{ fontSize: 20, fontWeight: 700, color: bestDollar.color }}>{bestDollar.label}</div>
                        <div style={{ fontSize: 16, fontWeight: 600, color: bestDollar.evalPnl >= 0 ? "#22c55e" : "#ef4444", marginTop: 4 }}>
                          {fmtPnl(bestDollar.evalPnl)} ({fmtPnlPct(bestDollar.evalPnlPct)})
                        </div>
                        <div style={{ fontSize: 10, color: "#4a5060", marginTop: 4 }}>
                          ${bestDollar.strike} {bestDollar.type} · {bestDollar.numContracts}x @ {fmtDollar(bestDollar.entryPrice)}
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* P&L Curves Chart - Dollar */}
                <div className="card">
                  <div className="scenario-header"><span>P&L by Stock Price ($ at Eval Date)</span><div className="divider" /></div>
                  <ResponsiveContainer width="100%" height={380}>
                    <ComposedChart data={compareCalcs.pnlCurves} margin={{ top: 20, right: 30, left: 20, bottom: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1a1d28" />
                      <XAxis dataKey="stock" tick={{ fontSize: 9, fill: "#4a5060" }} tickFormatter={v => `$${Number(v).toFixed(0)}`} />
                      <YAxis tick={{ fontSize: 9, fill: "#4a5060" }} tickFormatter={v => `$${(v / 1000).toFixed(1)}k`} />
                      <Tooltip
                        contentStyle={{ background: "#12151c", border: "1px solid #1e2330", borderRadius: 6, fontSize: 10, fontFamily: "JetBrains Mono" }}
                        labelFormatter={v => `Stock: $${Number(v).toFixed(0)}`}
                        formatter={(v, name) => {
                          const ct = compareCalcs.enriched.find(c => `pnl_${c.id}` === name);
                          return [fmtPnl(v), ct ? ct.label : name];
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: 10 }} formatter={name => {
                        const ct = compareCalcs.enriched.find(c => `pnl_${c.id}` === name);
                        return ct ? ct.label : name;
                      }} />
                      <ReferenceLine y={0} stroke="#4a506060" strokeWidth={2} />
                      <ReferenceLine x={stockPrice.value} stroke="#4a506040" strokeDasharray="5 5" />
                      <ReferenceLine x={compareCalcs.targetPrice} stroke="#22c55e30" strokeDasharray="5 5" />
                      {compareCalcs.enriched.map(ct => (
                        <Line key={ct.id} type="monotone" dataKey={`pnl_${ct.id}`} name={`pnl_${ct.id}`} stroke={ct.color} strokeWidth={2.5} dot={false} />
                      ))}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>

                {/* Return % Curves */}
                <div className="card">
                  <div className="scenario-header"><span>Return % by Stock Price (at Eval Date)</span><div className="divider" /></div>
                  <ResponsiveContainer width="100%" height={340}>
                    <ComposedChart data={compareCalcs.returnCurves} margin={{ top: 20, right: 30, left: 20, bottom: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1a1d28" />
                      <XAxis dataKey="stock" tick={{ fontSize: 9, fill: "#4a5060" }} tickFormatter={v => `$${Number(v).toFixed(0)}`} />
                      <YAxis tick={{ fontSize: 9, fill: "#4a5060" }} tickFormatter={v => `${v.toFixed(0)}%`} />
                      <Tooltip
                        contentStyle={{ background: "#12151c", border: "1px solid #1e2330", borderRadius: 6, fontSize: 10, fontFamily: "JetBrains Mono" }}
                        labelFormatter={v => `Stock: $${Number(v).toFixed(0)}`}
                        formatter={(v, name) => {
                          const ct = compareCalcs.enriched.find(c => `ret_${c.id}` === name);
                          return [`${Number(v).toFixed(1)}%`, ct ? ct.label : name];
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: 10 }} formatter={name => {
                        const ct = compareCalcs.enriched.find(c => `ret_${c.id}` === name);
                        return ct ? ct.label : name;
                      }} />
                      <ReferenceLine y={0} stroke="#4a506060" strokeWidth={2} />
                      <ReferenceLine x={stockPrice.value} stroke="#4a506040" strokeDasharray="5 5" />
                      <ReferenceLine x={compareCalcs.targetPrice} stroke="#22c55e30" strokeDasharray="5 5" />
                      {compareCalcs.enriched.map(ct => (
                        <Line key={ct.id} type="monotone" dataKey={`ret_${ct.id}`} name={`ret_${ct.id}`} stroke={ct.color} strokeWidth={2} dot={false} strokeDasharray={ct === compareCalcs.enriched[0] ? undefined : "6 3"} />
                      ))}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>

                {/* Time Decay Comparison */}
                <div className="card">
                  <div className="scenario-header"><span>P&L Over Time (at Target Price: {fmtDollar(compareCalcs.targetPrice)})</span><div className="divider" /></div>
                  <ResponsiveContainer width="100%" height={340}>
                    <ComposedChart data={compareCalcs.decayData} margin={{ top: 20, right: 30, left: 20, bottom: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1a1d28" />
                      <XAxis dataKey="dayPct" tick={{ fontSize: 9, fill: "#4a5060" }} tickFormatter={v => `${Number(v).toFixed(0)}%`} label={{ value: "% of Time to Expiry Elapsed", position: "insideBottom", offset: -5, fill: "#3a4050", fontSize: 9 }} />
                      <YAxis tick={{ fontSize: 9, fill: "#4a5060" }} tickFormatter={v => `$${(v / 1000).toFixed(1)}k`} />
                      <Tooltip
                        contentStyle={{ background: "#12151c", border: "1px solid #1e2330", borderRadius: 6, fontSize: 10, fontFamily: "JetBrains Mono" }}
                        labelFormatter={v => `${Number(v).toFixed(0)}% elapsed`}
                        formatter={(v, name) => {
                          const ct = compareCalcs.enriched.find(c => `val_${c.id}` === name);
                          return [fmtPnl(v), ct ? ct.label : name];
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: 10 }} formatter={name => {
                        const ct = compareCalcs.enriched.find(c => `val_${c.id}` === name);
                        return ct ? ct.label : name;
                      }} />
                      <ReferenceLine y={0} stroke="#4a506060" strokeWidth={2} />
                      {compareCalcs.enriched.map(ct => (
                        <Line key={ct.id} type="monotone" dataKey={`val_${ct.id}`} name={`val_${ct.id}`} stroke={ct.color} strokeWidth={2} dot={false} />
                      ))}
                    </ComposedChart>
                  </ResponsiveContainer>
                  <div style={{ fontSize: 10, color: "#3a4050", marginTop: 8 }}>
                    Shows how each contract's P&L evolves as time passes, assuming the stock stays at the target price ({fmtDollar(compareCalcs.targetPrice)}). X-axis is normalized so contracts with different expiries can be compared on the same scale.
                  </div>
                </div>

                {/* Quick scenario matrix */}
                <div className="card">
                  <div className="scenario-header"><span>Scenario Matrix</span><div className="divider" />
                    <span style={{ fontSize: 10, color: "#4a5060", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
                      P&L at various stock prices · +{compareEvalDays}d
                    </span>
                  </div>
                  <div style={{ overflowX: "auto", marginTop: 12 }}>
                    <table>
                      <thead><tr>
                        <th style={{ textAlign: "left" }}>Stock Price</th>
                        {compareCalcs.enriched.map(ct => (
                          <th key={ct.id} style={{ color: ct.color }}>{ct.label}<br /><span style={{ fontSize: 8, color: "#3a4050", fontWeight: 400 }}>{ct.numContracts}x · ${ct.strike}</span></th>
                        ))}
                      </tr></thead>
                      <tbody>
                        {[0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0, 4.0, 5.0].map(mult => {
                          const price = Math.round(stockPrice.value * mult);
                          const isTarget = Math.abs(price - (compareCalcs.targetPrice)) < stockPrice.value * 0.05;
                          const isCurrent = Math.abs(mult - 1.0) < 0.01;
                          return (
                            <tr key={mult} style={isTarget ? { background: "#22c55e08" } : isCurrent ? { background: "#3b82f608" } : {}}>
                              <td style={{ textAlign: "left", color: isTarget ? "#22c55e" : isCurrent ? "#3b82f6" : "#e0e4ec", fontWeight: isTarget || isCurrent ? 600 : 400 }}>
                                {fmtDollar(price)}
                                <span style={{ fontSize: 9, color: "#3a4050", marginLeft: 4 }}>
                                  ({mult >= 1 ? "+" : ""}{((mult - 1) * 100).toFixed(0)}%)
                                </span>
                              </td>
                              {compareCalcs.enriched.map(ct => {
                                const bs = blackScholes(price, ct.strike, ct.evalT, riskFreeRate.value, ct.activeIV, ct.type, dividendYield.value);
                                const pnl = (bs.price - ct.entryPrice) * 100 * ct.numContracts;
                                const pnlPct = ct.entryPrice > 0 ? (bs.price - ct.entryPrice) / ct.entryPrice : 0;
                                const intensity = Math.min(Math.abs(pnl) / Math.max(ct.principal, 1), 1) * 0.2;
                                return (
                                  <td key={ct.id} style={{
                                    background: pnl >= 0 ? `rgba(34,197,94,${intensity})` : `rgba(239,68,68,${intensity})`,
                                    color: pnl >= 0 ? "#22c55e" : "#ef4444",
                                    fontWeight: isTarget ? 700 : 400,
                                  }}>
                                    {fmtPnl(pnl)}
                                    <div style={{ fontSize: 9, opacity: 0.7 }}>{fmtPnlPct(pnlPct)}</div>
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}

            {compareContracts.length === 0 && (
              <div style={{ textAlign: "center", padding: 40, color: "#3a4050" }}>
                <div style={{ fontSize: 14, marginBottom: 8 }}>No contracts to compare</div>
                <div style={{ fontSize: 11 }}>Click "+ Add Contract" above to start comparing different strikes, expirations, and types</div>
              </div>
            )}
            </>)}

            {/* ─── ROLL PLANNER MODE ─── */}
            {compareMode === "roll" && (<>
              <div className="card" style={{ borderTop: "2px solid #f59e0b" }}>
                <div className="scenario-header">
                  <span style={{ color: "#f59e0b" }}>Roll Strategy Chain</span><div className="divider" />
                  <span style={{ fontSize: 10, color: "#4a5060", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
                    Chain sequential options to extend beyond available expiries · Stock: {fmtDollar(stockPrice.value)}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: "#5a6070", marginTop: 8, marginBottom: 16, lineHeight: 1.6 }}>
                  Define each option leg you'll hold sequentially. The exit proceeds from each leg (minus slippage) fund entry into the next. 
                  Set "Roll After Days" to control when each leg is sold and rolled forward.
                </div>

                {/* Roll legs table */}
                <div style={{ overflowX: "auto" }}>
                  <table>
                    <thead><tr>
                      <th style={{ textAlign: "left" }}>#</th>
                      <th style={{ textAlign: "left" }}>Label</th>
                      <th>Type</th>
                      <th>Strike</th>
                      <th>Expiration</th>
                      <th>Premium</th>
                      <th>IV %</th>
                      <th>Roll After (d)</th>
                      <th>Stock @ Roll</th>
                      <th></th>
                    </tr></thead>
                    <tbody>
                      {rollLegs.map((leg, i) => {
                        const isLast = i === rollLegs.length - 1;
                        return (
                          <tr key={leg.id}>
                            <td style={{ textAlign: "left" }}>
                              <div style={{ width: 10, height: 10, borderRadius: "50%", background: COMPARE_COLORS[i % COMPARE_COLORS.length] }} />
                            </td>
                            <td style={{ textAlign: "left" }}>
                              <input type="text" value={leg.label} onChange={e => setRollLegs(prev => prev.map(l => l.id === leg.id ? { ...l, label: e.target.value } : l))} style={{ width: 140, padding: "4px 6px", fontSize: 11 }} />
                            </td>
                            <td>
                              <select value={leg.type} onChange={e => setRollLegs(prev => prev.map(l => l.id === leg.id ? { ...l, type: e.target.value } : l))} style={{ width: 70, padding: "4px 6px", fontSize: 11 }}>
                                <option value="call">Call</option><option value="put">Put</option>
                              </select>
                            </td>
                            <td><input type="number" value={leg.strike} onChange={e => setRollLegs(prev => prev.map(l => l.id === leg.id ? { ...l, strike: +e.target.value || 0 } : l))} step="5" style={{ width: 80, padding: "4px 6px", fontSize: 11 }} /></td>
                            <td><input type="date" value={leg.expiration} onChange={e => setRollLegs(prev => prev.map(l => l.id === leg.id ? { ...l, expiration: e.target.value } : l))} style={{ width: 130, padding: "4px 6px", fontSize: 11 }} /></td>
                            <td><input type="number" value={leg.premium || ""} onChange={e => setRollLegs(prev => prev.map(l => l.id === leg.id ? { ...l, premium: +e.target.value || 0 } : l))} step="0.5" placeholder="Auto" style={{ width: 70, padding: "4px 6px", fontSize: 11 }} /></td>
                            <td><input type="number" value={leg.iv || ""} onChange={e => setRollLegs(prev => prev.map(l => l.id === leg.id ? { ...l, iv: +e.target.value || 0 } : l))} step="1" placeholder="Auto" style={{ width: 55, padding: "4px 6px", fontSize: 11 }} /></td>
                            <td>
                              {!isLast ? (
                                <input type="number" value={leg.rollAfterDays || ""} onChange={e => setRollLegs(prev => prev.map(l => l.id === leg.id ? { ...l, rollAfterDays: +e.target.value || 0 } : l))} step="30" placeholder="days" style={{ width: 70, padding: "4px 6px", fontSize: 11 }} />
                              ) : (
                                <span style={{ fontSize: 10, color: "#4a5060" }}>Hold to eval</span>
                              )}
                            </td>
                            <td>
                              {i > 0 ? (
                                <input type="number" value={leg.stockAtRoll || ""} onChange={e => setRollLegs(prev => prev.map(l => l.id === leg.id ? { ...l, stockAtRoll: +e.target.value || 0 } : l))} step="1" placeholder="Auto" style={{ width: 70, padding: "4px 6px", fontSize: 11 }} />
                              ) : (
                                <span style={{ fontSize: 10, color: "#4a5060" }}>{fmtDollar(stockPrice.value)}</span>
                              )}
                            </td>
                            <td><button className="btn btn-danger" onClick={() => setRollLegs(prev => prev.filter(l => l.id !== leg.id))}>×</button></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <button className="btn" onClick={() => {
                    const newId = rollNextId;
                    setRollNextId(prev => prev + 1);
                    // Default: same strike, +1 year from last leg's expiry
                    const lastLeg = rollLegs[rollLegs.length - 1];
                    const lastExp = lastLeg ? new Date(lastLeg.expiration) : new Date();
                    const newExp = new Date(lastExp);
                    newExp.setFullYear(newExp.getFullYear() + 1);
                    setRollLegs(prev => [...prev, {
                      id: newId,
                      label: `Leg ${newId}`,
                      type: "call",
                      strike: lastLeg ? lastLeg.strike : strikePrice.value,
                      expiration: newExp.toISOString().split("T")[0],
                      premium: 0,
                      iv: 0,
                      rollAfterDays: 365,
                      stockAtRoll: 0,
                    }]);
                  }}>+ Add Roll Leg</button>
                </div>
              </div>

              {/* Roll Parameters */}
              <div className="card">
                <div className="scenario-header"><span>Roll Parameters</span><div className="divider" /></div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginTop: 12 }}>
                  <div className="input-group">
                    <span className="input-label">Investment $</span>
                    <input type="number" value={rollInvestment} onChange={e => setRollInvestment(+e.target.value || 1000)} step="1000" min="100" />
                  </div>
                  <div className="input-group">
                    <span className="input-label">Slippage per Roll %</span>
                    <input type="number" value={rollSlippage} onChange={e => setRollSlippage(+e.target.value || 0)} step="0.5" min="0" max="20" />
                    <span style={{ fontSize: 9, color: "#3a4050" }}>Bid-ask + execution cost</span>
                  </div>
                  <div className="input-group">
                    <span className="input-label">IV Shift at Rolls %</span>
                    <input type="number" value={rollIVShift} onChange={e => setRollIVShift(+e.target.value || 0)} step="5" />
                    <span style={{ fontSize: 9, color: "#3a4050" }}>+/- vs current IV for future legs</span>
                  </div>
                  <div className="input-group">
                    <span className="input-label">Price Path</span>
                    <select value={rollPathMode} onChange={e => setRollPathMode(e.target.value)}>
                      <option value="linear">Linear to Target</option>
                      <option value="custom">Custom per Roll</option>
                    </select>
                    <span style={{ fontSize: 9, color: "#3a4050" }}>How stock gets from here to target</span>
                  </div>
                </div>
                {/* Target price slider */}
                <div style={{ marginTop: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                    <span className="input-label">Final Target Stock Price</span>
                    <span style={{ fontSize: 16, fontWeight: 700, color: "#e0e4ec" }}>{fmtDollar(rollTargetPrice || stockPrice.value)}</span>
                  </div>
                  <input type="range" min={1} max={rollCalcs ? rollCalcs.sliderMax : 1000} step={1}
                    value={rollTargetPrice || stockPrice.value}
                    onChange={e => setRollTargetPrice(+e.target.value)}
                    style={{ width: "100%", accentColor: "#22c55e", cursor: "pointer" }} />
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#3a4050", marginTop: 2 }}>
                    <span>$1</span>
                    <span style={{ color: "#4a5060" }}>Current: {fmtDollar(stockPrice.value)}</span>
                    <span>{fmtDollar(rollCalcs ? rollCalcs.sliderMax : 1000)}</span>
                  </div>
                </div>
              </div>

              {/* Roll Results */}
              {rollCalcs && rollCalcs.processedLegs.length > 0 && (<>
                {/* Journey Summary */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
                  <div className="metric-box">
                    <div className="label">Initial Investment</div>
                    <div className="value">{fmtDollar(rollInvestment)}</div>
                  </div>
                  <div className="metric-box">
                    <div className="label">Final Capital</div>
                    <div className="value" style={{ color: rollCalcs.totalPnl >= 0 ? "#22c55e" : "#ef4444" }}>{fmtDollar(rollCalcs.availableCapital)}</div>
                  </div>
                  <div className="metric-box">
                    <div className="label">Total P&L</div>
                    <div className="value" style={{ color: rollCalcs.totalPnl >= 0 ? "#22c55e" : "#ef4444" }}>{fmtPnl(rollCalcs.totalPnl)}</div>
                  </div>
                  <div className="metric-box">
                    <div className="label">Total Return</div>
                    <div className="value" style={{ color: rollCalcs.totalPnlPct >= 0 ? "#22c55e" : "#ef4444" }}>{fmtPnlPct(rollCalcs.totalPnlPct)}</div>
                  </div>
                  <div className="metric-box">
                    <div className="label">Total Days</div>
                    <div className="value">{rollCalcs.totalDaysHeld}d</div>
                    <div style={{ fontSize: 10, color: "#4a5060" }}>{(rollCalcs.totalDaysHeld / 365).toFixed(1)} years</div>
                  </div>
                  <div className="metric-box">
                    <div className="label">Rolls</div>
                    <div className="value">{rollCalcs.processedLegs.length - 1}</div>
                    <div style={{ fontSize: 10, color: "#4a5060" }}>{rollSlippage}% slippage each</div>
                  </div>
                </div>

                {/* Leg-by-Leg Breakdown */}
                <div className="card">
                  <div className="scenario-header"><span>Leg-by-Leg Capital Flow</span><div className="divider" /></div>
                  <div style={{ overflowX: "auto", marginTop: 12 }}>
                    <table>
                      <thead><tr>
                        <th style={{ textAlign: "left" }}>Leg</th>
                        <th>Strike</th>
                        <th>Expiry</th>
                        <th>Hold (d)</th>
                        <th>Stock In</th>
                        <th>Stock Out</th>
                        <th>Entry Price</th>
                        <th>Exit Price</th>
                        <th>Contracts</th>
                        <th>Capital In</th>
                        <th>Capital Out</th>
                        <th>Leg P&L</th>
                        <th>Leg %</th>
                      </tr></thead>
                      <tbody>
                        {rollCalcs.processedLegs.map((pl, i) => (
                          <tr key={pl.id}>
                            <td style={{ textAlign: "left", fontWeight: 600, color: COMPARE_COLORS[i % COMPARE_COLORS.length] }}>{pl.label}</td>
                            <td>{fmtDollar(pl.strike)}</td>
                            <td style={{ fontSize: 10 }}>{pl.expiration}</td>
                            <td>{pl.holdDays}d</td>
                            <td>{fmtDollar(pl.stockAtEntry)}</td>
                            <td>{fmtDollar(pl.stockAtExit)}</td>
                            <td>{fmtDollar(pl.entryPrice)}</td>
                            <td>{fmtDollar(pl.exitPrice)}</td>
                            <td>{pl.numContracts}x</td>
                            <td>{fmtDollar(pl.capitalIn)}</td>
                            <td>{fmtDollar(pl.exitProceeds + pl.unusedCash)}</td>
                            <td style={{ color: pl.legPnl >= 0 ? "#22c55e" : "#ef4444", fontWeight: 600 }}>{fmtPnl(pl.legPnl)}</td>
                            <td style={{ color: pl.legPnlPct >= 0 ? "#22c55e" : "#ef4444" }}>{fmtPnlPct(pl.legPnlPct)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Visual leg timeline */}
                <div className="card">
                  <div className="scenario-header"><span>Roll Timeline</span><div className="divider" /></div>
                  <div style={{ position: "relative", height: 60 + rollCalcs.processedLegs.length * 40, marginTop: 16 }}>
                    {/* Time axis */}
                    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1, background: "#1e2330" }} />
                    <div style={{ position: "absolute", top: -18, left: 0, fontSize: 9, color: "#4a5060" }}>Now</div>
                    <div style={{ position: "absolute", top: -18, right: 0, fontSize: 9, color: "#4a5060" }}>+{rollCalcs.totalJourneyDays}d</div>
                    {/* Leg bars */}
                    {rollCalcs.processedLegs.map((pl, i) => {
                      const leftPct = rollCalcs.totalJourneyDays > 0 ? (pl.entryDayOffset / rollCalcs.totalJourneyDays) * 100 : 0;
                      const widthPct = rollCalcs.totalJourneyDays > 0 ? (pl.holdDays / rollCalcs.totalJourneyDays) * 100 : 100;
                      const color = COMPARE_COLORS[i % COMPARE_COLORS.length];
                      return (
                        <div key={pl.id} style={{ position: "absolute", top: 10 + i * 40, left: `${leftPct}%`, width: `${widthPct}%`, height: 30 }}>
                          <div style={{ height: "100%", background: `${color}20`, border: `1px solid ${color}60`, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "0 8px", overflow: "hidden" }}>
                            <span style={{ fontSize: 10, fontWeight: 600, color, whiteSpace: "nowrap" }}>{pl.label}</span>
                            <span style={{ fontSize: 9, color: "#5a6070", whiteSpace: "nowrap" }}>${pl.strike} · {pl.numContracts}x · {pl.holdDays}d</span>
                          </div>
                          {!pl.isLastLeg && (
                            <div style={{ position: "absolute", right: -8, top: 8, fontSize: 14, color: "#f59e0b" }}>→</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Position Value Over Time Chart */}
                <div className="card">
                  <div className="scenario-header"><span>Position Journey</span><div className="divider" />
                    <span style={{ fontSize: 10, color: "#4a5060", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
                      Stock path: {fmtDollar(stockPrice.value)} → {fmtDollar(rollTargetPrice || stockPrice.value)}
                    </span>
                  </div>
                  <ResponsiveContainer width="100%" height={340}>
                    <ComposedChart data={rollCalcs.timeline} margin={{ top: 20, right: 30, left: 20, bottom: 10 }}>
                      <defs>
                        <linearGradient id="roll-pnl-pos" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#22c55e" stopOpacity={0.2} />
                          <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="roll-pnl-neg" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#ef4444" stopOpacity={0} />
                          <stop offset="95%" stopColor="#ef4444" stopOpacity={0.2} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1a1d28" />
                      <XAxis dataKey="day" tick={{ fontSize: 9, fill: "#4a5060" }} tickFormatter={d => d === 0 ? "Now" : `+${d}d`} />
                      <YAxis yAxisId="val" tick={{ fontSize: 9, fill: "#4a5060" }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                      <YAxis yAxisId="stock" orientation="right" tick={{ fontSize: 9, fill: "#4a506080" }} tickFormatter={v => `$${Number(v).toFixed(0)}`} />
                      <Tooltip
                        contentStyle={{ background: "#12151c", border: "1px solid #1e2330", borderRadius: 6, fontSize: 10, fontFamily: "JetBrains Mono" }}
                        labelFormatter={d => {
                          const pt = rollCalcs.timeline.find(p => p.day === d);
                          return pt ? `Day ${d} · ${pt.date}${pt.legLabel ? ` · ${pt.legLabel}` : ""}` : `Day ${d}`;
                        }}
                        formatter={(v, name) => {
                          if (name === "positionValue") return [fmtDollar(v), "Position Value"];
                          if (name === "legPnl") return [fmtPnl(v), "P&L"];
                          if (name === "stock") return [fmtDollar(v), "Stock"];
                          return [v, name];
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: 10 }} formatter={n => n === "positionValue" ? "Position Value" : n === "legPnl" ? "P&L" : "Stock Price"} />
                      {/* Roll point markers */}
                      {rollCalcs.processedLegs.slice(1).map((pl, i) => (
                        <ReferenceLine key={pl.id} x={pl.entryDayOffset} yAxisId="val" stroke="#f59e0b" strokeDasharray="5 5" />
                      ))}
                      <ReferenceLine y={0} yAxisId="val" stroke="#4a506060" strokeWidth={1} />
                      <Area yAxisId="val" type="monotone" dataKey="legPnl" stroke={rollCalcs.totalPnl >= 0 ? "#22c55e" : "#ef4444"} fill={rollCalcs.totalPnl >= 0 ? "url(#roll-pnl-pos)" : "url(#roll-pnl-neg)"} strokeWidth={2.5} dot={false} />
                      <Line yAxisId="val" type="monotone" dataKey="positionValue" stroke="#3b82f6" strokeWidth={1.5} dot={false} strokeDasharray="4 4" />
                      <Line yAxisId="stock" type="monotone" dataKey="stock" stroke="#4a506060" strokeWidth={1} dot={false} strokeDasharray="2 6" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>

                {/* Sensitivity: P&L vs Final Stock Price */}
                <div className="card">
                  <div className="scenario-header"><span>Outcome vs Target Price (Full Chain)</span><div className="divider" /></div>
                  <ResponsiveContainer width="100%" height={340}>
                    <ComposedChart data={rollCalcs.sensitivitySteps} margin={{ top: 20, right: 30, left: 20, bottom: 10 }}>
                      <defs>
                        <linearGradient id="roll-sens-grad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#22c55e" stopOpacity={0.12} />
                          <stop offset="50%" stopColor="#22c55e" stopOpacity={0} />
                          <stop offset="51%" stopColor="#ef4444" stopOpacity={0} />
                          <stop offset="100%" stopColor="#ef4444" stopOpacity={0.12} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1a1d28" />
                      <XAxis dataKey="targetPrice" tick={{ fontSize: 9, fill: "#4a5060" }} tickFormatter={v => `$${Number(v).toFixed(0)}`} />
                      <YAxis tick={{ fontSize: 9, fill: "#4a5060" }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                      <Tooltip
                        contentStyle={{ background: "#12151c", border: "1px solid #1e2330", borderRadius: 6, fontSize: 10, fontFamily: "JetBrains Mono" }}
                        labelFormatter={v => `Target: $${Number(v).toFixed(0)}`}
                        formatter={(v, name) => [name === "totalPnlPct" ? fmtPnlPct(v) : fmtPnl(v), name === "totalPnlPct" ? "Return %" : "Total P&L"]}
                      />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <ReferenceLine y={0} stroke="#4a506060" strokeWidth={2} />
                      <ReferenceLine x={stockPrice.value} stroke="#3b82f640" strokeDasharray="5 5" />
                      <ReferenceLine x={rollTargetPrice || stockPrice.value} stroke="#22c55e30" strokeDasharray="5 5" />
                      <Area type="monotone" dataKey="totalPnl" name="Total P&L" fill="url(#roll-sens-grad)" stroke="none" />
                      <Line type="monotone" dataKey="totalPnl" name="Total P&L" stroke="#3b82f6" strokeWidth={2.5} dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>

                {/* IV Sensitivity */}
                <div className="card">
                  <div className="scenario-header"><span>IV Sensitivity (at Target: {fmtDollar(rollTargetPrice || stockPrice.value)})</span><div className="divider" /></div>
                  <div style={{ display: "grid", gridTemplateColumns: `repeat(${rollCalcs.ivSensitivity.length}, 1fr)`, gap: 4, marginTop: 12 }}>
                    {rollCalcs.ivSensitivity.map(row => {
                      const intensity = Math.min(Math.abs(row.totalPnl) / Math.max(rollInvestment, 1), 1) * 0.25;
                      return (
                        <div key={row.ivShift} style={{
                          padding: "10px 6px",
                          textAlign: "center",
                          borderRadius: 6,
                          background: row.totalPnl >= 0 ? `rgba(34,197,94,${intensity})` : `rgba(239,68,68,${intensity})`,
                          border: row.ivShift === 0 ? "1px solid #3b82f640" : "1px solid transparent",
                        }}>
                          <div style={{ fontSize: 9, color: "#4a5060", marginBottom: 4 }}>
                            IV {row.ivShift >= 0 ? "+" : ""}{row.ivShift}%
                          </div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: row.totalPnl >= 0 ? "#22c55e" : "#ef4444" }}>
                            {fmtPnl(row.totalPnl)}
                          </div>
                          <div style={{ fontSize: 9, color: row.totalPnlPct >= 0 ? "#22c55e80" : "#ef444480" }}>
                            {fmtPnlPct(row.totalPnlPct)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ fontSize: 10, color: "#3a4050", marginTop: 8 }}>
                    Shows total chain outcome if IV at all roll points shifts by the given percentage. Center column = your base IV assumption.
                  </div>
                </div>
              </>)}

              {rollLegs.length === 0 && (
                <div style={{ textAlign: "center", padding: 40, color: "#3a4050" }}>
                  <div style={{ fontSize: 14, marginBottom: 8 }}>No roll legs configured</div>
                  <div style={{ fontSize: 11 }}>Click "+ Add Roll Leg" to build a sequential options chain</div>
                </div>
              )}
            </>)}

            {/* ─── ROLL OPTIMIZER MODE ─── */}
            {compareMode === "optimizer" && (<>
              <div className="card" style={{ borderTop: "2px solid #06b6d4" }}>
                <div className="scenario-header">
                  <span style={{ color: "#06b6d4" }}>Roll Timing Optimizer</span><div className="divider" />
                  <span style={{ fontSize: 10, color: "#4a5060", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
                    Find the optimal day to roll your position based on your stock price forecast
                  </span>
                </div>
                <div style={{ fontSize: 11, color: "#5a6070", marginTop: 8, marginBottom: 16, lineHeight: 1.6 }}>
                  Define your current option, the option you'd roll into, and your expected stock price trajectory. 
                  The optimizer compares "hold to expiry" vs "roll at day X" across every possible roll point to find 
                  when rolling maximizes your total outcome.
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                  {/* Current Position */}
                  <div>
                    <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "1.5px", color: "#3b82f6", marginBottom: 10, fontWeight: 600 }}>Current Option</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <div className="input-group">
                        <span className="input-label">Strike</span>
                        <input type="number" value={optStrike} onChange={e => setOptStrike(+e.target.value || 0)} step="5" />
                      </div>
                      <div className="input-group">
                        <span className="input-label">Type</span>
                        <select value={optType} onChange={e => setOptType(e.target.value)}>
                          <option value="call">Call</option><option value="put">Put</option>
                        </select>
                      </div>
                      <div className="input-group">
                        <span className="input-label">Expiration</span>
                        <input type="date" value={optExpiry} onChange={e => setOptExpiry(e.target.value)} />
                      </div>
                      <div className="input-group">
                        <span className="input-label">Entry Price</span>
                        <input type="number" value={optEntryPrice || ""} onChange={e => setOptEntryPrice(+e.target.value || 0)} step="0.5" placeholder="Auto" />
                      </div>
                      <div className="input-group">
                        <span className="input-label">IV %</span>
                        <input type="number" value={optIV || ""} onChange={e => setOptIV(+e.target.value || 0)} step="1" placeholder="Auto" />
                      </div>
                      <div className="input-group">
                        <span className="input-label">Investment $</span>
                        <input type="number" value={optInvestment} onChange={e => setOptInvestment(+e.target.value || 1000)} step="1000" />
                      </div>
                    </div>
                  </div>

                  {/* Roll-Into Option */}
                  <div>
                    <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "1.5px", color: "#f59e0b", marginBottom: 10, fontWeight: 600 }}>Roll Into (New LEAP)</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <div className="input-group">
                        <span className="input-label">Strike</span>
                        <input type="number" value={rollIntoStrike} onChange={e => setRollIntoStrike(+e.target.value || 0)} step="5" />
                      </div>
                      <div className="input-group">
                        <span className="input-label">Expiration</span>
                        <input type="date" value={rollIntoExpiry} onChange={e => setRollIntoExpiry(e.target.value)} />
                      </div>
                      <div className="input-group">
                        <span className="input-label">IV %</span>
                        <input type="number" value={rollIntoIV || ""} onChange={e => setRollIntoIV(+e.target.value || 0)} step="1" placeholder="Same as current" />
                      </div>
                      <div className="input-group">
                        <span className="input-label">Slippage %</span>
                        <input type="number" value={optRollSlippage} onChange={e => setOptRollSlippage(+e.target.value || 0)} step="0.5" min="0" />
                        <span style={{ fontSize: 9, color: "#3a4050" }}>Bid-ask cost at roll</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Stock Price Trajectory */}
              <div className="card" style={{ borderTop: "2px solid #22c55e" }}>
                <div className="scenario-header">
                  <span style={{ color: "#22c55e" }}>Stock Price Forecast</span><div className="divider" />
                  <span style={{ fontSize: 10, color: "#4a5060", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
                    Define the expected stock trajectory over the option's life
                  </span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginTop: 12 }}>
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                      <span className="input-label">Peak Stock Price</span>
                      <span style={{ fontSize: 16, fontWeight: 700, color: "#22c55e" }}>{fmtDollar(optPeakPrice)}</span>
                    </div>
                    <input type="range" min={1} max={optimizerCalcs ? optimizerCalcs.sliderMax : 1000} step={1}
                      value={optPeakPrice} onChange={e => setOptPeakPrice(+e.target.value)}
                      style={{ width: "100%", accentColor: "#22c55e", cursor: "pointer" }} />
                  </div>
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                      <span className="input-label">Peak Day</span>
                      <span style={{ fontSize: 16, fontWeight: 700, color: "#f59e0b" }}>{optPeakDay}d</span>
                    </div>
                    <input type="range" min={1} max={optimizerCalcs ? optimizerCalcs.totalDays : 650} step={1}
                      value={optPeakDay} onChange={e => setOptPeakDay(+e.target.value)}
                      style={{ width: "100%", accentColor: "#f59e0b", cursor: "pointer" }} />
                  </div>
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                      <span className="input-label">Stock at Expiry</span>
                      <span style={{ fontSize: 16, fontWeight: 700, color: "#ef4444" }}>{fmtDollar(optFinalPrice)}</span>
                    </div>
                    <input type="range" min={1} max={optimizerCalcs ? optimizerCalcs.sliderMax : 1000} step={1}
                      value={optFinalPrice} onChange={e => setOptFinalPrice(+e.target.value)}
                      style={{ width: "100%", accentColor: "#ef4444", cursor: "pointer" }} />
                  </div>
                </div>
                {/* Mini stock path preview */}
                {optimizerCalcs && (
                  <div style={{ marginTop: 12, padding: "10px 16px", background: "#12151c", borderRadius: 8, border: "1px solid #1a1d28" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#4a5060" }}>
                      <span>Now: {fmtDollar(stockPrice.value)}</span>
                      <span>→ Peak: {fmtDollar(optPeakPrice)} @ day {optPeakDay}</span>
                      <span>→ Expiry: {fmtDollar(optFinalPrice)} @ day {optimizerCalcs.totalDays}</span>
                    </div>
                    <div style={{ height: 4, marginTop: 6, borderRadius: 2, background: "linear-gradient(90deg, #3b82f6, #22c55e " + (optPeakDay / optimizerCalcs.totalDays * 100) + "%, #ef4444)" }} />
                  </div>
                )}
              </div>

              {/* ─── OPTIMIZER RESULTS ─── */}
              {optimizerCalcs && (<>
                {/* Key Findings */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
                  <div className="card" style={{ borderTop: "2px solid #06b6d4", padding: "16px 20px" }}>
                    <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "1.5px", color: "#06b6d4", marginBottom: 6, fontWeight: 600 }}>
                      Optimal Roll Day
                    </div>
                    <div style={{ fontSize: 28, fontWeight: 700, color: "#e0e4ec" }}>
                      Day {optimizerCalcs.optimalRoll.day}
                    </div>
                    <div style={{ fontSize: 11, color: "#5a6070", marginTop: 4 }}>
                      {optimizerCalcs.optimalRoll.daysRemaining}d before expiry · Stock @ {fmtDollar(optimizerCalcs.optimalRoll.stockPrice)}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: optimizerCalcs.optimalRoll.rollAdvantage >= 0 ? "#22c55e" : "#ef4444", marginTop: 6 }}>
                      {fmtPnl(optimizerCalcs.optimalRoll.rollAdvantage)} vs hold
                    </div>
                  </div>

                  <div className="card" style={{ borderTop: "2px solid #22c55e", padding: "16px 20px" }}>
                    <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "1.5px", color: "#22c55e", marginBottom: 6, fontWeight: 600 }}>
                      Peak Position Value
                    </div>
                    <div style={{ fontSize: 28, fontWeight: 700, color: "#22c55e" }}>
                      {fmtDollar(optimizerCalcs.peakValue.positionValue)}
                    </div>
                    <div style={{ fontSize: 11, color: "#5a6070", marginTop: 4 }}>
                      Day {optimizerCalcs.peakValue.day} · {fmtPnl(optimizerCalcs.peakValue.currentPnl)} ({fmtPnlPct(optimizerCalcs.peakValue.currentPnlPct)})
                    </div>
                  </div>

                  <div className="card" style={{ borderTop: "2px solid #ef4444", padding: "16px 20px" }}>
                    <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "1.5px", color: "#ef4444", marginBottom: 6, fontWeight: 600 }}>
                      Hold to Expiry
                    </div>
                    <div style={{ fontSize: 28, fontWeight: 700, color: optimizerCalcs.rollAnalysis[optimizerCalcs.rollAnalysis.length - 1].holdPnl >= 0 ? "#22c55e" : "#ef4444" }}>
                      {fmtPnl(optimizerCalcs.rollAnalysis[optimizerCalcs.rollAnalysis.length - 1].holdPnl)}
                    </div>
                    <div style={{ fontSize: 11, color: "#5a6070", marginTop: 4 }}>
                      Intrinsic at expiry · Stock @ {fmtDollar(optFinalPrice)}
                    </div>
                  </div>

                  {optimizerCalcs.thetaCritical && (
                    <div className="card" style={{ borderTop: "2px solid #f59e0b", padding: "16px 20px" }}>
                      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "1.5px", color: "#f59e0b", marginBottom: 6, fontWeight: 600 }}>
                        Theta Danger Zone
                      </div>
                      <div style={{ fontSize: 28, fontWeight: 700, color: "#f59e0b" }}>
                        Day {optimizerCalcs.thetaCritical.day}
                      </div>
                      <div style={{ fontSize: 11, color: "#5a6070", marginTop: 4 }}>
                        Decay exceeds 0.5%/day of position · {optimizerCalcs.thetaCritical.daysRemaining}d to expiry
                      </div>
                    </div>
                  )}
                </div>

                {/* Roll at optimal point details */}
                <div className="card">
                  <div className="scenario-header"><span>Optimal Roll Breakdown</span><div className="divider" /></div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginTop: 12 }}>
                    <div style={{ padding: "14px 18px", background: "#12151c", borderRadius: 8, border: "1px solid #1a1d28", borderLeft: "3px solid #3b82f6" }}>
                      <div style={{ fontSize: 9, color: "#3b82f6", textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 600 }}>At Roll Day {optimizerCalcs.optimalRoll.day}</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 8 }}>
                        <div><div style={{ fontSize: 8, color: "#3a4050" }}>Stock</div><div style={{ fontSize: 14, fontWeight: 600, color: "#e0e4ec" }}>{fmtDollar(optimizerCalcs.optimalRoll.stockPrice)}</div></div>
                        <div><div style={{ fontSize: 8, color: "#3a4050" }}>Option Value</div><div style={{ fontSize: 14, fontWeight: 600, color: "#e0e4ec" }}>{fmtDollar(optimizerCalcs.optimalRoll.currentOptValue)}</div></div>
                        <div><div style={{ fontSize: 8, color: "#3a4050" }}>Time Value</div><div style={{ fontSize: 14, fontWeight: 600, color: "#f59e0b" }}>{fmtPct(optimizerCalcs.optimalRoll.timeValuePct)}</div></div>
                        <div><div style={{ fontSize: 8, color: "#3a4050" }}>Position P&L</div><div style={{ fontSize: 14, fontWeight: 600, color: optimizerCalcs.optimalRoll.currentPnl >= 0 ? "#22c55e" : "#ef4444" }}>{fmtPnl(optimizerCalcs.optimalRoll.currentPnl)}</div></div>
                      </div>
                    </div>
                    <div style={{ padding: "14px 18px", background: "#12151c", borderRadius: 8, border: "1px solid #1a1d28", borderLeft: "3px solid #f59e0b" }}>
                      <div style={{ fontSize: 9, color: "#f59e0b", textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 600 }}>Roll Into New LEAP</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 8 }}>
                        <div><div style={{ fontSize: 8, color: "#3a4050" }}>Sell Proceeds</div><div style={{ fontSize: 14, fontWeight: 600, color: "#e0e4ec" }}>{fmtDollar(optimizerCalcs.optimalRoll.sellProceeds)}</div></div>
                        <div><div style={{ fontSize: 8, color: "#3a4050" }}>New Entry Price</div><div style={{ fontSize: 14, fontWeight: 600, color: "#e0e4ec" }}>{fmtDollar(optimizerCalcs.optimalRoll.rollEntryPrice)}</div></div>
                        <div><div style={{ fontSize: 8, color: "#3a4050" }}>New Contracts</div><div style={{ fontSize: 14, fontWeight: 600, color: "#e0e4ec" }}>{optimizerCalcs.optimalRoll.rollContracts}x</div></div>
                        <div><div style={{ fontSize: 8, color: "#3a4050" }}>Strike</div><div style={{ fontSize: 14, fontWeight: 600, color: "#e0e4ec" }}>{fmtDollar(rollIntoStrike)}</div></div>
                      </div>
                    </div>
                    <div style={{ padding: "14px 18px", background: "#12151c", borderRadius: 8, border: "1px solid #1a1d28", borderLeft: "3px solid #22c55e" }}>
                      <div style={{ fontSize: 9, color: "#22c55e", textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 600 }}>Outcome Comparison</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 8 }}>
                        <div><div style={{ fontSize: 8, color: "#3a4050" }}>Hold P&L</div><div style={{ fontSize: 14, fontWeight: 600, color: optimizerCalcs.optimalRoll.holdPnl >= 0 ? "#22c55e" : "#ef4444" }}>{fmtPnl(optimizerCalcs.optimalRoll.holdPnl)}</div></div>
                        <div><div style={{ fontSize: 8, color: "#3a4050" }}>Roll P&L</div><div style={{ fontSize: 14, fontWeight: 600, color: optimizerCalcs.optimalRoll.rollPnlAtOrigExp >= 0 ? "#22c55e" : "#ef4444" }}>{fmtPnl(optimizerCalcs.optimalRoll.rollPnlAtOrigExp)}</div></div>
                        <div style={{ gridColumn: "1 / -1" }}><div style={{ fontSize: 8, color: "#3a4050" }}>Roll Advantage</div><div style={{ fontSize: 18, fontWeight: 700, color: optimizerCalcs.optimalRoll.rollAdvantage >= 0 ? "#22c55e" : "#ef4444" }}>{fmtPnl(optimizerCalcs.optimalRoll.rollAdvantage)}</div></div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Main Chart: Position Value + Time Value + Stock over time */}
                <div className="card">
                  <div className="scenario-header"><span>Position Value & Time Decay Over Life</span><div className="divider" /></div>
                  <ResponsiveContainer width="100%" height={380}>
                    <ComposedChart data={optimizerCalcs.rollAnalysis} margin={{ top: 20, right: 30, left: 20, bottom: 10 }}>
                      <defs>
                        <linearGradient id="opt-tv" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.2} />
                          <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1a1d28" />
                      <XAxis dataKey="day" tick={{ fontSize: 9, fill: "#4a5060" }} tickFormatter={d => d === 0 ? "Now" : `+${d}d`} />
                      <YAxis yAxisId="val" tick={{ fontSize: 9, fill: "#4a5060" }} tickFormatter={v => `$${(v / 1000).toFixed(1)}k`} />
                      <YAxis yAxisId="stock" orientation="right" tick={{ fontSize: 9, fill: "#4a506060" }} tickFormatter={v => `$${Number(v).toFixed(0)}`} />
                      <Tooltip
                        contentStyle={{ background: "#12151c", border: "1px solid #1e2330", borderRadius: 6, fontSize: 10, fontFamily: "JetBrains Mono" }}
                        formatter={(v, name) => {
                          if (name === "positionValue") return [fmtDollar(v), "Position Value"];
                          if (name === "currentPnl") return [fmtPnl(v), "P&L"];
                          if (name === "stockPrice") return [fmtDollar(v), "Stock"];
                          if (name === "timeValue") return [`${(v * 100).toFixed(1)}%`, "Time Value %"];
                          return [v, name];
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: 10 }} formatter={n => ({ positionValue: "Position Value", currentPnl: "P&L", stockPrice: "Stock Price", timeValue: "Time Value %" }[n] || n)} />
                      {/* Optimal roll marker */}
                      <ReferenceLine x={optimizerCalcs.optimalRoll.day} yAxisId="val" stroke="#06b6d4" strokeWidth={2} strokeDasharray="5 5" label={{ value: `Roll`, position: "top", fill: "#06b6d4", fontSize: 10 }} />
                      {optimizerCalcs.thetaCritical && (
                        <ReferenceLine x={optimizerCalcs.thetaCritical.day} yAxisId="val" stroke="#f59e0b80" strokeDasharray="3 3" label={{ value: "θ danger", position: "top", fill: "#f59e0b80", fontSize: 9 }} />
                      )}
                      <ReferenceLine x={optPeakDay} yAxisId="val" stroke="#22c55e40" strokeDasharray="3 3" />
                      <ReferenceLine y={0} yAxisId="val" stroke="#4a506060" />
                      <Line yAxisId="stock" type="monotone" dataKey="stockPrice" stroke="#4a506060" strokeWidth={1} dot={false} strokeDasharray="2 6" />
                      <Line yAxisId="val" type="monotone" dataKey="positionValue" stroke="#3b82f6" strokeWidth={2.5} dot={false} />
                      <Line yAxisId="val" type="monotone" dataKey="currentPnl" stroke="#22c55e" strokeWidth={2} dot={false} strokeDasharray="6 3" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>

                {/* Roll Advantage Chart: shows hold vs roll outcome at each possible roll day */}
                <div className="card">
                  <div className="scenario-header"><span>Roll vs Hold — When to Pull the Trigger</span><div className="divider" />
                    <span style={{ fontSize: 10, color: "#4a5060", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
                      Green = rolling beats holding · Blue = optimal roll point
                    </span>
                  </div>
                  <ResponsiveContainer width="100%" height={340}>
                    <ComposedChart data={optimizerCalcs.rollAnalysis} margin={{ top: 20, right: 30, left: 20, bottom: 10 }}>
                      <defs>
                        <linearGradient id="opt-adv-grad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#22c55e" stopOpacity={0.15} />
                          <stop offset="50%" stopColor="#22c55e" stopOpacity={0} />
                          <stop offset="51%" stopColor="#ef4444" stopOpacity={0} />
                          <stop offset="100%" stopColor="#ef4444" stopOpacity={0.15} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1a1d28" />
                      <XAxis dataKey="day" tick={{ fontSize: 9, fill: "#4a5060" }} tickFormatter={d => d === 0 ? "Now" : `+${d}d`} />
                      <YAxis tick={{ fontSize: 9, fill: "#4a5060" }} tickFormatter={v => `$${(v / 1000).toFixed(1)}k`} />
                      <Tooltip
                        contentStyle={{ background: "#12151c", border: "1px solid #1e2330", borderRadius: 6, fontSize: 10, fontFamily: "JetBrains Mono" }}
                        labelFormatter={d => {
                          const pt = optimizerCalcs.rollAnalysis.find(r => r.day === Number(d));
                          return pt ? `Day ${d} · ${pt.daysRemaining}d left · Stock: ${fmtDollar(pt.stockPrice)}` : `Day ${d}`;
                        }}
                        formatter={(v, name) => {
                          if (name === "rollAdvantage") return [fmtPnl(v), "Roll Advantage"];
                          if (name === "rollPnlAtOrigExp") return [fmtPnl(v), "Roll → P&L"];
                          if (name === "holdPnl") return [fmtPnl(v), "Hold → P&L"];
                          return [v, name];
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: 10 }} formatter={n => ({ rollAdvantage: "Roll Advantage", rollPnlAtOrigExp: "Roll → P&L", holdPnl: "Hold → P&L" }[n] || n)} />
                      <ReferenceLine y={0} stroke="#4a506060" strokeWidth={2} />
                      <ReferenceLine x={optimizerCalcs.optimalRoll.day} stroke="#06b6d4" strokeWidth={2} strokeDasharray="5 5" label={{ value: "Best Roll", position: "top", fill: "#06b6d4", fontSize: 10 }} />
                      <Area type="monotone" dataKey="rollAdvantage" fill="url(#opt-adv-grad)" stroke="none" />
                      <Line type="monotone" dataKey="rollAdvantage" name="rollAdvantage" stroke="#06b6d4" strokeWidth={2.5} dot={false} />
                      <Line type="monotone" dataKey="rollPnlAtOrigExp" name="rollPnlAtOrigExp" stroke="#22c55e" strokeWidth={1.5} dot={false} strokeDasharray="6 3" />
                      <Line type="monotone" dataKey="holdPnl" name="holdPnl" stroke="#ef4444" strokeWidth={1.5} dot={false} strokeDasharray="6 3" />
                    </ComposedChart>
                  </ResponsiveContainer>
                  <div style={{ fontSize: 10, color: "#3a4050", marginTop: 8 }}>
                    "Roll Advantage" = P&L if you roll at that day minus P&L if you hold to expiry. Above zero means rolling wins. The peak is your optimal roll point.
                  </div>
                </div>

                {/* Time Value Erosion Chart */}
                <div className="card">
                  <div className="scenario-header"><span>Time Value & Theta Erosion</span><div className="divider" /></div>
                  <ResponsiveContainer width="100%" height={280}>
                    <ComposedChart data={optimizerCalcs.rollAnalysis} margin={{ top: 20, right: 30, left: 20, bottom: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1a1d28" />
                      <XAxis dataKey="day" tick={{ fontSize: 9, fill: "#4a5060" }} tickFormatter={d => d === 0 ? "Now" : `+${d}d`} />
                      <YAxis yAxisId="pct" tick={{ fontSize: 9, fill: "#f59e0b" }} tickFormatter={v => `${(v * 100).toFixed(0)}%`} domain={[0, 1]} />
                      <YAxis yAxisId="theta" orientation="right" tick={{ fontSize: 9, fill: "#ef4444" }} tickFormatter={v => `$${Number(v).toFixed(2)}`} />
                      <Tooltip
                        contentStyle={{ background: "#12151c", border: "1px solid #1e2330", borderRadius: 6, fontSize: 10, fontFamily: "JetBrains Mono" }}
                        formatter={(v, name) => {
                          if (name === "timeValuePct") return [`${(v * 100).toFixed(1)}%`, "Time Value %"];
                          if (name === "dailyTheta") return [`$${Number(v).toFixed(4)}`, "Theta ($/day)"];
                          return [v, name];
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: 10 }} formatter={n => n === "timeValuePct" ? "Time Value %" : "Theta ($/day)"} />
                      <ReferenceLine x={optimizerCalcs.optimalRoll.day} yAxisId="pct" stroke="#06b6d480" strokeDasharray="5 5" />
                      {optimizerCalcs.thetaCritical && (
                        <ReferenceLine x={optimizerCalcs.thetaCritical.day} yAxisId="pct" stroke="#f59e0b60" strokeDasharray="3 3" />
                      )}
                      <Area yAxisId="pct" type="monotone" dataKey="timeValuePct" stroke="#f59e0b" fill="#f59e0b10" strokeWidth={2} dot={false} />
                      <Line yAxisId="theta" type="monotone" dataKey="dailyTheta" stroke="#ef4444" strokeWidth={1.5} dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                  <div style={{ fontSize: 10, color: "#3a4050", marginTop: 8 }}>
                    Time value % shows what portion of your option's price is pure time premium. As this drops, theta accelerates — the option's value becomes almost entirely path-dependent. Rolling before this cliff preserves time value in the new position.
                  </div>
                </div>

                {/* Scenario Matrix: Optimal roll day by final stock price */}
                <div className="card">
                  <div className="scenario-header"><span>Optimal Roll Day by Stock Outcome</span><div className="divider" />
                    <span style={{ fontSize: 10, color: "#4a5060", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
                      How does the best roll point shift if the stock ends up somewhere different?
                    </span>
                  </div>
                  <div style={{ overflowX: "auto", marginTop: 12 }}>
                    <table>
                      <thead><tr>
                        <th style={{ textAlign: "left" }}>Final Stock Price</th>
                        <th>Optimal Roll Day</th>
                        <th>Days Left</th>
                        <th>Hold → P&L</th>
                        <th>Roll → P&L</th>
                        <th>Roll Advantage</th>
                        <th>Verdict</th>
                      </tr></thead>
                      <tbody>
                        {optimizerCalcs.scenarioMatrix.map((row, i) => {
                          const isCurrentScenario = Math.abs(row.finalStockPrice - optFinalPrice) < (optimizerCalcs.scenarioStocks[1] - optimizerCalcs.scenarioStocks[0]) * 0.6;
                          // Find hold P&L and roll P&L for this scenario
                          const holdIntrinsic = optType === "call" ? Math.max(0, row.finalStockPrice - optStrike) : Math.max(0, optStrike - row.finalStockPrice);
                          const holdPnl = holdIntrinsic * 100 * optimizerCalcs.numContracts - optimizerCalcs.principal;
                          const optDay = row.dayPoints.reduce((best, dp) => dp.advantage > best.advantage ? dp : best, row.dayPoints[0]);
                          const rollPnl = optDay.rollPnl;
                          return (
                            <tr key={i} style={isCurrentScenario ? { background: "#06b6d408" } : {}}>
                              <td style={{ textAlign: "left", fontWeight: isCurrentScenario ? 600 : 400, color: isCurrentScenario ? "#06b6d4" : row.finalStockPrice >= optStrike ? "#22c55e" : "#ef4444" }}>
                                {fmtDollar(row.finalStockPrice)}
                                {row.finalStockPrice >= optStrike && <span style={{ fontSize: 8, color: "#22c55e80", marginLeft: 4 }}>ITM</span>}
                              </td>
                              <td style={{ fontWeight: 600 }}>Day {row.optimalDay}</td>
                              <td style={{ color: "#4a5060" }}>{optimizerCalcs.totalDays - row.optimalDay}d</td>
                              <td style={{ color: holdPnl >= 0 ? "#22c55e" : "#ef4444" }}>{fmtPnl(holdPnl)}</td>
                              <td style={{ color: rollPnl >= 0 ? "#22c55e" : "#ef4444" }}>{fmtPnl(rollPnl)}</td>
                              <td style={{ fontWeight: 600, color: row.bestAdvantage >= 0 ? "#22c55e" : "#ef4444" }}>{fmtPnl(row.bestAdvantage)}</td>
                              <td style={{ fontSize: 10, fontWeight: 600, color: row.bestAdvantage > 100 ? "#22c55e" : row.bestAdvantage < -100 ? "#ef4444" : "#4a5060" }}>
                                {row.bestAdvantage > 100 ? "ROLL" : row.bestAdvantage < -100 ? "HOLD" : "≈ SAME"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ fontSize: 10, color: "#3a4050", marginTop: 8 }}>
                    This matrix stress-tests the roll decision across different outcomes. "ROLL" means rolling at the optimal day produces significantly better returns than holding. The highlighted row matches your current forecast.
                  </div>
                </div>
              </>)}
            </>)}
          </div>
        )}

        {/* ─── TAB: MULTI-LEG STRATEGY ─── */}
        {activeTab === "strategy" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {/* Presets + Leg Builder */}
            <div className="card">
              <div className="scenario-header"><span>Strategy Builder</span><div className="divider" /></div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10, marginBottom: 14 }}>
                {Object.entries(PRESETS).map(([key, preset]) => (
                  <button key={key} className={`btn ${selectedPreset === key ? "btn-primary" : ""}`} onClick={() => applyPreset(key)}>
                    {preset.label}
                  </button>
                ))}
              </div>

              {/* Legs table */}
              {legs.length > 0 && (
                <div style={{ overflowX: "auto", marginBottom: 12 }}>
                  <table>
                    <thead><tr>
                      <th style={{ textAlign: "left" }}>#</th><th>Type</th><th>Direction</th><th>Strike</th><th>Premium</th><th>Qty</th><th>BS Price</th><th></th>
                    </tr></thead>
                    <tbody>
                      {legs.map((leg, i) => {
                        const legBS = blackScholes(c.S, leg.strike, c.T, c.r, c.activeIV, leg.type, c.q);
                        return (
                          <tr key={leg.id}>
                            <td style={{ textAlign: "left", color: "#e0e4ec" }}>{i + 1}</td>
                            <td>
                              <select value={leg.type} onChange={e => updateLeg(leg.id, "type", e.target.value)} style={{ width: 80, padding: "4px 6px", fontSize: 11 }}>
                                <option value="call">Call</option><option value="put">Put</option>
                              </select>
                            </td>
                            <td>
                              <select value={leg.dir} onChange={e => updateLeg(leg.id, "dir", e.target.value)} style={{ width: 80, padding: "4px 6px", fontSize: 11 }}>
                                <option value="long">Long</option><option value="short">Short</option>
                              </select>
                            </td>
                            <td><input type="number" value={leg.strike} onChange={e => updateLeg(leg.id, "strike", +e.target.value || 0)} step="1" style={{ width: 80, padding: "4px 6px", fontSize: 11 }} /></td>
                            <td><input type="number" value={leg.premium || ""} onChange={e => updateLeg(leg.id, "premium", +e.target.value || 0)} step="0.1" placeholder={fmt(legBS.price, 2)} style={{ width: 80, padding: "4px 6px", fontSize: 11 }} /></td>
                            <td><input type="number" value={leg.qty} onChange={e => updateLeg(leg.id, "qty", Math.max(1, +e.target.value || 1))} min="1" step="1" style={{ width: 60, padding: "4px 6px", fontSize: 11 }} /></td>
                            <td style={{ color: "#4a5060" }}>{fmtDollar(legBS.price)}</td>
                            <td><button className="btn btn-danger" onClick={() => removeLeg(leg.id)}>×</button></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <button className="btn" onClick={addLeg}>+ Add Leg</button>
            </div>

            {/* Strategy Summary */}
            {strategyCalcs && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
                  <div className="metric-box">
                    <div className="label">Net Cost</div>
                    <div className={`value ${strategyCalcs.netCost > 0 ? "red" : "green"}`}>{fmtDollar(Math.abs(strategyCalcs.netCost))}</div>
                    <div style={{ fontSize: 10, color: "#4a5060" }}>{strategyCalcs.netCost > 0 ? "Net Debit" : "Net Credit"}</div>
                  </div>
                  <div className="metric-box">
                    <div className="label">Max Profit (Expiry)</div>
                    <div className="value green">{strategyCalcs.maxProfit > 100000 ? "Unlimited" : fmtDollar(strategyCalcs.maxProfit)}</div>
                  </div>
                  <div className="metric-box">
                    <div className="label">Max Loss (Expiry)</div>
                    <div className="value red">{fmtDollar(strategyCalcs.maxLoss)}</div>
                  </div>
                  <div className="metric-box">
                    <div className="label">Breakeven(s)</div>
                    <div className="value">{strategyCalcs.breakevens.length > 0 ? strategyCalcs.breakevens.map(b => fmtDollar(b)).join(", ") : "—"}</div>
                  </div>
                </div>

                {/* Combined Greeks */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
                  {[
                    { label: "Position Delta", val: strategyCalcs.combinedGreeks.delta, color: "#3b82f6" },
                    { label: "Position Gamma", val: strategyCalcs.combinedGreeks.gamma, color: "#8b5cf6" },
                    { label: "Position Theta", val: strategyCalcs.combinedGreeks.theta, color: "#ef4444" },
                    { label: "Position Vega", val: strategyCalcs.combinedGreeks.vega, color: "#22c55e" },
                  ].map(g => (
                    <div key={g.label} className="metric-box">
                      <div className="label">{g.label}</div>
                      <div style={{ fontSize: 16, fontWeight: 600, color: g.color }}>{fmt(g.val, 2)}</div>
                    </div>
                  ))}
                </div>

                {/* Combined P&L Chart */}
                <div className="card">
                  <div className="scenario-header"><span>Combined P&L</span><div className="divider" /></div>
                  <ResponsiveContainer width="100%" height={350}>
                    <ComposedChart data={strategyCalcs.combPnlData} margin={{ top: 20, right: 30, left: 20, bottom: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1a1d28" />
                      <XAxis dataKey="stock" tick={{ fontSize: 9, fill: "#4a5060" }} tickFormatter={v => `$${Number(v).toFixed(0)}`} />
                      <YAxis tick={{ fontSize: 9, fill: "#4a5060" }} tickFormatter={v => `$${Number(v).toFixed(0)}`} />
                      <Tooltip contentStyle={{ background: "#12151c", border: "1px solid #1e2330", borderRadius: 6, fontSize: 10, fontFamily: "JetBrains Mono" }} labelFormatter={v => `Stock: $${Number(v).toFixed(2)}`} formatter={(v, n) => [`$${Number(v).toFixed(0)}`, n]} />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <ReferenceLine y={0} stroke="#4a506060" strokeWidth={2} />
                      <ReferenceLine x={c.S} stroke="#3b82f640" strokeDasharray="5 5" />
                      <Line type="monotone" dataKey="now" name="Now" stroke="#3b82f6" strokeWidth={2.5} dot={false} />
                      <Line type="monotone" dataKey="sixMonths" name="+6mo" stroke="#8b5cf6" strokeWidth={1.5} dot={false} strokeDasharray="4 4" />
                      <Line type="monotone" dataKey="oneYear" name="+1yr" stroke="#f59e0b" strokeWidth={1.5} dot={false} strokeDasharray="4 4" />
                      <Line type="monotone" dataKey="expiration" name="Expiry" stroke="#ef4444" strokeWidth={2} dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}

            {legs.length === 0 && (
              <div style={{ textAlign: "center", padding: 40, color: "#3a4050" }}>
                <div style={{ fontSize: 14, marginBottom: 8 }}>No legs configured</div>
                <div style={{ fontSize: 11 }}>Select a preset above or click "+ Add Leg" to build a custom strategy</div>
              </div>
            )}
          </div>
        )}

        {/* ─── TAB: IV MATRIX ─── */}
        {activeTab === "ivmatrix" && (
          <div className="card">
            <div className="scenario-header"><span>IV Sensitivity Matrix</span><div className="divider" />
              <span style={{ fontSize: 10, color: "#4a5060", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
                Option price at Stock × IV combinations · Current: {fmtDollar(c.optPx)}
              </span>
            </div>
            <div style={{ overflowX: "auto", marginTop: 12 }}>
              <table>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>Stock</th>
                    {c.ivSteps.map(ivD => (
                      <th key={ivD} style={{ color: ivD === 0 ? "#3b82f6" : undefined }}>
                        IV {ivD >= 0 ? "+" : ""}{ivD}%
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {c.ivMatrix.map((row, i) => {
                    const isCurrentRow = Math.abs(row.pricePct) < 3;
                    return (
                      <tr key={i} style={isCurrentRow ? { background: "#3b82f608" } : {}}>
                        <td style={{ textAlign: "left", color: "#e0e4ec", fontWeight: isCurrentRow ? 600 : 400 }}>
                          {fmtDollar(row.stockPrice)}
                          <span style={{ color: "#4a5060", fontSize: 10, marginLeft: 4 }}>
                            ({row.pricePct >= 0 ? "+" : ""}{row.pricePct}%)
                          </span>
                        </td>
                        {c.ivSteps.map(ivD => {
                          const pnl = row[`pnl_${ivD}`] || 0;
                          const isCenter = ivD === 0;
                          const intensity = Math.min(Math.abs(pnl) / 500, 1);
                          const bgColor = pnl >= 0
                            ? `rgba(34, 197, 94, ${intensity * 0.15})`
                            : `rgba(239, 68, 68, ${intensity * 0.15})`;
                          return (
                            <td key={ivD} style={{
                              background: bgColor,
                              color: pnl >= 0 ? "#22c55e" : "#ef4444",
                              fontWeight: isCenter ? 600 : 400,
                            }}>
                              {fmtDollar(row[`iv_${ivD}`])}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 12, fontSize: 10, color: "#3a4050" }}>
              Cell color intensity = P&L magnitude vs current option price ({fmtDollar(c.optPx)}). Green = profit, Red = loss. Center column = current IV ({fmtPct(c.activeIV)}).
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
