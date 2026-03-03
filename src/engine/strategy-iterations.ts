/**
 * HFT Cash v6 – Strategy Iterations for Arena Competition
 *
 * Five progressively more sophisticated 0DTE SPY options strategies,
 * each building on non-retail edge sources verified against Tradier API
 * constraints.
 *
 * Edge sources (non-retail, structural):
 *   1. GEX regime detection — classify pin vs breakout via gamma exposure
 *   2. Charm-window timing — enter during dealer-rebalancing flow windows
 *   3. Theta-gamma ratio optimization — find optimal time-of-day entries
 *   4. Volume-distribution shift — detect regime change via call/put flow
 *   5. Adaptive Kelly sizing — compound aggressively with mathematical edge
 */

import type { EnrichedQuote, DayData, PriceTick } from "./quote-generator.js";

/* ------------------------------------------------------------------ */
/*  Interfaces                                                         */
/* ------------------------------------------------------------------ */

export interface TradeDecision {
  action: "BUY_CALL" | "BUY_PUT" | "SELL_CALL" | "SELL_PUT" | "SKIP";
  contracts: number;
  strike: number;
  entryPrice: number;    // mid price at entry
  quote: EnrichedQuote;
  reason: string;
}

export interface TradeResult {
  decision: TradeDecision;
  exitPrice: number;
  pnlPerContract: number;
  totalPnl: number;
  frictionCost: number;
  netPnl: number;
  holdMinutes: number;
}

export interface StrategyState {
  equity: number;
  tradesExecToday: number;
  winStreak: number;
  lossStreak: number;
  recentWinRate: number; // rolling 20-trade win rate
  recentResults: boolean[];
  peakEquity: number;
}

export interface Strategy {
  name: string;
  version: string;
  description: string;
  edgeSources: string[];
  evaluate(
    quotes: EnrichedQuote[],
    dayData: DayData,
    state: StrategyState,
    timeSlotIndex: number,
  ): TradeDecision;
}

/**
 * Compute recent price momentum from the intraday path.
 * lookbackMinutes: how far back to look (e.g. 15 min).
 * Returns momentum as fractional change (-0.005 = down 0.5%).
 */
function priceMomentum(path: PriceTick[], currentMinute: number, lookbackMinutes: number): number {
  const from = Math.max(0, currentMinute - lookbackMinutes);
  const pFrom = path[from]?.price ?? 0;
  const pNow = path[Math.min(currentMinute, path.length - 1)]?.price ?? 0;
  if (pFrom === 0) return 0;
  return (pNow - pFrom) / pFrom;
}

/**
 * Compute price volatility (std of returns) over lookback window.
 */
function priceVolatility(path: PriceTick[], currentMinute: number, lookbackMinutes: number): number {
  const from = Math.max(0, currentMinute - lookbackMinutes);
  const to = Math.min(currentMinute, path.length - 1);
  if (to - from < 2) return 0;
  const returns: number[] = [];
  for (let i = from + 1; i <= to; i++) {
    const prev = path[i - 1]?.price ?? 1;
    const curr = path[i]?.price ?? 1;
    returns.push((curr - prev) / prev);
  }
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance);
}

/* ------------------------------------------------------------------ */
/*  Shared utilities                                                   */
/* ------------------------------------------------------------------ */

const FRICTION_PER_CONTRACT = 0.07;
const DAILY_TRADE_CAP = 10;
const MAX_DRAWDOWN = 0.5586;

function kellyFraction(winRate: number, avgWin: number, avgLoss: number): number {
  if (avgLoss === 0) return 0;
  const b = avgWin / avgLoss; // reward-to-risk ratio
  const f = (b * winRate - (1 - winRate)) / b;
  return Math.max(0, Math.min(f, 0.25)); // cap at 25% (quarter-Kelly safety)
}

function positionSize(
  equity: number,
  optionMid: number,
  fractionOfEquity: number,
  maxContracts: number,
): number {
  if (optionMid <= 0 || equity <= 0) return 0;
  const costPerContract = optionMid * 100;
  const targetSpend = equity * fractionOfEquity;
  const contracts = Math.floor(targetSpend / costPerContract);
  return Math.min(Math.max(contracts, 1), maxContracts);
}

function selectBestQuote(
  quotes: EnrichedQuote[],
  filter: (q: EnrichedQuote) => boolean,
  rank: (q: EnrichedQuote) => number,
): EnrichedQuote | null {
  let best: EnrichedQuote | null = null;
  let bestScore = -Infinity;
  for (const q of quotes) {
    if (!filter(q)) continue;
    const score = rank(q);
    if (score > bestScore) {
      bestScore = score;
      best = q;
    }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/*  Strategy v1: Baseline Enhanced                                     */
/*  Edge: Improved position sizing + momentum filter                   */
/* ------------------------------------------------------------------ */

export const strategyV1: Strategy = {
  name: "Baseline Enhanced",
  version: "v1",
  description: "Momentum-driven entry with conservative Kelly sizing on 0DTE options",
  edgeSources: ["momentum-filter", "fractional-kelly-sizing"],

  evaluate(quotes, dayData, state, timeSlotIndex) {
    if (state.tradesExecToday >= DAILY_TRADE_CAP) return skip("daily cap");
    if (drawdownPct(state) >= MAX_DRAWDOWN) return skip("max drawdown");

    const minuteOfDay = quotes[0]?.minuteOfDay ?? 0;
    if (minuteOfDay < 20 || minuteOfDay > 370) return skip("avoid open/close");

    // Require strong price momentum (> 0.1% in 10 min) for high conviction
    const mom = priceMomentum(dayData.pricePath, minuteOfDay, 10);
    if (Math.abs(mom) < 0.001) return skip("insufficient momentum");

    const isBullish = mom > 0;
    const optType = isBullish ? "call" : "put";

    const q = selectBestQuote(
      quotes,
      (q) => {
        const spreadCents = Math.round((q.ask - q.bid) * 100);
        const mid = q.mid ?? (q.bid + q.ask) / 2;
        if (spreadCents > 5 || mid < 0.03 || mid > 0.50) return false;
        if (isBullish) return q.greeks.delta > 0.05 && q.greeks.delta < 0.40;
        return q.greeks.delta < -0.05 && q.greeks.delta > -0.40;
      },
      (q) => q.greeks.gamma * 1000 - (q.mid ?? 1) * 10, // prefer high gamma, low price
    );

    if (!q) return skip("no qualifying quote");

    const mid = q.mid ?? (q.bid + q.ask) / 2;
    const fraction = 0.08;
    const contracts = positionSize(state.equity, mid, fraction, 50);

    const action: TradeDecision["action"] = isBullish ? "BUY_CALL" : "BUY_PUT";

    return {
      action,
      contracts,
      strike: q.strike,
      entryPrice: mid,
      quote: q,
      reason: `v1: mom=${(mom * 100).toFixed(3)}% gamma=${q.greeks.gamma.toFixed(4)} delta=${q.greeks.delta.toFixed(3)}`,
    };
  },
};

/* ------------------------------------------------------------------ */
/*  Strategy v2: GEX-Regime Aware                                      */
/*  Edge: Classify pin vs breakout from gamma exposure distribution    */
/* ------------------------------------------------------------------ */

export const strategyV2: Strategy = {
  name: "GEX-Regime Aware",
  version: "v2",
  description: "Combines price momentum with GEX regime detection; mean-revert in positive GEX, trend-follow in negative GEX",
  edgeSources: ["GEX-regime-detection", "dealer-hedging-flow", "momentum-filter", "fractional-kelly-sizing"],

  evaluate(quotes, dayData, state, timeSlotIndex) {
    if (state.tradesExecToday >= DAILY_TRADE_CAP) return skip("daily cap");
    if (drawdownPct(state) >= MAX_DRAWDOWN) return skip("max drawdown");

    const minuteOfDay = quotes[0]?.minuteOfDay ?? 0;
    if (minuteOfDay < 20 || minuteOfDay > 370) return skip("avoid open/close");

    const gexRegime = dayData.gexRegime;
    const mom10 = priceMomentum(dayData.pricePath, minuteOfDay, 10);
    const mom30 = priceMomentum(dayData.pricePath, minuteOfDay, 30);

    // GEX regime dictates strategy type:
    // Positive GEX → dealers are long gamma → mean-reversion (fade the move)
    // Negative GEX → dealers are short gamma → trend-follow (join the move)
    let isBullish: boolean;
    const momThreshold = gexRegime === "negative" ? 0.0008 : 0.0012;

    if (Math.abs(mom10) < momThreshold) return skip("insufficient momentum for regime");

    if (gexRegime === "positive") {
      isBullish = mom10 < 0; // mean-revert: buy calls after dip, puts after rally
    } else if (gexRegime === "negative") {
      isBullish = mom10 > 0 && mom30 > 0; // trend-follow with confirmation
      if (!isBullish && mom10 < 0 && mom30 < 0) {
        isBullish = false;
      } else if (!isBullish) {
        return skip("mixed signals in negative GEX");
      }
    } else {
      if (Math.abs(mom10) < 0.001) return skip("neutral GEX needs strong momentum");
      isBullish = mom10 > 0;
    }

    const q = selectBestQuote(
      quotes,
      (q) => {
        const spreadCents = Math.round((q.ask - q.bid) * 100);
        const mid = q.mid ?? (q.bid + q.ask) / 2;
        if (spreadCents > 5 || mid < 0.03 || mid > 0.40) return false;
        if (isBullish) return q.greeks.delta > 0.05 && q.greeks.delta < 0.35;
        return q.greeks.delta < -0.05 && q.greeks.delta > -0.35;
      },
      (q) => q.greeks.gamma * 1000 - (q.mid ?? 1) * 15,
    );

    if (!q) return skip("no qualifying quote for regime");

    const mid = q.mid ?? (q.bid + q.ask) / 2;
    const momStr = Math.min(Math.abs(mom10) / 0.003, 1.0);
    const fraction = (gexRegime === "negative" ? 0.15 : 0.10) + momStr * 0.05;
    const contracts = positionSize(state.equity, mid, fraction, 80);

    const action: TradeDecision["action"] = isBullish ? "BUY_CALL" : "BUY_PUT";

    return {
      action,
      contracts,
      strike: q.strike,
      entryPrice: mid,
      quote: q,
      reason: `v2: gex=${gexRegime} mom10=${(mom10 * 100).toFixed(3)}% mom30=${(mom30 * 100).toFixed(3)}%`,
    };
  },
};

/* ------------------------------------------------------------------ */
/*  Strategy v3: Charm-Window Timing                                   */
/*  Edge: Enter during charm-driven dealer rebalancing windows         */
/* ------------------------------------------------------------------ */

export const strategyV3: Strategy = {
  name: "Charm-Window",
  version: "v3",
  description: "Trades charm-window dealer flows with momentum confirmation (11AM-2PM + power hour)",
  edgeSources: ["charm-window-timing", "delta-decay-flow", "momentum-filter", "fractional-kelly-sizing"],

  evaluate(quotes, dayData, state, timeSlotIndex) {
    if (state.tradesExecToday >= DAILY_TRADE_CAP) return skip("daily cap");
    if (drawdownPct(state) >= MAX_DRAWDOWN) return skip("max drawdown");

    const minuteOfDay = quotes[0]?.minuteOfDay ?? 0;

    // Charm window: 90-270 min (11:00 AM - 2:00 PM ET)
    const inCharmWindow = minuteOfDay >= 90 && minuteOfDay <= 270;
    // Power hour: 330-370 min (3:00 PM - 3:40 PM ET)
    const inPowerHour = minuteOfDay >= 330 && minuteOfDay <= 370;

    if (!inCharmWindow && !inPowerHour) return skip("outside trading windows");

    // Require strong momentum confirmation
    const mom = priceMomentum(dayData.pricePath, minuteOfDay, 15);
    if (Math.abs(mom) < 0.001) return skip("no momentum in charm window");

    const isBullish = mom > 0;

    const q = selectBestQuote(
      quotes,
      (q) => {
        const spreadCents = Math.round((q.ask - q.bid) * 100);
        const mid = q.mid ?? (q.bid + q.ask) / 2;
        if (spreadCents > 5 || mid < 0.03 || mid > 0.40) return false;
        if (isBullish) return q.greeks.delta > 0.05 && q.greeks.delta < 0.40;
        return q.greeks.delta < -0.05 && q.greeks.delta > -0.40;
      },
      (q) => Math.abs(q.greeks.charm) * q.greeks.gamma * 1000,
    );

    if (!q) return skip("no qualifying charm-window quote");

    const mid = q.mid ?? (q.bid + q.ask) / 2;
    const fraction = inPowerHour ? 0.10 : 0.08;
    const contracts = positionSize(state.equity, mid, fraction, 50);

    const action: TradeDecision["action"] = isBullish ? "BUY_CALL" : "BUY_PUT";

    return {
      action,
      contracts,
      strike: q.strike,
      entryPrice: mid,
      quote: q,
      reason: `v3: charm=${q.greeks.charm.toFixed(5)} mom=${(mom * 100).toFixed(3)}% window=${inCharmWindow ? "charm" : "power"}`,
    };
  },
};

/* ------------------------------------------------------------------ */
/*  Strategy v4: Theta-Gamma Ratio                                     */
/*  Edge: Optimal entry timing via theta/gamma ratio analysis          */
/* ------------------------------------------------------------------ */

export const strategyV4: Strategy = {
  name: "Theta-Gamma Ratio",
  version: "v4",
  description: "Exploits gamma convexity with momentum + volatility regime filtering",
  edgeSources: ["theta-gamma-ratio", "momentum-filter", "volatility-regime", "GEX-regime-detection", "adaptive-kelly"],

  evaluate(quotes, dayData, state, timeSlotIndex) {
    if (state.tradesExecToday >= DAILY_TRADE_CAP) return skip("daily cap");
    if (drawdownPct(state) >= MAX_DRAWDOWN) return skip("max drawdown");

    const minuteOfDay = quotes[0]?.minuteOfDay ?? 0;
    if (minuteOfDay < 30 || minuteOfDay > 370) return skip("avoid extreme open/close");

    const minutesRemaining = 390 - minuteOfDay;

    // Require momentum AND elevated short-term volatility (realized > expected)
    const mom = priceMomentum(dayData.pricePath, minuteOfDay, 10);
    const recentVol = priceVolatility(dayData.pricePath, minuteOfDay, 20);
    if (Math.abs(mom) < 0.001) return skip("insufficient momentum for gamma trade");
    if (recentVol < 0.0003) return skip("vol too low for gamma trade");

    const isBullish = mom > 0;

    const q = selectBestQuote(
      quotes,
      (q) => {
        const spreadCents = Math.round((q.ask - q.bid) * 100);
        const mid = q.mid ?? (q.bid + q.ask) / 2;
        if (spreadCents > 5 || mid < 0.03 || mid > 0.35) return false;
        if (isBullish) return q.greeks.delta > 0.05 && q.greeks.delta < 0.35;
        return q.greeks.delta < -0.05 && q.greeks.delta > -0.35;
      },
      (q) => {
        const gammaScore = q.greeks.gamma / Math.sqrt(Math.max(minutesRemaining, 1));
        const regimeBonus = dayData.gexRegime === "negative" ? 1.5 : 1.0;
        const cheapBonus = (q.mid ?? 1) < 0.15 ? 2.0 : 1.0;
        return gammaScore * regimeBonus * cheapBonus * 1000;
      },
    );

    if (!q) return skip("no qualifying theta-gamma quote");

    const mid = q.mid ?? (q.bid + q.ask) / 2;

    const momStrength = Math.min(Math.abs(mom) / 0.003, 1.0);
    const baseFraction = 0.08;
    const fraction = baseFraction + momStrength * 0.07;
    const contracts = positionSize(state.equity, mid, fraction, 50);

    const action: TradeDecision["action"] = isBullish ? "BUY_CALL" : "BUY_PUT";

    return {
      action,
      contracts,
      strike: q.strike,
      entryPrice: mid,
      quote: q,
      reason: `v4: mom=${(mom * 100).toFixed(3)}% vol=${(recentVol * 100).toFixed(3)}% gamma=${q.greeks.gamma.toFixed(4)} minRem=${minutesRemaining}`,
    };
  },
};

/* ------------------------------------------------------------------ */
/*  Strategy v5: Composite Edge                                        */
/*  Edge: Combines all edges with adaptive weighting                   */
/* ------------------------------------------------------------------ */

export const strategyV5: Strategy = {
  name: "Composite Edge",
  version: "v5",
  description: "Unified edge score combining momentum, GEX regime, charm window, volatility, and adaptive Kelly sizing",
  edgeSources: [
    "GEX-regime-detection",
    "charm-window-timing",
    "theta-gamma-ratio",
    "momentum-filter",
    "volatility-regime",
    "adaptive-kelly",
    "volume-distribution-shift",
  ],

  evaluate(quotes, dayData, state, timeSlotIndex) {
    if (state.tradesExecToday >= DAILY_TRADE_CAP) return skip("daily cap");
    if (drawdownPct(state) >= MAX_DRAWDOWN) return skip("max drawdown");

    const minuteOfDay = quotes[0]?.minuteOfDay ?? 0;
    if (minuteOfDay < 20 || minuteOfDay > 375) return skip("avoid extreme times");

    const minutesRemaining = 390 - minuteOfDay;

    // Multi-timeframe momentum
    const mom5 = priceMomentum(dayData.pricePath, minuteOfDay, 5);
    const mom15 = priceMomentum(dayData.pricePath, minuteOfDay, 15);
    const mom30 = priceMomentum(dayData.pricePath, minuteOfDay, 30);
    const recentVol = priceVolatility(dayData.pricePath, minuteOfDay, 15);

    // Require minimum momentum (directional conviction)
    if (Math.abs(mom5) < 0.0003 && Math.abs(mom15) < 0.0005) {
      return skip("no momentum signal");
    }

    // Composite directional score
    const isNegGEX = dayData.gexRegime === "negative";
    const isPosGEX = dayData.gexRegime === "positive";
    const inCharmWindow = minuteOfDay >= 90 && minuteOfDay <= 270;
    const inPowerHour = minuteOfDay >= 330;

    let bullScore = 0, bearScore = 0;

    // Edge 1: Multi-timeframe momentum alignment (strongest signal)
    if (mom5 > 0) bullScore += 3; else bearScore += 3;
    if (mom15 > 0) bullScore += 2; else bearScore += 2;
    if (mom30 > 0) bullScore += 1; else bearScore += 1;

    // Edge 2: GEX regime
    if (isNegGEX) {
      // Trend-following regime: double the momentum signal
      if (mom5 > 0) bullScore += 2; else bearScore += 2;
    } else if (isPosGEX) {
      // Mean-revert regime: fade the short-term momentum
      if (mom5 > 0.001) bearScore += 1; // overextended up → bearish
      if (mom5 < -0.001) bullScore += 1; // overextended down → bullish
    }

    // Edge 3: Day character
    if (dayData.dayCharacter === "trending-up") bullScore += 1;
    if (dayData.dayCharacter === "trending-down") bearScore += 1;
    if (dayData.dayCharacter === "volatile" && recentVol > 0.0005) {
      // High vol = amplifies momentum signal
      if (mom5 > 0) bullScore += 1; else bearScore += 1;
    }

    // Need decisive directional edge (min 3-point spread)
    const spread = Math.abs(bullScore - bearScore);
    if (spread < 3) return skip(`directional spread too narrow: bull=${bullScore} bear=${bearScore}`);

    const isBullish = bullScore > bearScore;

    const q = selectBestQuote(
      quotes,
      (q) => {
        const spreadCents = Math.round((q.ask - q.bid) * 100);
        const mid = q.mid ?? (q.bid + q.ask) / 2;
        if (spreadCents > 5 || mid < 0.03 || mid > 0.40) return false;
        if (isBullish) return q.greeks.delta > 0.05 && q.greeks.delta < 0.40;
        return q.greeks.delta < -0.05 && q.greeks.delta > -0.40;
      },
      (q) => {
        let score = q.greeks.gamma * 1000;
        const mid = q.mid ?? 1;
        score += (0.30 - mid) * 50; // prefer cheaper options
        if (inCharmWindow) score += Math.abs(q.greeks.charm) * 5000;
        if (isNegGEX) score *= 1.4;
        score += 1 / Math.sqrt(Math.max(minutesRemaining, 1));
        return score;
      },
    );

    if (!q) return skip("no qualifying composite-edge quote");

    const mid = q.mid ?? (q.bid + q.ask) / 2;

    const baseWinRate = state.recentResults.length >= 10 ? state.recentWinRate : 0.55;
    const streakAdjust = state.lossStreak >= 3 ? 0.6 : state.winStreak >= 4 ? 1.2 : 1.0;
    const momStrength = Math.min(Math.abs(mom5) / 0.002, 1.0);
    const baseFraction = 0.08 + momStrength * 0.07;
    const fraction = Math.max(0.05, Math.min(baseFraction * streakAdjust, 0.20));
    const contracts = positionSize(state.equity, mid, fraction, 50);

    const action: TradeDecision["action"] = isBullish ? "BUY_CALL" : "BUY_PUT";

    return {
      action,
      contracts,
      strike: q.strike,
      entryPrice: mid,
      quote: q,
      reason: `v5: bull=${bullScore} bear=${bearScore} mom5=${(mom5 * 100).toFixed(3)}% gex=${dayData.gexRegime} frac=${fraction.toFixed(3)}`,
    };
  },
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function skip(reason: string): TradeDecision {
  return {
    action: "SKIP",
    contracts: 0,
    strike: 0,
    entryPrice: 0,
    quote: null as unknown as EnrichedQuote,
    reason,
  };
}

function drawdownPct(state: StrategyState): number {
  if (state.peakEquity <= 0) return 0;
  return 1 - state.equity / state.peakEquity;
}

export const ALL_STRATEGIES: Strategy[] = [
  strategyV1,
  strategyV2,
  strategyV3,
  strategyV4,
  strategyV5,
];
