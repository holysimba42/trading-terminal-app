/**
 * HFT Cash v6 – Black-Scholes Greeks for 0DTE Options
 *
 * Provides analytical Greeks (delta, gamma, theta, vega, charm, vanna)
 * tuned for the extreme near-expiry regime where T → 0.
 *
 * All time inputs are in *years* (e.g. 6.5 market hours = 6.5/252/6.5 ≈ 0.00397).
 * Risk-free rate defaults to 5.25 % (current fed-funds proxy).
 */

const SQRT_2PI = Math.sqrt(2 * Math.PI);
const MIN_T = 1e-8; // clamp to avoid division-by-zero at expiry

/* ------------------------------------------------------------------ */
/*  Standard-normal helpers (Abramowitz & Stegun 26.2.17, |ε| < 7.5e-8) */
/* ------------------------------------------------------------------ */

export function normalPDF(x: number): number {
  return Math.exp(-0.5 * x * x) / SQRT_2PI;
}

export function normalCDF(x: number): number {
  if (x > 6) return 1;
  if (x < -6) return 0;
  const a1 = 0.319381530;
  const a2 = -0.356563782;
  const a3 = 1.781477937;
  const a4 = -1.821255978;
  const a5 = 1.330274429;
  const k = 1 / (1 + 0.2316419 * Math.abs(x));
  const poly = k * (a1 + k * (a2 + k * (a3 + k * (a4 + k * a5))));
  const cdf = 1 - normalPDF(x) * poly;
  return x >= 0 ? cdf : 1 - cdf;
}

/* ------------------------------------------------------------------ */
/*  Core pricing                                                       */
/* ------------------------------------------------------------------ */

export interface BSInputs {
  S: number;        // underlying spot
  K: number;        // strike
  T: number;        // time to expiry (years)
  r: number;        // risk-free rate
  sigma: number;    // implied vol (annualized)
  type: "call" | "put";
}

function d1d2(S: number, K: number, T: number, r: number, sigma: number) {
  const t = Math.max(T, MIN_T);
  const sqrtT = Math.sqrt(t);
  const sigSqrtT = sigma * sqrtT;
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * t) / sigSqrtT;
  const d2 = d1 - sigSqrtT;
  return { d1, d2, sqrtT, sigSqrtT };
}

export function blackScholes(inp: BSInputs): number {
  const { S, K, T, r, sigma, type } = inp;
  const t = Math.max(T, MIN_T);
  const { d1, d2 } = d1d2(S, K, t, r, sigma);
  const disc = Math.exp(-r * t);
  if (type === "call") return S * normalCDF(d1) - K * disc * normalCDF(d2);
  return K * disc * normalCDF(-d2) - S * normalCDF(-d1);
}

/* ------------------------------------------------------------------ */
/*  Greeks                                                             */
/* ------------------------------------------------------------------ */

export function delta(inp: BSInputs): number {
  const { d1 } = d1d2(inp.S, inp.K, Math.max(inp.T, MIN_T), inp.r, inp.sigma);
  if (inp.type === "call") return normalCDF(d1);
  return normalCDF(d1) - 1;
}

export function gamma(inp: BSInputs): number {
  const t = Math.max(inp.T, MIN_T);
  const { d1, sigSqrtT } = d1d2(inp.S, inp.K, t, inp.r, inp.sigma);
  return normalPDF(d1) / (inp.S * sigSqrtT);
}

export function theta(inp: BSInputs): number {
  const t = Math.max(inp.T, MIN_T);
  const { d1, d2, sqrtT } = d1d2(inp.S, inp.K, t, inp.r, inp.sigma);
  const term1 = -(inp.S * normalPDF(d1) * inp.sigma) / (2 * sqrtT);
  const disc = Math.exp(-inp.r * t);
  if (inp.type === "call") return term1 - inp.r * inp.K * disc * normalCDF(d2);
  return term1 + inp.r * inp.K * disc * normalCDF(-d2);
}

export function vega(inp: BSInputs): number {
  const t = Math.max(inp.T, MIN_T);
  const { d1, sqrtT } = d1d2(inp.S, inp.K, t, inp.r, inp.sigma);
  return inp.S * sqrtT * normalPDF(d1);
}

/**
 * Charm  = −∂δ/∂T  (how delta decays with time)
 * Critical for 0DTE: drives dealer rebalancing flows as expiry approaches.
 */
export function charm(inp: BSInputs): number {
  const t = Math.max(inp.T, MIN_T);
  const { d1, d2, sqrtT } = d1d2(inp.S, inp.K, t, inp.r, inp.sigma);
  const pdf = normalPDF(d1);
  const term = 2 * inp.r * t - d2 * inp.sigma * sqrtT;
  const ch = -pdf * term / (2 * t * inp.sigma * sqrtT);
  if (inp.type === "call") return ch;
  return ch; // symmetric in standard BS
}

/**
 * Vanna  = ∂δ/∂σ  = ∂vega/∂S
 * Measures how delta changes with IV — key for vol-regime entries.
 */
export function vanna(inp: BSInputs): number {
  const t = Math.max(inp.T, MIN_T);
  const { d1, d2, sigSqrtT } = d1d2(inp.S, inp.K, t, inp.r, inp.sigma);
  return -normalPDF(d1) * d2 / inp.sigma;
}

/* ------------------------------------------------------------------ */
/*  Implied-vol solver (Newton–Raphson)                                */
/* ------------------------------------------------------------------ */

export function impliedVolatility(
  marketPrice: number,
  S: number,
  K: number,
  T: number,
  r: number,
  type: "call" | "put",
  maxIter = 50,
  tol = 1e-6
): number {
  let sigma = 0.3; // initial guess
  for (let i = 0; i < maxIter; i++) {
    const price = blackScholes({ S, K, T, r, sigma, type });
    const v = vega({ S, K, T, r, sigma, type });
    if (Math.abs(v) < 1e-12) break;
    const diff = price - marketPrice;
    if (Math.abs(diff) < tol) return sigma;
    sigma -= diff / v;
    if (sigma <= 0.001) sigma = 0.001;
    if (sigma > 5) sigma = 5;
  }
  return sigma;
}

/* ------------------------------------------------------------------ */
/*  Helpers for intraday time conversion                               */
/* ------------------------------------------------------------------ */

const MARKET_HOURS_PER_YEAR = 252 * 6.5;

/** Convert minutes remaining in trading day to years for BS. */
export function minutesToYears(minutesRemaining: number): number {
  return Math.max(minutesRemaining / 60 / MARKET_HOURS_PER_YEAR, MIN_T);
}

/** Convert a time-of-day (ET, "HH:MM") to minutes remaining (market closes 16:00 ET). */
export function timeToMinutesRemaining(hour: number, minute: number): number {
  const closeMinute = 16 * 60;
  const nowMinute = hour * 60 + minute;
  return Math.max(closeMinute - nowMinute, 0);
}
