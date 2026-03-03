/**
 * HFT Cash v6 – Realistic 0DTE SPY Quote Generator
 *
 * Produces intraday SPY price paths and corresponding 0DTE option quote
 * streams with:
 *   • GBM with intraday volatility seasonality (U-shape)
 *   • Implied-vol surface (smile + term structure for 0DTE)
 *   • Bid-ask spread dynamics (wider at open/close)
 *   • Volume seasonality (U-shape)
 *   • GEX-based pinning/breakout regime effects
 *   • Charm-driven delta decay patterns
 */

import {
  blackScholes,
  gamma as bsGamma,
  delta as bsDelta,
  charm as bsCharm,
  minutesToYears,
} from "./greeks.js";
import type { OptionsQuote } from "./parser.js";

/* ------------------------------------------------------------------ */
/*  Seeded PRNG (xoshiro128** variant for reproducibility)             */
/* ------------------------------------------------------------------ */

export function createRNG(seed: number): () => number {
  let s = seed | 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    return ((s >>> 0) / 4294967296);
  };
}

function boxMuller(rng: () => number): number {
  let u: number, v: number, s: number;
  do {
    u = 2 * rng() - 1;
    v = 2 * rng() - 1;
    s = u * u + v * v;
  } while (s >= 1 || s === 0);
  return u * Math.sqrt(-2 * Math.log(s) / s);
}

/* ------------------------------------------------------------------ */
/*  Intraday SPY Price Path                                            */
/* ------------------------------------------------------------------ */

export interface IntradayConfig {
  openPrice: number;       // SPY open price (e.g. 580)
  annualVol: number;       // annualized vol (e.g. 0.15 = 15%)
  ticksPerDay: number;     // simulation resolution (e.g. 390 = 1-min bars)
  seed: number;
  driftAnnual?: number;    // annual drift (default 0.08 = 8%)
  gexLevel?: number;       // -1 (strong negative) to +1 (strong positive), controls pinning
  trendBias?: number;      // -1 to +1 for directional day character
}

export interface PriceTick {
  minuteOfDay: number;     // 0 = 9:30 ET, 389 = 15:59 ET
  price: number;
  realizedVol: number;     // instantaneous vol at this tick
  volume: number;          // relative volume
}

/**
 * Intraday vol multiplier — U-shaped.
 * Open (9:30) ≈ 1.8x, 11:00 ≈ 0.8x, 12:30 ≈ 0.7x, 15:00 ≈ 1.0x, 15:50+ ≈ 1.5x
 */
function intradayVolMultiplier(minuteOfDay: number): number {
  const t = minuteOfDay / 390; // normalized 0-1
  return 0.7 + 1.1 * Math.exp(-8 * t) + 0.8 * Math.exp(-12 * (1 - t) * (1 - t));
}

function intradayVolumeMultiplier(minuteOfDay: number): number {
  const t = minuteOfDay / 390;
  return 0.5 + 1.5 * Math.exp(-6 * t) + 2.0 * Math.exp(-15 * (1 - t) * (1 - t));
}

/**
 * GEX pinning effect: when GEX is positive, price is attracted to round strikes.
 * Modeled as a mean-reverting drift toward nearest $5 strike.
 */
function gexDrift(price: number, gexLevel: number): number {
  if (Math.abs(gexLevel) < 0.05) return 0;
  const nearest5 = Math.round(price / 5) * 5;
  const dist = nearest5 - price;
  // Positive GEX: strong mean-reversion to strikes (dealer gamma hedging)
  // Negative GEX: anti-pinning (dealers amplify moves away from strikes)
  const strength = gexLevel > 0 ? 0.0008 : -0.0003;
  return strength * gexLevel * dist;
}

export function generateIntradayPath(cfg: IntradayConfig): PriceTick[] {
  const rng = createRNG(cfg.seed);
  const ticks = cfg.ticksPerDay;
  const dt = 1 / (252 * 390); // one minute in years
  const drift = (cfg.driftAnnual ?? 0.08) * dt;
  const gex = cfg.gexLevel ?? 0;
  const trend = cfg.trendBias ?? 0;
  const path: PriceTick[] = [];
  let price = cfg.openPrice;

  // Momentum autocorrelation: real markets have serial correlation
  // in short-term returns due to order flow, HFT, and dealer hedging.
  // Hurst exponent for SPY intraday ≈ 0.55-0.65 (mild persistence).
  // Hurst exponent for SPY intraday ≈ 0.55-0.65; negative GEX amplifies trending
  const autocorrelation = gex < -0.15 ? 0.55 : gex > 0.15 ? -0.25 : 0.20;
  let prevReturn = 0;

  // Regime-based drift: trending days have persistent moves;
  // range-bound days mean-revert at round-number strikes.
  const trendMagnitude = Math.abs(trend);

  for (let i = 0; i < ticks; i++) {
    const volMult = intradayVolMultiplier(i);
    const instantVol = cfg.annualVol * volMult;
    const sigma = instantVol * Math.sqrt(dt);
    const z = boxMuller(rng);

    // Serial-correlated return: blend fresh noise with previous return
    const freshReturn = sigma * z;
    const correlatedReturn = autocorrelation * prevReturn + (1 - Math.abs(autocorrelation)) * freshReturn;

    const gexPull = gexDrift(price, gex);

    // Trend drift scales with trendBias: creates real directional days
    // Calibrated to produce ~0.5-1.5% daily range on trending days
    const trendDrift = trend * 0.00018;

    // Momentum burst: occasional strong moves in trend direction
    // Models order flow surges, stop-hunting, and institutional sweeps
    const burstChance = rng();
    const burst = (burstChance < 0.03 && trendMagnitude > 0.2)
      ? trend * 0.001 * price
      : 0;

    const dS = price * (drift + trendDrift + gexPull) + price * correlatedReturn + burst;
    price = Math.max(price + dS, price * 0.97);
    prevReturn = correlatedReturn;

    const vol = intradayVolumeMultiplier(i);
    path.push({
      minuteOfDay: i,
      price: Math.round(price * 100) / 100,
      realizedVol: instantVol,
      volume: Math.round(vol * 1000),
    });
  }

  return path;
}

/* ------------------------------------------------------------------ */
/*  0DTE Option Quote Stream                                           */
/* ------------------------------------------------------------------ */

export interface QuoteStreamConfig {
  strikes: number[];       // strikes to generate (e.g. [575, 576, ..., 585])
  riskFreeRate?: number;   // default 0.0525
  baseIV?: number;         // default 0.20
  optionType?: "call" | "put";
}

export interface EnrichedQuote extends OptionsQuote {
  minuteOfDay: number;
  greeks: {
    delta: number;
    gamma: number;
    charm: number;
    iv: number;
  };
  volume: number;
  gexContribution: number; // this strike's contribution to aggregate GEX
}

/**
 * IV smile for 0DTE: OTM options have higher IV.
 * Smile steepens as time to expiry shrinks.
 */
function ivSmile(
  S: number,
  K: number,
  baseIV: number,
  minutesRemaining: number
): number {
  const moneyness = Math.log(K / S);
  const timeFactor = Math.max(0.1, minutesRemaining / 390);
  const smileWidth = 0.05 / timeFactor; // steepens near expiry
  const skew = -0.02 * moneyness; // puts have higher IV (negative skew)
  return baseIV * (1 + smileWidth * moneyness * moneyness + skew);
}

/**
 * Bid-ask spread for 0DTE (in dollars per contract).
 * Tighter mid-day, wider at open/close and for OTM strikes.
 */
function bidAskSpread(
  optionPrice: number,
  minuteOfDay: number,
  moneyness: number
): number {
  const timeSpread = minuteOfDay < 30 || minuteOfDay > 360
    ? 0.03
    : 0.01;
  const otmSpread = Math.abs(moneyness) > 0.02 ? 0.02 : 0;
  const pctSpread = Math.max(0.01, (timeSpread + otmSpread));
  return Math.max(0.01, Math.min(pctSpread, optionPrice * 0.5));
}

export function generateQuoteStream(
  pricePath: PriceTick[],
  qCfg: QuoteStreamConfig,
  samplingInterval = 5, // every N minutes
): EnrichedQuote[][] {
  const r = qCfg.riskFreeRate ?? 0.0525;
  const baseIV = qCfg.baseIV ?? 0.20;
  const optType = qCfg.optionType ?? "call";
  const today = new Date().toISOString().slice(0, 10);
  const dayQuotes: EnrichedQuote[][] = [];

  for (let i = 0; i < pricePath.length; i += samplingInterval) {
    const tick = pricePath[i];
    const minutesRemaining = 390 - tick.minuteOfDay;
    const T = minutesToYears(minutesRemaining);
    const tickQuotes: EnrichedQuote[] = [];

    for (const K of qCfg.strikes) {
      const S = tick.price;
      const iv = ivSmile(S, K, baseIV, minutesRemaining);

      const theoPrice = blackScholes({ S, K, T, r, sigma: iv, type: optType });
      if (theoPrice < 0.005) continue; // skip near-zero options

      const moneyness = Math.log(K / S);
      const spread = bidAskSpread(theoPrice, tick.minuteOfDay, moneyness);
      const bid = Math.max(0.01, Math.round((theoPrice - spread / 2) * 100) / 100);
      const ask = Math.round((theoPrice + spread / 2) * 100) / 100;
      const mid = Math.round((bid + ask) / 2 * 100) / 100;

      const bsIn = { S, K, T, r, sigma: iv, type: optType as "call" | "put" };
      const d = bsDelta(bsIn);
      const g = bsGamma(bsIn);
      const ch = bsCharm(bsIn);

      const oiProxy = Math.max(100, Math.round(5000 * Math.exp(-20 * moneyness * moneyness)));
      const gexContrib = g * oiProxy * 100 * S * S * 0.01;

      tickQuotes.push({
        symbol: "SPY",
        strike: K,
        expiry: today,
        bid,
        ask,
        mid,
        minuteOfDay: tick.minuteOfDay,
        greeks: { delta: d, gamma: g, charm: ch, iv },
        volume: Math.round(tick.volume * (1 + Math.random() * 0.3)),
        gexContribution: gexContrib,
      });
    }

    dayQuotes.push(tickQuotes);
  }

  return dayQuotes;
}

/* ------------------------------------------------------------------ */
/*  Multi-day dataset generation                                       */
/* ------------------------------------------------------------------ */

export interface DayData {
  dayIndex: number;
  pricePath: PriceTick[];
  quoteStream: EnrichedQuote[][];
  dayCharacter: "trending-up" | "trending-down" | "range-bound" | "volatile";
  gexRegime: "positive" | "negative" | "neutral";
}

export interface DatasetConfig {
  days: number;
  baseSeed: number;
  basePrice?: number;
  strikes?: number[];
  annualVol?: number;
}

export function generateDataset(cfg: DatasetConfig): DayData[] {
  const rng = createRNG(cfg.baseSeed);
  const dataset: DayData[] = [];
  let prevClose = cfg.basePrice ?? 580;

  for (let d = 0; d < cfg.days; d++) {
    const r1 = rng();
    const dayChar: DayData["dayCharacter"] =
      r1 < 0.3 ? "trending-up" :
      r1 < 0.5 ? "trending-down" :
      r1 < 0.8 ? "range-bound" : "volatile";

    const trendBias =
      dayChar === "trending-up" ? 0.3 + rng() * 0.4 :
      dayChar === "trending-down" ? -(0.3 + rng() * 0.4) :
      dayChar === "range-bound" ? (rng() - 0.5) * 0.1 :
      (rng() - 0.5) * 0.6;

    const gexVal =
      dayChar === "range-bound" ? 0.3 + rng() * 0.5 :
      dayChar === "volatile" ? -(0.2 + rng() * 0.5) :
      (rng() - 0.5) * 0.4;

    const gexRegime: DayData["gexRegime"] =
      gexVal > 0.15 ? "positive" :
      gexVal < -0.15 ? "negative" : "neutral";

    const vol = (cfg.annualVol ?? 0.16) *
      (dayChar === "volatile" ? 1.5 + rng() * 0.5 :
       dayChar === "range-bound" ? 0.7 + rng() * 0.2 : 1.0);

    const openGap = (rng() - 0.5) * 0.005 * prevClose;
    const openPrice = Math.round((prevClose + openGap) * 100) / 100;

    const strikes = cfg.strikes ??
      Array.from({ length: 21 }, (_, i) => Math.round(openPrice / 1) - 10 + i);

    const path = generateIntradayPath({
      openPrice,
      annualVol: vol,
      ticksPerDay: 390,
      seed: cfg.baseSeed + d * 7919,
      gexLevel: gexVal,
      trendBias,
    });

    const stream = generateQuoteStream(path, { strikes });
    prevClose = path[path.length - 1].price;

    dataset.push({
      dayIndex: d,
      pricePath: path,
      quoteStream: stream,
      dayCharacter: dayChar,
      gexRegime,
    });
  }

  return dataset;
}
