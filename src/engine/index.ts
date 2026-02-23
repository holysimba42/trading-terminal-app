/**
 * HFT Cash v6 - Engine Bootstrap
 * Initializes Sovereign Engine and exposes for orchestration.
 */
import { initializeSovereignEngine, type SovereignEngine } from "./core.js";

const engine: SovereignEngine = await initializeSovereignEngine();
console.log("Sovereign Engine initialized. Settled funds:", engine.db.data.account.settled_funds);

export { engine, initializeSovereignEngine };
