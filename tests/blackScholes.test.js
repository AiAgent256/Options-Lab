/**
 * Black-Scholes Engine Unit Tests
 * 
 * Run: node tests/blackScholes.test.js
 * 
 * Tests validate against known analytical results and boundary conditions.
 * No test framework needed — just assertions.
 */

import { blackScholes, impliedVol, normalCDF, normalPDF } from "../src/engine/blackScholes.js";

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

function assertClose(actual, expected, tolerance, message) {
  const diff = Math.abs(actual - expected);
  if (diff <= tolerance) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${message} — expected ${expected}, got ${actual} (diff ${diff.toFixed(8)}, tol ${tolerance})`);
  }
}

function section(name) {
  console.log(`\n── ${name} ──`);
}

// ─── NORMAL CDF/PDF ─────────────────────────────────────────────────────────
section("normalCDF");
assertClose(normalCDF(0), 0.5, 1e-6, "N(0) = 0.5");
assertClose(normalCDF(1.96), 0.975, 0.001, "N(1.96) ≈ 0.975");
assertClose(normalCDF(-1.96), 0.025, 0.001, "N(-1.96) ≈ 0.025");
assertClose(normalCDF(3), 0.99865, 0.001, "N(3) ≈ 0.9987");
assertClose(normalCDF(-3), 0.00135, 0.001, "N(-3) ≈ 0.0013");

section("normalPDF");
assertClose(normalPDF(0), 0.3989, 0.001, "n(0) ≈ 0.3989");
assertClose(normalPDF(1), 0.2420, 0.001, "n(1) ≈ 0.2420");

// ─── BLACK-SCHOLES PRICING ──────────────────────────────────────────────────
section("Black-Scholes Call Pricing");

// Classic textbook example: S=100, K=100, T=1, r=5%, σ=20%
// Expected call ≈ $10.45 (Hull, Options Futures and Other Derivatives)
{
  const bs = blackScholes(100, 100, 1, 0.05, 0.20, "call");
  assertClose(bs.price, 10.4506, 0.05, "ATM call S=100 K=100 T=1 r=5% σ=20%");
  assertClose(bs.delta, 0.6368, 0.01, "ATM call delta ≈ 0.64");
  assert(bs.gamma > 0, "gamma should be positive");
  assert(bs.theta < 0, "theta should be negative for long call");
  assert(bs.vega > 0, "vega should be positive");
  assert(bs.rho > 0, "rho should be positive for call");
}

section("Black-Scholes Put Pricing");
{
  const bs = blackScholes(100, 100, 1, 0.05, 0.20, "put");
  // Put-call parity: C - P = S - K*e^(-rT)
  const callBS = blackScholes(100, 100, 1, 0.05, 0.20, "call");
  const parity = callBS.price - bs.price;
  const expected = 100 - 100 * Math.exp(-0.05);
  assertClose(parity, expected, 0.01, "Put-call parity holds");
  assert(bs.delta < 0, "put delta should be negative");
  assert(bs.theta < 0, "theta should be negative for long put");
  assert(bs.rho < 0, "rho should be negative for put");
}

section("Deep ITM / OTM");
{
  // Deep ITM call: S=200, K=50 → price ≈ S - K*e^(-rT) for very deep ITM
  const deepITM = blackScholes(200, 50, 1, 0.05, 0.20, "call");
  assert(deepITM.price > 145, "deep ITM call should be close to intrinsic");
  assertClose(deepITM.delta, 1.0, 0.01, "deep ITM call delta ≈ 1.0");

  // Deep OTM call: S=50, K=200
  const deepOTM = blackScholes(50, 200, 1, 0.05, 0.20, "call");
  assert(deepOTM.price < 0.01, "deep OTM call should be near zero");
  assertClose(deepOTM.delta, 0.0, 0.01, "deep OTM call delta ≈ 0.0");
}

section("Boundary conditions");
{
  // Expired option
  const expired = blackScholes(100, 90, 0, 0.05, 0.20, "call");
  assertClose(expired.price, 10, 0.01, "expired ITM call = intrinsic value");

  const expiredOTM = blackScholes(80, 100, 0, 0.05, 0.20, "call");
  assertClose(expiredOTM.price, 0, 0.01, "expired OTM call = 0");

  // NaN/Infinity inputs
  const bad = blackScholes(NaN, 100, 1, 0.05, 0.20, "call");
  assertClose(bad.price, 0, 0.001, "NaN input → price = 0");
  assertClose(bad.delta, 0, 0.001, "NaN input → delta = 0");

  // Zero volatility
  const zeroVol = blackScholes(100, 90, 1, 0.05, 0, "call");
  assertClose(zeroVol.price, 10, 0.01, "zero vol ITM call = intrinsic");
}

section("Dividend yield");
{
  // With dividend yield, call should be cheaper, put more expensive
  const noDiv = blackScholes(100, 100, 1, 0.05, 0.20, "call", 0);
  const withDiv = blackScholes(100, 100, 1, 0.05, 0.20, "call", 0.03);
  assert(withDiv.price < noDiv.price, "dividend yield reduces call value");

  const noDivPut = blackScholes(100, 100, 1, 0.05, 0.20, "put", 0);
  const withDivPut = blackScholes(100, 100, 1, 0.05, 0.20, "put", 0.03);
  assert(withDivPut.price > noDivPut.price, "dividend yield increases put value");
}

// ─── IMPLIED VOLATILITY SOLVER ──────────────────────────────────────────────
section("Implied Volatility Solver");
{
  // Round-trip test: price an option, then solve for IV from that price
  const targetIV = 0.30;
  const bs = blackScholes(100, 100, 1, 0.05, targetIV, "call");
  const solvedIV = impliedVol(bs.price, 100, 100, 1, 0.05, "call");
  assertClose(solvedIV, targetIV, 0.001, "IV round-trip: 30% call");

  // Put round-trip
  const bsPut = blackScholes(100, 100, 1, 0.05, 0.25, "put");
  const solvedPutIV = impliedVol(bsPut.price, 100, 100, 1, 0.05, "put");
  assertClose(solvedPutIV, 0.25, 0.001, "IV round-trip: 25% put");

  // Deep OTM — tests bisection fallback
  const deepOTMbs = blackScholes(100, 200, 0.5, 0.05, 0.40, "call");
  const deepOTMiv = impliedVol(deepOTMbs.price, 100, 200, 0.5, 0.05, "call");
  assertClose(deepOTMiv, 0.40, 0.02, "IV round-trip: 40% deep OTM call");

  // High IV
  const highIVbs = blackScholes(100, 100, 1, 0.05, 1.50, "call");
  const highIVsolved = impliedVol(highIVbs.price, 100, 100, 1, 0.05, "call");
  assertClose(highIVsolved, 1.50, 0.02, "IV round-trip: 150% vol");

  // Edge cases
  const badIV = impliedVol(0, 100, 100, 1, 0.05, "call");
  assertClose(badIV, 0.3, 0.01, "IV solver handles zero market price gracefully");

  const nanIV = impliedVol(NaN, 100, 100, 1, 0.05, "call");
  assertClose(nanIV, 0.3, 0.01, "IV solver handles NaN gracefully");
}

// ─── GREEKS CONSISTENCY ─────────────────────────────────────────────────────
section("Greeks numerical consistency");
{
  const S = 100, K = 100, T = 1, r = 0.05, sigma = 0.25;
  const h = 0.01; // bump size

  // Delta: ∂price/∂S ≈ (BS(S+h) - BS(S-h)) / (2h)
  const bsUp = blackScholes(S + h, K, T, r, sigma, "call");
  const bsDown = blackScholes(S - h, K, T, r, sigma, "call");
  const bs = blackScholes(S, K, T, r, sigma, "call");
  const numDelta = (bsUp.price - bsDown.price) / (2 * h);
  assertClose(bs.delta, numDelta, 0.001, "analytical delta ≈ numerical delta");

  // Gamma: ∂²price/∂S² ≈ (BS(S+h) - 2*BS(S) + BS(S-h)) / h²
  const numGamma = (bsUp.price - 2 * bs.price + bsDown.price) / (h * h);
  assertClose(bs.gamma, numGamma, 0.01, "analytical gamma ≈ numerical gamma");

  // Vega: ∂price/∂σ (per 1%) 
  const hv = 0.001;
  const bsVUp = blackScholes(S, K, T, r, sigma + hv, "call");
  const bsVDown = blackScholes(S, K, T, r, sigma - hv, "call");
  const numVega = (bsVUp.price - bsVDown.price) / (2 * hv) / 100;
  assertClose(bs.vega, numVega, 0.01, "analytical vega ≈ numerical vega");
}

// ─── CRYPTO-SCALE PRICING ───────────────────────────────────────────────────
section("Crypto-scale prices (BTC-like)");
{
  // Ensure the engine handles large prices without numerical issues
  const bs = blackScholes(100000, 110000, 1, 0.045, 0.60, "call");
  assert(bs.price > 0, "BTC-scale call has positive price");
  assert(bs.price < 100000, "BTC-scale call price is reasonable");
  assert(isFinite(bs.delta), "BTC-scale delta is finite");
  assert(isFinite(bs.gamma), "BTC-scale gamma is finite");
  assert(isFinite(bs.theta), "BTC-scale theta is finite");

  // Round-trip IV at crypto scale
  const ivSolved = impliedVol(bs.price, 100000, 110000, 1, 0.045, "call");
  assertClose(ivSolved, 0.60, 0.02, "IV round-trip at BTC scale");
}

// ─── SUMMARY ────────────────────────────────────────────────────────────────
console.log(`\n${"═".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) {
  console.log("⚠ SOME TESTS FAILED");
  process.exit(1);
} else {
  console.log("✓ All tests passed");
}
