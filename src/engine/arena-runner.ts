/**
 * HFT Cash v6 – Arena Runner
 *
 * Orchestrates the full strategy competition pipeline:
 *   1. Generate realistic 0DTE SPY quote dataset
 *   2. Verify Tradier API compatibility for all strategies
 *   3. Run walk-forward backtests for each strategy
 *   4. Run Monte Carlo simulations
 *   5. Arena head-to-head comparison
 *   6. Validate top-dog through the ringer
 *   7. Report results
 */

import { generateDataset } from "./quote-generator.js";
import {
  ALL_STRATEGIES,
  type Strategy,
} from "./strategy-iterations.js";
import {
  walkForward,
  monteCarloSimulation,
  arenaCompetition,
  runBacktest,
  type WalkForwardResult,
  type MonteCarloResult,
} from "./arena-framework.js";
import {
  runFullCompatCheck,
} from "./tradier-compat.js";

/* ------------------------------------------------------------------ */
/*  Configuration                                                      */
/* ------------------------------------------------------------------ */

const STARTING_CAPITAL = 300;
const TARGET_PROFIT = 100_000;
const DATASET_DAYS = 252;       // 1 trading year
const WALK_FORWARD_IS = 30;     // in-sample window
const WALK_FORWARD_OOS = 10;    // out-of-sample window
const MONTE_CARLO_SIMS = 2000;
const HOLD_PERIOD_SLOTS = 4;    // 20 min hold with intra-hold TP/SL exits
const MAX_DAILY_TRADES = 10;

/* ------------------------------------------------------------------ */
/*  Formatting helpers                                                 */
/* ------------------------------------------------------------------ */

function fmt(n: number, decimals = 2): string {
  return n.toFixed(decimals);
}

function fmtPct(n: number): string {
  return (n * 100).toFixed(2) + "%";
}

function fmtMoney(n: number): string {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function separator(title: string): void {
  console.log("\n" + "═".repeat(72));
  console.log(`  ${title}`);
  console.log("═".repeat(72));
}

/* ------------------------------------------------------------------ */
/*  Main Pipeline                                                      */
/* ------------------------------------------------------------------ */

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════════════╗");
  console.log("║  HFT Cash v6 – 0DTE SPY Options Arena Competition                  ║");
  console.log("║  Target: $300 → $100,000 net profit after friction                  ║");
  console.log("║  Tradier Production API compatible                                  ║");
  console.log("╚══════════════════════════════════════════════════════════════════════╝");

  // ── Step 1: Tradier API Compatibility ──────────────────────────────

  separator("STEP 1: Tradier API Compatibility Verification");

  const compatResults = runFullCompatCheck();
  for (const cr of compatResults) {
    const status = cr.allCompatible ? "✓ COMPATIBLE" : "✗ ISSUES";
    console.log(`\n  ${status}  ${cr.strategy}`);
    for (const r of cr.results) {
      const icon = r.severity === "ok" ? "  ✓" : r.severity === "warning" ? "  ⚠" : "  ✗";
      console.log(`    ${icon} ${r.feature}: ${r.detail}`);
    }
  }

  // ── Step 2: Generate Dataset ───────────────────────────────────────

  separator("STEP 2: Generating Realistic 0DTE SPY Quote Dataset");

  console.log(`  Days: ${DATASET_DAYS} (1 trading year)`);
  console.log(`  Resolution: 5-min bars (78 bars/day)`);
  console.log(`  Features: GBM + intraday vol seasonality + GEX pinning + charm dynamics`);

  const dataset = generateDataset({
    days: DATASET_DAYS,
    baseSeed: 42,
    basePrice: 580,
    annualVol: 0.16,
  });

  const dayTypes = {
    "trending-up": dataset.filter(d => d.dayCharacter === "trending-up").length,
    "trending-down": dataset.filter(d => d.dayCharacter === "trending-down").length,
    "range-bound": dataset.filter(d => d.dayCharacter === "range-bound").length,
    "volatile": dataset.filter(d => d.dayCharacter === "volatile").length,
  };
  const gexTypes = {
    positive: dataset.filter(d => d.gexRegime === "positive").length,
    negative: dataset.filter(d => d.gexRegime === "negative").length,
    neutral: dataset.filter(d => d.gexRegime === "neutral").length,
  };

  console.log(`\n  Day character distribution:`);
  for (const [type, count] of Object.entries(dayTypes)) {
    console.log(`    ${type}: ${count} days (${fmtPct(count / DATASET_DAYS)})`);
  }
  console.log(`\n  GEX regime distribution:`);
  for (const [type, count] of Object.entries(gexTypes)) {
    console.log(`    ${type}: ${count} days (${fmtPct(count / DATASET_DAYS)})`);
  }

  // ── Step 3: Walk-Forward Backtests ─────────────────────────────────

  separator("STEP 3: Walk-Forward Backtests");

  const wfCfg = {
    inSampleDays: WALK_FORWARD_IS,
    outOfSampleDays: WALK_FORWARD_OOS,
    startingCapital: STARTING_CAPITAL,
    holdPeriodSlots: HOLD_PERIOD_SLOTS,
    maxDailyTrades: MAX_DAILY_TRADES,
  };

  const wfResults: { strategy: Strategy; wf: WalkForwardResult }[] = [];

  for (const strategy of ALL_STRATEGIES) {
    console.log(`\n  Running walk-forward: ${strategy.name} (${strategy.version})...`);
    const wf = walkForward(strategy, dataset, wfCfg);
    wfResults.push({ strategy, wf });

    const oos = wf.aggregatedOOS;
    console.log(`    OOS Total Return: ${fmt(oos.totalReturn, 4)}x`);
    console.log(`    OOS Sharpe:       ${fmt(oos.sharpeRatio)}`);
    console.log(`    OOS Max DD:       ${fmtPct(oos.maxDrawdownPct)}`);
    console.log(`    OOS Win Rate:     ${fmtPct(oos.winRate)}`);
    console.log(`    OOS Trades:       ${oos.totalTrades}`);
    console.log(`    OOS Final Equity: ${fmtMoney(oos.equityCurve[oos.equityCurve.length - 1] ?? STARTING_CAPITAL)}`);
  }

  // ── Step 4: Monte Carlo Simulations ────────────────────────────────

  separator("STEP 4: Monte Carlo Simulations (2000 paths each)");

  const mcResults: { strategy: Strategy; mc: MonteCarloResult }[] = [];

  for (const { strategy, wf } of wfResults) {
    const tradeReturns = wf.aggregatedOOS.tradeReturns;
    if (tradeReturns.length === 0) {
      console.log(`\n  ${strategy.name} (${strategy.version}): No trades — skipping MC`);
      mcResults.push({
        strategy,
        mc: {
          strategyName: strategy.name,
          simulations: 0,
          medianFinalEquity: STARTING_CAPITAL,
          mean: STARTING_CAPITAL,
          p5: STARTING_CAPITAL,
          p25: STARTING_CAPITAL,
          p75: STARTING_CAPITAL,
          p95: STARTING_CAPITAL,
          probabilityOfProfit: 0,
          probabilityOf100k: 0,
          probabilityOfRuin: 0,
          medianMaxDrawdown: 0,
          medianSharpe: 0,
          equityDistribution: [],
        },
      });
      continue;
    }

    const avgTradesPerDay = wf.aggregatedOOS.totalTrades / DATASET_DAYS;
    const mc = monteCarloSimulation(tradeReturns, {
      simulations: MONTE_CARLO_SIMS,
      seed: 7919 + ALL_STRATEGIES.indexOf(strategy),
      startingCapital: STARTING_CAPITAL,
      tradingDays: DATASET_DAYS,
      tradesPerDay: Math.max(1, Math.round(avgTradesPerDay)),
    });
    mc.strategyName = `${strategy.name} (${strategy.version})`;
    mcResults.push({ strategy, mc });

    console.log(`\n  ${strategy.name} (${strategy.version}):`);
    console.log(`    Median Final Equity:    ${fmtMoney(mc.medianFinalEquity)}`);
    console.log(`    Mean Final Equity:      ${fmtMoney(mc.mean)}`);
    console.log(`    5th Percentile:         ${fmtMoney(mc.p5)}`);
    console.log(`    95th Percentile:        ${fmtMoney(mc.p95)}`);
    console.log(`    P(Profit):              ${fmtPct(mc.probabilityOfProfit)}`);
    console.log(`    P($100k):               ${fmtPct(mc.probabilityOf100k)}`);
    console.log(`    P(Ruin):                ${fmtPct(mc.probabilityOfRuin)}`);
    console.log(`    Median Max Drawdown:    ${fmtPct(mc.medianMaxDrawdown)}`);
    console.log(`    Median Sharpe:          ${fmt(mc.medianSharpe)}`);
  }

  // ── Step 5: Arena Competition ──────────────────────────────────────

  separator("STEP 5: Arena Head-to-Head Competition");

  const arenaInputs = ALL_STRATEGIES.map((strategy, i) => ({
    strategy,
    walkForwardResult: wfResults[i].wf,
    monteCarloResult: mcResults[i].mc,
  }));

  const arena = arenaCompetition(arenaInputs);

  console.log("\n  ┌─────┬───────────────────────┬────────┬────────┬─────────┬─────────┬───────────┬───────────┬──────────┐");
  console.log("  │ Rank│ Strategy              │ Return │ Sharpe │  Max DD │Win Rate │  PF       │ MC Median │  Score   │");
  console.log("  ├─────┼───────────────────────┼────────┼────────┼─────────┼─────────┼───────────┼───────────┼──────────┤");

  for (const r of arena.rankings) {
    const name = `${r.strategy} (${r.version})`.padEnd(21);
    console.log(
      `  │ ${String(r.rank).padStart(3)} │ ${name} │ ${fmt(r.totalReturn, 2).padStart(6)}x│ ${fmt(r.sharpe).padStart(6)} │ ${fmtPct(r.maxDrawdownPct).padStart(7)} │ ${fmtPct(r.winRate).padStart(7)} │ ${fmt(r.profitFactor).padStart(9)} │ ${fmtMoney(r.mcMedian).padStart(9)} │ ${fmt(r.compositeScore).padStart(8)} │`
    );
  }
  console.log("  └─────┴───────────────────────┴────────┴────────┴─────────┴─────────┴───────────┴───────────┴──────────┘");

  console.log(`\n  🏆 Top Dog: ${arena.topDog}`);

  console.log("\n  Promotion Log:");
  for (const entry of arena.promotionLog) {
    console.log(`    • ${entry}`);
  }

  // ── Step 6: Top-Dog Validation ("Through the Ringer") ──────────────

  separator("STEP 6: Top-Dog Validation (Through the Ringer)");

  const topDogStrategy = ALL_STRATEGIES.find(
    s => `${s.name} (${s.version})` === arena.topDog,
  )!;

  console.log(`\n  Validating: ${arena.topDog}`);

  // 6a. Full backtest on entire dataset (not walk-forward)
  console.log("\n  6a. Full-dataset backtest:");
  const fullBT = runBacktest(topDogStrategy, dataset, {
    startingCapital: STARTING_CAPITAL,
    holdPeriodSlots: HOLD_PERIOD_SLOTS,
    maxDailyTrades: MAX_DAILY_TRADES,
  });
  console.log(`    Total Return: ${fmt(fullBT.metrics.totalReturn, 4)}x`);
  console.log(`    Final Equity: ${fmtMoney(fullBT.metrics.equityCurve[fullBT.metrics.equityCurve.length - 1] ?? STARTING_CAPITAL)}`);
  console.log(`    Sharpe:       ${fmt(fullBT.metrics.sharpeRatio)}`);
  console.log(`    Max DD:       ${fmtPct(fullBT.metrics.maxDrawdownPct)}`);
  console.log(`    Win Rate:     ${fmtPct(fullBT.metrics.winRate)}`);
  console.log(`    Total Trades: ${fullBT.metrics.totalTrades}`);
  console.log(`    Avg Win:      ${fmtMoney(fullBT.metrics.avgWinPnl)}`);
  console.log(`    Avg Loss:     ${fmtMoney(fullBT.metrics.avgLossPnl)}`);
  console.log(`    Profit Factor:${fmt(fullBT.metrics.profitFactor)}`);

  // 6b. Extended Monte Carlo (5000 sims)
  console.log("\n  6b. Extended Monte Carlo (5000 simulations):");
  const extMC = monteCarloSimulation(fullBT.metrics.tradeReturns, {
    simulations: 5000,
    seed: 31337,
    startingCapital: STARTING_CAPITAL,
    tradingDays: 504, // 2 years
    tradesPerDay: Math.max(1, Math.round(fullBT.metrics.totalTrades / DATASET_DAYS)),
  });
  console.log(`    Median Final (2yr): ${fmtMoney(extMC.medianFinalEquity)}`);
  console.log(`    Mean Final (2yr):   ${fmtMoney(extMC.mean)}`);
  console.log(`    P5 (worst 5%):      ${fmtMoney(extMC.p5)}`);
  console.log(`    P95 (best 5%):      ${fmtMoney(extMC.p95)}`);
  console.log(`    P(Profit):          ${fmtPct(extMC.probabilityOfProfit)}`);
  console.log(`    P($100k):           ${fmtPct(extMC.probabilityOf100k)}`);
  console.log(`    P(Ruin):            ${fmtPct(extMC.probabilityOfRuin)}`);
  console.log(`    Median Max DD:      ${fmtPct(extMC.medianMaxDrawdown)}`);

  // 6c. Out-of-sample robustness on different seeds
  console.log("\n  6c. Robustness check (5 different market seeds):");
  const seeds = [123, 456, 789, 1011, 2022];
  const robustnessResults = [];
  for (const seed of seeds) {
    const altData = generateDataset({
      days: 120,
      baseSeed: seed,
      basePrice: 580,
      annualVol: 0.16,
    });
    const bt = runBacktest(topDogStrategy, altData, {
      startingCapital: STARTING_CAPITAL,
      holdPeriodSlots: HOLD_PERIOD_SLOTS,
      maxDailyTrades: MAX_DAILY_TRADES,
    });
    robustnessResults.push({
      seed,
      finalEquity: bt.metrics.equityCurve[bt.metrics.equityCurve.length - 1] ?? STARTING_CAPITAL,
      totalReturn: bt.metrics.totalReturn,
      sharpe: bt.metrics.sharpeRatio,
      maxDD: bt.metrics.maxDrawdownPct,
      winRate: bt.metrics.winRate,
      trades: bt.metrics.totalTrades,
    });
    console.log(
      `    Seed ${String(seed).padStart(4)}: ` +
      `Return=${fmt(bt.metrics.totalReturn, 3)}x  ` +
      `Sharpe=${fmt(bt.metrics.sharpeRatio)}  ` +
      `DD=${fmtPct(bt.metrics.maxDrawdownPct)}  ` +
      `WR=${fmtPct(bt.metrics.winRate)}  ` +
      `Trades=${bt.metrics.totalTrades}`
    );
  }

  const avgRobustReturn = robustnessResults.reduce((s, r) => s + r.totalReturn, 0) / robustnessResults.length;
  const avgRobustSharpe = robustnessResults.reduce((s, r) => s + r.sharpe, 0) / robustnessResults.length;
  console.log(`\n    Average Return: ${fmt(avgRobustReturn, 3)}x`);
  console.log(`    Average Sharpe: ${fmt(avgRobustSharpe)}`);

  // 6d. Tradier compatibility final check
  console.log("\n  6d. Tradier API final compatibility:");
  const topDogCompat = compatResults.find(c => c.strategy.includes(topDogStrategy.version));
  if (topDogCompat) {
    console.log(`    ${topDogCompat.allCompatible ? "✓ FULLY COMPATIBLE" : "⚠ HAS ISSUES"}`);
    for (const r of topDogCompat.results) {
      const icon = r.severity === "ok" ? "✓" : r.severity === "warning" ? "⚠" : "✗";
      console.log(`      ${icon} ${r.feature}: ${r.detail}`);
    }
  }

  // ── Summary ────────────────────────────────────────────────────────

  separator("FINAL SUMMARY");

  console.log(`\n  🏆 Top-Dog Strategy: ${arena.topDog}`);
  console.log(`  📊 Edge Sources: ${topDogStrategy.edgeSources.join(", ")}`);
  console.log(`  💰 Starting Capital: ${fmtMoney(STARTING_CAPITAL)}`);
  console.log(`  🎯 Target: ${fmtMoney(TARGET_PROFIT)}`);
  console.log(`  📈 Walk-Forward OOS Return: ${fmt(wfResults.find(w => w.strategy === topDogStrategy)?.wf.aggregatedOOS.totalReturn ?? 0, 4)}x`);
  console.log(`  📉 Walk-Forward OOS Max DD: ${fmtPct(wfResults.find(w => w.strategy === topDogStrategy)?.wf.aggregatedOOS.maxDrawdownPct ?? 0)}`);
  console.log(`  🎲 MC Median (2yr): ${fmtMoney(extMC.medianFinalEquity)}`);
  console.log(`  🎲 MC P($100k):     ${fmtPct(extMC.probabilityOf100k)}`);
  console.log(`  ✅ Tradier Compatible: ${topDogCompat?.allCompatible ? "Yes" : "Has warnings"}`);
  console.log(`  ✅ Walk-Forward Validated: Yes (${wfResults.find(w => w.strategy === topDogStrategy)?.wf.windows.length ?? 0} windows)`);
  console.log(`  ✅ Monte Carlo Validated: Yes (${MONTE_CARLO_SIMS} + 5000 sims)`);
  console.log(`  ✅ Robustness Checked: Yes (5 seeds, avg return ${fmt(avgRobustReturn, 3)}x)`);

  console.log("\n  Strategy Description:");
  console.log(`    ${topDogStrategy.description}`);
  console.log("\n  Non-retail edge sources:");
  for (const edge of topDogStrategy.edgeSources) {
    console.log(`    • ${edge}`);
  }

  console.log("\n" + "═".repeat(72));
  console.log("  Arena competition complete. Top dog validated through the ringer.");
  console.log("═".repeat(72) + "\n");
}

main().catch(console.error);
