/**
 * Black-Scholes Options Pricing Engine
 * 
 * Provides European option pricing with continuous dividend yield,
 * full Greeks computation, and implied volatility solver.
 * 
 * This module is pure math — no React, no DOM, no side effects.
 * All functions are deterministic given the same inputs.
 */

// ─── STATISTICAL FUNCTIONS ──────────────────────────────────────────────────

/**
 * Standard normal cumulative distribution function.
 * Uses Abramowitz & Stegun approximation (equation 7.1.26).
 * Max error: |ε| < 1.5×10⁻⁷
 */
export function normalCDF(x) {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
  return 0.5 * (1.0 + sign * y);
}

/**
 * Standard normal probability density function.
 */
export function normalPDF(x) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

// ─── BLACK-SCHOLES PRICING ──────────────────────────────────────────────────

const EMPTY_GREEKS = Object.freeze({ price: 0, delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0 });

/**
 * Black-Scholes European option pricing with Greeks.
 * 
 * @param {number} S     - Current stock/underlying price
 * @param {number} K     - Strike price
 * @param {number} T     - Time to expiration in years
 * @param {number} r     - Risk-free interest rate (annualized, e.g. 0.045 = 4.5%)
 * @param {number} sigma - Volatility (annualized, e.g. 0.30 = 30%)
 * @param {string} type  - "call" or "put"
 * @param {number} q     - Continuous dividend yield (default 0)
 * 
 * @returns {{ price, delta, gamma, theta, vega, rho }}
 *   - price: theoretical option value
 *   - delta: ∂price/∂S (per $1 move in underlying)
 *   - gamma: ∂²price/∂S² (rate of delta change)
 *   - theta: daily time decay (negative = losing value)
 *   - vega:  sensitivity to 1% IV change
 *   - rho:   sensitivity to 1% rate change
 */
export function blackScholes(S, K, T, r, sigma, type = "call", q = 0) {
  // Guard against non-finite inputs
  if (!isFinite(S) || !isFinite(K) || !isFinite(T) || !isFinite(r) || !isFinite(sigma) || !isFinite(q)) {
    return { ...EMPTY_GREEKS };
  }

  // Expired or degenerate inputs → intrinsic value only
  if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) {
    return { ...EMPTY_GREEKS, price: Math.max(0, type === "call" ? S - K : K - S) };
  }

  const sqrtT = Math.sqrt(T);
  const eqT = Math.exp(-q * T);
  const erT = Math.exp(-r * T);
  const d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;

  if (!isFinite(d1) || !isFinite(d2)) return { ...EMPTY_GREEKS };

  let price, delta;
  if (type === "call") {
    price = S * eqT * normalCDF(d1) - K * erT * normalCDF(d2);
    delta = eqT * normalCDF(d1);
  } else {
    price = K * erT * normalCDF(-d2) - S * eqT * normalCDF(-d1);
    delta = -eqT * normalCDF(-d1);
  }

  const gamma = eqT * normalPDF(d1) / (S * sigma * sqrtT);

  const thetaCall = (-S * eqT * normalPDF(d1) * sigma / (2 * sqrtT)
    + q * S * eqT * normalCDF(d1)
    - r * K * erT * normalCDF(d2)) / 365;
  const thetaPut = (-S * eqT * normalPDF(d1) * sigma / (2 * sqrtT)
    - q * S * eqT * normalCDF(-d1)
    + r * K * erT * normalCDF(-d2)) / 365;
  const theta = type === "call" ? thetaCall : thetaPut;

  // Vega per 1% (0.01) move in volatility
  const vega = S * eqT * normalPDF(d1) * sqrtT / 100;

  // Rho per 1% (0.01) move in interest rate
  const rhoCall = K * T * erT * normalCDF(d2) / 100;
  const rhoPut = -K * T * erT * normalCDF(-d2) / 100;
  const rho = type === "call" ? rhoCall : rhoPut;

  return { price, delta, gamma, theta, vega, rho };
}

// ─── IMPLIED VOLATILITY SOLVER ──────────────────────────────────────────────

/**
 * Solve for implied volatility using Newton-Raphson with bisection fallback.
 * 
 * @param {number} marketPrice  - Observed market price of the option
 * @param {number} S            - Current underlying price
 * @param {number} K            - Strike price
 * @param {number} T            - Time to expiration in years
 * @param {number} r            - Risk-free rate
 * @param {string} type         - "call" or "put"
 * @param {number} q            - Dividend yield (default 0)
 * @param {number} initialGuess - Starting IV estimate (default 0.3 = 30%)
 * 
 * @returns {number} Implied volatility (annualized, e.g. 0.30 = 30%)
 */
export function impliedVol(marketPrice, S, K, T, r, type = "call", q = 0, initialGuess = 0.3) {
  if (!isFinite(marketPrice) || !isFinite(S) || !isFinite(K) || !isFinite(T) || !isFinite(r)) {
    return initialGuess;
  }
  if (marketPrice <= 0 || S <= 0 || K <= 0 || T <= 0) return initialGuess;

  const IV_MIN = 0.01;
  const IV_MAX = 5.0;
  const PRICE_TOL = 0.0001;

  // Phase 1: Newton-Raphson (fast convergence near solution)
  let sigma = Math.max(IV_MIN, Math.min(initialGuess, IV_MAX));
  let bestSigma = sigma;
  let bestErr = Infinity;

  for (let i = 0; i < 100; i++) {
    const bs = blackScholes(S, K, T, r, sigma, type, q);
    const diff = bs.price - marketPrice;
    const err = Math.abs(diff);

    if (err < bestErr) { bestErr = err; bestSigma = sigma; }
    if (err < PRICE_TOL) return sigma;

    // Vega in absolute terms (undo the /100 scaling)
    const vegaAbs = bs.vega * 100;
    if (vegaAbs < 0.00001) break;

    sigma -= diff / vegaAbs;
    sigma = Math.max(IV_MIN, Math.min(sigma, IV_MAX));
  }

  if (bestErr < 0.01) return bestSigma;

  // Phase 2: Bisection fallback (guaranteed convergence for deep OTM)
  let lo = IV_MIN, hi = IV_MAX;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    const bs = blackScholes(S, K, T, r, mid, type, q);
    const diff = bs.price - marketPrice;

    if (Math.abs(diff) < PRICE_TOL) return mid;
    if (diff > 0) hi = mid; else lo = mid;
    if (hi - lo < PRICE_TOL) return mid;
  }

  return (lo + hi) / 2;
}
