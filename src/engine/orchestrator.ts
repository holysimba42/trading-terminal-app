/**
 * HFT Cash v6 - Orchestrator
 * Starts socket bridge and wires sniffer payloads to parser/signal/execution pipeline.
 */
import { initializeSovereignEngine, type SovereignEngine } from "./core.js";
import { startSocketBridge } from "./socket-bridge.js";
import { parsePayload, type OptionsQuote } from "./parser.js";

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
      // Step 3: signal generation; Step 4: execution
      onParsedQuote(engine, q);
    }
  });

  console.log("[Orchestrator] Socket bridge active. Awaiting sniffer data.");
}

function onParsedQuote(_engine: SovereignEngine, _quote: OptionsQuote) {
  // Step 3: signal generation; Step 4: execution
}

main().catch((err) => {
  console.error("[Orchestrator] Fatal:", err);
  process.exit(1);
});
