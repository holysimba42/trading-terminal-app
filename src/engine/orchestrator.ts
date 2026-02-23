/**
 * HFT Cash v6 - Orchestrator
 * Starts socket bridge and wires sniffer payloads to parser/signal/execution pipeline.
 */
import { initializeSovereignEngine, type SovereignEngine } from "./core.js";
import { startSocketBridge } from "./socket-bridge.js";
import { parsePayload } from "./parser.js";
import { generateSignal } from "./signal.js";

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
        onTradeSignal(engine, signal);
      }
    }
  });

  console.log("[Orchestrator] Socket bridge active. Awaiting sniffer data.");
}

function onTradeSignal(_engine: SovereignEngine, _signal: import("./signal.js").TradeSignal) {
  // Step 4: execution via Integrity Watchdog + kernel
}

main().catch((err) => {
  console.error("[Orchestrator] Fatal:", err);
  process.exit(1);
});
