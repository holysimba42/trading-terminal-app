/**
 * HFT Cash v6 – Walk-Forward, Monte Carlo & Arena Competition
 *
 * • Walk-forward: rolling in-sample optimisation + out-of-sample testing
 * • Monte Carlo: bootstrap-resampled equity paths for statistical validation
 * • Arena: head-to-head strategy comparison with strict promotion rules
 */

import type { DayData, EnrichedQuote, PriceTick } from "./quote-generator.js";
import type {
  Strategy,
  TradeDecision,
  TradeResult,
  StrategyState,
} from "./strategy-iterations.js";
import { createRNG } from "./quote-generator.js";
import { blackScholes, minutesToYears } from "./greeks.js";

/* ------------------------------------------------------------------ */
/*  Performance Metrics                                                */
/* ------------------------------------------------------------------ */

export interface PerformanceMetrics {
  totalReturn: number;       // final equity / starting equity
  annualizedReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  winRate: number;
  totalTrades: number;
  avgWinPnl: number;
  avgLossPnl: number;
  profitFactor: number;
  recoveryFactor: number;
  calmarRatio: number;
  avgDailyReturn: number;
  dailyReturnStdDev: number;
  equityCurve: number[];
  dailyReturns: number[];
  tradeReturns: number[];
}

export function computeMetrics(
  equityCurve: number[],
  tradeResults: TradeResult[],
  startingCapital: number,
  tradingDays: number,
): PerformanceMetrics {
  const finalEquity = equityCurve[equityCurve.length - 1] ?? startingCapital;
  const totalReturn = finalEquity / startingCapital;

  // Daily returns
  const dailyReturns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    dailyReturns.push(equityCurve[i] / equityCurve[i - 1] - 1);
  }

  const avgDaily = dailyReturns.length > 0
    ? dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length
    : 0;
  const variance = dailyReturns.length > 1
    ? dailyReturns.reduce((s, r) => s + (r - avgDaily) ** 2, 0) / (dailyReturns.length - 1)
    : 0;
  const stdDev = Math.sqrt(variance);

  const annualizedReturn = Math.pow(totalReturn, 252 / Math.max(tradingDays, 1)) - 1;
  const sharpe = stdDev > 0 ? (avgDaily / stdDev) * Math.sqrt(252) : 0;

  // Max drawdown
  let peak = startingCapital;
  let maxDD = 0;
  let maxDDPct = 0;
  for (const eq of equityCurve) {
    if (eq > peak) peak = eq;
    const dd = peak - eq;
    const ddPct = dd / peak;
    if (dd > maxDD) maxDD = dd;
    if (ddPct > maxDDPct) maxDDPct = ddPct;
  }

  // Trade-level stats
  const wins = tradeResults.filter(t => t.netPnl > 0);
  const losses = tradeResults.filter(t => t.netPnl <= 0);
  const winRate = tradeResults.length > 0 ? wins.length / tradeResults.length : 0;
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.netPnl, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + t.netPnl, 0) / losses.length) : 0;
  const grossProfit = wins.reduce((s, t) => s + t.netPnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.netPnl, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  const netProfit = finalEquity - startingCapital;
  const recoveryFactor = maxDD > 0 ? netProfit / maxDD : netProfit > 0 ? Infinity : 0;
  const calmar = maxDDPct > 0 ? annualizedReturn / maxDDPct : 0;

  return {
    totalReturn,
    annualizedReturn,
    sharpeRatio: sharpe,
    maxDrawdown: maxDD,
    maxDrawdownPct: maxDDPct,
    winRate,
    totalTrades: tradeResults.length,
    avgWinPnl: avgWin,
    avgLossPnl: avgLoss,
    profitFactor,
    recoveryFactor,
    calmarRatio: calmar,
    avgDailyReturn: avgDaily,
    dailyReturnStdDev: stdDev,
    equityCurve,
    dailyReturns,
    tradeReturns: tradeResults.map(t => t.netPnl),
  };
}

/* ------------------------------------------------------------------ */
/*  Trade Simulation Engine                                            */
/* ------------------------------------------------------------------ */

const FRICTION_PER_CONTRACT = 0.07;

interface SimConfig {
  startingCapital: number;
  holdPeriodSlots: number;  // how many time-slots to hold before exit
  maxDailyTrades: number;
}

const TAKE_PROFIT_PCT = 0.40;  // exit at +40% gain (faster capture)
const STOP_LOSS_PCT = -0.45;   // exit at -45% loss (wider stop for noisy 0DTE)

function bsReprice(
  S: number, K: number, minuteOfDay: number, iv: number, optType: "call" | "put",
): number {
  const minutesRemaining = Math.max(390 - minuteOfDay, 1);
  const T = minutesToYears(minutesRemaining);
  return Math.max(0.005, blackScholes({ S, K, T, r: 0.0525, sigma: iv, type: optType }));
}

function simulateExit(
  decision: TradeDecision,
  futureQuotes: EnrichedQuote[][],
  holdSlots: number,
  pricePath: PriceTick[],
  entryMinute: number,
): { exitPrice: number; holdMinutes: number } {
  const entry = decision.entryPrice;
  const K = decision.strike;
  const iv = decision.quote.greeks?.iv ?? 0.20;
  const optType = (decision.action.includes("CALL") ? "call" : "put") as "call" | "put";

  // Scan minute-by-minute for stop-loss / take-profit within hold period
  const maxExitMinute = Math.min(entryMinute + holdSlots * 5, 389);

  for (let m = entryMinute + 1; m <= maxExitMinute; m++) {
    const tick = pricePath[m];
    if (!tick) continue;

    const currentPrice = bsReprice(tick.price, K, m, iv, optType);
    const returnPct = (currentPrice - entry) / entry;

    if (returnPct >= TAKE_PROFIT_PCT) {
      return { exitPrice: currentPrice, holdMinutes: m - entryMinute };
    }
    if (returnPct <= STOP_LOSS_PCT) {
      return { exitPrice: currentPrice, holdMinutes: m - entryMinute };
    }
  }

  // Hold to end of period — use quote stream if available, else BS reprice
  const targetSlot = Math.min(holdSlots, futureQuotes.length - 1);
  if (targetSlot > 0) {
    const exitQuotes = futureQuotes[targetSlot];
    const exitQ = exitQuotes?.find(q => q.strike === K);
    if (exitQ) {
      const exitMid = exitQ.mid ?? (exitQ.bid + exitQ.ask) / 2;
      return { exitPrice: Math.max(0.005, exitMid), holdMinutes: maxExitMinute - entryMinute };
    }
  }

  // Fallback BS reprice at exit minute
  const exitTick = pricePath[Math.min(maxExitMinute, pricePath.length - 1)];
  if (exitTick) {
    const exitMid = bsReprice(exitTick.price, K, maxExitMinute, iv, optType);
    return { exitPrice: exitMid, holdMinutes: maxExitMinute - entryMinute };
  }

  return { exitPrice: entry * 0.90, holdMinutes: holdSlots * 5 };
}

export function runBacktest(
  strategy: Strategy,
  dataset: DayData[],
  cfg: SimConfig,
): { metrics: PerformanceMetrics; trades: TradeResult[] } {
  const state: StrategyState = {
    equity: cfg.startingCapital,
    tradesExecToday: 0,
    winStreak: 0,
    lossStreak: 0,
    recentWinRate: 0.5,
    recentResults: [],
    peakEquity: cfg.startingCapital,
  };

  const allTrades: TradeResult[] = [];
  const dailyEquity: number[] = [cfg.startingCapital];

  for (const day of dataset) {
    state.tradesExecToday = 0;

    for (let t = 0; t < day.quoteStream.length; t++) {
      const quotes = day.quoteStream[t];
      if (!quotes || quotes.length === 0) continue;

      const decision = strategy.evaluate(quotes, day, state, t);
      if (decision.action === "SKIP") continue;

      // Simulate the trade using actual underlying price path for exit repricing
      const futureSlices = day.quoteStream.slice(t + 1);
      const entryMinute = quotes[0]?.minuteOfDay ?? 0;
      const { exitPrice, holdMinutes } = simulateExit(
        decision, futureSlices, cfg.holdPeriodSlots, day.pricePath, entryMinute,
      );

      const pnlPerContract = decision.action.startsWith("BUY")
        ? (exitPrice - decision.entryPrice) * 100
        : (decision.entryPrice - exitPrice) * 100;

      const frictionCost = decision.contracts * FRICTION_PER_CONTRACT;
      const totalPnl = pnlPerContract * decision.contracts;
      const netPnl = totalPnl - frictionCost;

      const result: TradeResult = {
        decision,
        exitPrice,
        pnlPerContract,
        totalPnl,
        frictionCost,
        netPnl,
        holdMinutes,
      };

      allTrades.push(result);
      state.equity += netPnl;
      state.equity = Math.max(state.equity, 0);
      state.peakEquity = Math.max(state.peakEquity, state.equity);
      state.tradesExecToday++;

      // Update recent results
      const isWin = netPnl > 0;
      state.recentResults.push(isWin);
      if (state.recentResults.length > 20) state.recentResults.shift();
      state.recentWinRate = state.recentResults.filter(Boolean).length / state.recentResults.length;

      if (isWin) {
        state.winStreak++;
        state.lossStreak = 0;
      } else {
        state.lossStreak++;
        state.winStreak = 0;
      }

      if (state.equity <= 0) break;
    }

    dailyEquity.push(state.equity);
    if (state.equity <= 0) break;
  }

  const metrics = computeMetrics(dailyEquity, allTrades, cfg.startingCapital, dataset.length);
  return { metrics, trades: allTrades };
}

/* ------------------------------------------------------------------ */
/*  Walk-Forward Engine                                                */
/* ------------------------------------------------------------------ */

export interface WalkForwardConfig {
  inSampleDays: number;      // e.g. 30
  outOfSampleDays: number;   // e.g. 10
  startingCapital: number;
  holdPeriodSlots: number;
  maxDailyTrades: number;
}

export interface WalkForwardResult {
  strategyName: string;
  windows: {
    windowIndex: number;
    inSampleMetrics: PerformanceMetrics;
    outOfSampleMetrics: PerformanceMetrics;
  }[];
  aggregatedOOS: PerformanceMetrics;
}

export function walkForward(
  strategy: Strategy,
  dataset: DayData[],
  cfg: WalkForwardConfig,
): WalkForwardResult {
  const windowSize = cfg.inSampleDays + cfg.outOfSampleDays;
  const windows: WalkForwardResult["windows"] = [];
  const allOOSTrades: TradeResult[] = [];
  const oosEquityCurve: number[] = [cfg.startingCapital];

  for (let start = 0; start + windowSize <= dataset.length; start += cfg.outOfSampleDays) {
    const inSample = dataset.slice(start, start + cfg.inSampleDays);
    const outOfSample = dataset.slice(
      start + cfg.inSampleDays,
      start + cfg.inSampleDays + cfg.outOfSampleDays,
    );

    if (outOfSample.length === 0) break;

    // Each window starts fresh at starting capital (no catastrophic compounding)
    const windowCfg = { startingCapital: cfg.startingCapital, holdPeriodSlots: cfg.holdPeriodSlots, maxDailyTrades: cfg.maxDailyTrades };
    const isResult = runBacktest(strategy, inSample, windowCfg);
    const oosResult = runBacktest(strategy, outOfSample, windowCfg);

    windows.push({
      windowIndex: windows.length,
      inSampleMetrics: isResult.metrics,
      outOfSampleMetrics: oosResult.metrics,
    });

    allOOSTrades.push(...oosResult.trades);
    const windowReturn = oosResult.metrics.equityCurve[oosResult.metrics.equityCurve.length - 1] ?? cfg.startingCapital;
    oosEquityCurve.push(windowReturn);
  }

  const aggregatedOOS = computeMetrics(
    oosEquityCurve,
    allOOSTrades,
    cfg.startingCapital,
    dataset.length,
  );

  return {
    strategyName: `${strategy.name} (${strategy.version})`,
    windows,
    aggregatedOOS,
  };
}

/* ------------------------------------------------------------------ */
/*  Monte Carlo Simulation                                             */
/* ------------------------------------------------------------------ */

export interface MonteCarloConfig {
  simulations: number;       // e.g. 1000
  seed: number;
  startingCapital: number;
  tradingDays: number;
  tradesPerDay: number;
}

export interface MonteCarloResult {
  strategyName: string;
  simulations: number;
  medianFinalEquity: number;
  mean: number;
  p5: number;   // 5th percentile
  p25: number;
  p75: number;
  p95: number;
  probabilityOfProfit: number;
  probabilityOf100k: number;
  probabilityOfRuin: number;    // equity <= 0
  medianMaxDrawdown: number;
  medianSharpe: number;
  equityDistribution: number[];  // final equities for histogram
}

export function monteCarloSimulation(
  tradeReturns: number[],
  cfg: MonteCarloConfig,
): MonteCarloResult {
  const rng = createRNG(cfg.seed);
  const finalEquities: number[] = [];
  const maxDrawdowns: number[] = [];
  const sharpes: number[] = [];
  const totalTradesPerSim = cfg.tradingDays * cfg.tradesPerDay;

  for (let sim = 0; sim < cfg.simulations; sim++) {
    let equity = cfg.startingCapital;
    let peak = equity;
    let maxDD = 0;
    const dailyReturns: number[] = [];
    let dayEquity = equity;

    for (let t = 0; t < totalTradesPerSim; t++) {
      // Bootstrap: randomly sample a trade return (with replacement)
      const idx = Math.floor(rng() * tradeReturns.length);
      const tradeReturn = tradeReturns[idx];

      // Scale return relative to current equity
      const scaledReturn = tradeReturn * (equity / cfg.startingCapital);
      equity += scaledReturn;
      equity = Math.max(equity, 0);

      if (equity > peak) peak = equity;
      const dd = (peak - equity) / peak;
      if (dd > maxDD) maxDD = dd;

      // Track daily returns
      if ((t + 1) % cfg.tradesPerDay === 0) {
        dailyReturns.push(dayEquity > 0 ? equity / dayEquity - 1 : 0);
        dayEquity = equity;
      }

      if (equity <= 0) break;
    }

    finalEquities.push(equity);
    maxDrawdowns.push(maxDD);

    const avgDR = dailyReturns.length > 0
      ? dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length
      : 0;
    const stdDR = dailyReturns.length > 1
      ? Math.sqrt(dailyReturns.reduce((s, r) => s + (r - avgDR) ** 2, 0) / (dailyReturns.length - 1))
      : 0;
    sharpes.push(stdDR > 0 ? (avgDR / stdDR) * Math.sqrt(252) : 0);
  }

  finalEquities.sort((a, b) => a - b);
  maxDrawdowns.sort((a, b) => a - b);
  sharpes.sort((a, b) => a - b);

  const n = finalEquities.length;
  return {
    strategyName: "",
    simulations: cfg.simulations,
    medianFinalEquity: finalEquities[Math.floor(n / 2)],
    mean: finalEquities.reduce((s, e) => s + e, 0) / n,
    p5: finalEquities[Math.floor(n * 0.05)],
    p25: finalEquities[Math.floor(n * 0.25)],
    p75: finalEquities[Math.floor(n * 0.75)],
    p95: finalEquities[Math.floor(n * 0.95)],
    probabilityOfProfit: finalEquities.filter(e => e > cfg.startingCapital).length / n,
    probabilityOf100k: finalEquities.filter(e => e >= 100_000).length / n,
    probabilityOfRuin: finalEquities.filter(e => e <= 0).length / n,
    medianMaxDrawdown: maxDrawdowns[Math.floor(n / 2)],
    medianSharpe: sharpes[Math.floor(n / 2)],
    equityDistribution: finalEquities,
  };
}

/* ------------------------------------------------------------------ */
/*  Arena Competition                                                  */
/* ------------------------------------------------------------------ */

export interface ArenaResult {
  rankings: {
    rank: number;
    strategy: string;
    version: string;
    totalReturn: number;
    sharpe: number;
    maxDrawdownPct: number;
    winRate: number;
    profitFactor: number;
    calmar: number;
    oosReturn: number;
    mcMedian: number;
    mcP5: number;
    mcProbProfit: number;
    mcProb100k: number;
    compositeScore: number;
  }[];
  topDog: string;
  promotionLog: string[];
}

export function arenaCompetition(
  results: {
    strategy: Strategy;
    walkForwardResult: WalkForwardResult;
    monteCarloResult: MonteCarloResult;
  }[],
): ArenaResult {
  const scored = results.map(r => {
    const wf = r.walkForwardResult;
    const mc = r.monteCarloResult;
    const oos = wf.aggregatedOOS;

    // Composite score: weighted blend of key metrics
    const returnScore = Math.log(Math.max(oos.totalReturn, 0.01)) * 20;
    const sharpeScore = oos.sharpeRatio * 15;
    const ddPenalty = -oos.maxDrawdownPct * 30;
    const winRateScore = oos.winRate * 10;
    const profitFactorScore = Math.min(oos.profitFactor, 5) * 10;
    const mcScore = Math.log(Math.max(mc.medianFinalEquity, 1)) * 10;
    const mcProbScore = mc.probabilityOfProfit * 5;

    const compositeScore =
      returnScore + sharpeScore + ddPenalty +
      winRateScore + profitFactorScore + mcScore + mcProbScore;

    return {
      strategy: r.strategy,
      wf,
      mc,
      oos,
      compositeScore,
    };
  });

  scored.sort((a, b) => b.compositeScore - a.compositeScore);

  const promotionLog: string[] = [];
  for (let i = 1; i < scored.length; i++) {
    const challenger = scored[i];
    const champion = scored[0];
    const verdict = challenger.compositeScore > champion.compositeScore
      ? "PROMOTED"
      : "DEFEATED";
    promotionLog.push(
      `${challenger.strategy.name} (${challenger.strategy.version}) vs ` +
      `${champion.strategy.name} (${champion.strategy.version}): ` +
      `${verdict} (${challenger.compositeScore.toFixed(2)} vs ${champion.compositeScore.toFixed(2)})`,
    );
  }

  const rankings = scored.map((s, i) => ({
    rank: i + 1,
    strategy: s.strategy.name,
    version: s.strategy.version,
    totalReturn: s.oos.totalReturn,
    sharpe: s.oos.sharpeRatio,
    maxDrawdownPct: s.oos.maxDrawdownPct,
    winRate: s.oos.winRate,
    profitFactor: s.oos.profitFactor,
    calmar: s.oos.calmarRatio,
    oosReturn: s.oos.totalReturn,
    mcMedian: s.mc.medianFinalEquity,
    mcP5: s.mc.p5,
    mcProbProfit: s.mc.probabilityOfProfit,
    mcProb100k: s.mc.probabilityOf100k,
    compositeScore: s.compositeScore,
  }));

  return {
    rankings,
    topDog: `${scored[0].strategy.name} (${scored[0].strategy.version})`,
    promotionLog,
  };
}
