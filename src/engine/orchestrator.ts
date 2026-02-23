/**
 * HFT Cash v6 - Orchestrator
 * Starts socket bridge and wires sniffer payloads to parser/signal/execution pipeline.
 */
import { initializeSovereignEngine } from "./core.js";
import { startSocketBridge } from "./socket-bridge.js";

async function main() {
  const engine = await initializeSovereignEngine();
  console.log("[Orchestrator] Engine initialized. Settled funds:", engine.db.data.account.settled_funds);

  startSocketBridge((payload) => {
    // Step 2 will add parsing; Step 3 signal gen; Step 4 execution
    if (payload.length > 0) {
      // Placeholder: log payload size for now
      if (process.env.DEBUG) {
        console.log("[Orchestrator] Received payload:", payload.length, "bytes");
      }
    }
  });

  console.log("[Orchestrator] Socket bridge active. Awaiting sniffer data.");
}

main().catch((err) => {
  console.error("[Orchestrator] Fatal:", err);
  process.exit(1);
});
