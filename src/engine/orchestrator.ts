/**
 * HFT Cash v6 - Orchestrator
 * Starts socket bridge and wires sniffer payloads to parser/signal/execution pipeline.
 */
import { initializeSovereignEngine, type SovereignEngine } from "./core.js";
import { startSocketBridge } from "./socket-bridge.js";
import { parsePayload } from "./parser.js";
import { generateSignal, type TradeSignal } from "./signal.js";
import { executeClick } from "./execution.js";
import { persistToGit } from "./git-persist.js";

async function main() {
  const engine = await initializeSovereignEngine();
  console.log("[Orchestrator] Engine initialized. Settled funds:", engine.db.data.account.settled_funds);

  startSocketBridge((payload) => {
    if (payload.length === 0) return;
    const quotes = parsePayload(payload);
    for (const q of quotes) {
      if (process.env.DEBUG) {
        console.log("[Orchestrator] Parsed:", q.symbol, q.strike, "bid:", q.bid, "ask:", q.ask);
      }
      const signal = generateSignal(q);
      if (signal) {
        void onTradeSignal(engine, signal);
      }
    }
  });

  console.log("[Orchestrator] Socket bridge active. Awaiting sniffer data.");
}

async function onTradeSignal(engine: SovereignEngine, signal: TradeSignal) {
  const payload = { contracts: signal.contracts, side: signal.side, symbol: signal.symbol };
  const { result } = engine.performAuditWithLog(payload);
  if (result !== "YES") return;

  const ok = executeClick();
  if (ok) {
    engine.applyFriction(signal.contracts);
    engine.recordTrade(signal.contracts);
    await engine.persist();
    persistToGit();
    if (process.env.DEBUG) {
      console.log("[Orchestrator] Executed:", signal.side, signal.contracts, signal.symbol);
    }
  }
}

main().catch((err) => {
  console.error("[Orchestrator] Fatal:", err);
  process.exit(1);
});
