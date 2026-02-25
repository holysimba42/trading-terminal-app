/**
 * HFT Cash v6 - Backtest
 * Runs strategy against simulated quote stream.
 */
import { initializeSovereignEngine } from "./core.js";
import { generateSignal } from "./signal.js";
import { setSignalConfig } from "./signal-config.js";
import type { OptionsQuote } from "./parser.js";

const today = new Date().toISOString().slice(0, 10);

function makeQuote(symbol: string, strike: number, bid: number, ask: number): OptionsQuote {
  return {
    symbol,
    strike,
    expiry: today,
    bid,
    ask,
    mid: (bid + ask) / 2,
  };
}

async function main() {
  const engine = await initializeSovereignEngine();
  setSignalConfig({ maxSpreadCents: 5, minMidCents: 10, maxContracts: 10 });

  const stream: OptionsQuote[] = [
    makeQuote("SPY", 600, 1.25, 1.28),
    makeQuote("SPY", 601, 0.95, 0.98),
    makeQuote("QQQ", 450, 2.10, 2.15),
    makeQuote("SPY", 602, 0.50, 0.55),
    makeQuote("SPY", 600, 1.30, 1.35),
  ];

  let signals = 0;
  let executed = 0;

  for (const q of stream) {
    const signal = generateSignal(q);
    if (!signal) continue;
    signals++;

    const { result } = engine.performAuditWithLog({
      contracts: signal.contracts,
      side: signal.side,
      symbol: signal.symbol,
    });
    if (result === "YES") {
      engine.applyFriction(signal.contracts);
      engine.recordTrade(signal.contracts);
      executed++;
    }
  }

  await engine.persist();

  const pnl = engine.db.data.account.settled_funds - engine.db.data.account.starting_capital;
  console.log("[Backtest] Signals:", signals, "Executed:", executed);
  console.log("[Backtest] Final settled:", engine.db.data.account.settled_funds.toFixed(2));
  console.log("[Backtest] PnL (friction only):", pnl.toFixed(2));
}

main().catch(console.error);
