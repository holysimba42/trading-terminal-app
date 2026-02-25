/**
 * HFT Cash v6 - Simulate 11-Trade Loop
 * Validates strict 10-trade daily cap rejection mechanism.
 */
import { initializeSovereignEngine } from "./core.js";

async function main() {
  const engine = await initializeSovereignEngine();
  const { db, performAudit, applyFriction, recordTrade } = engine;

  console.log("=== HFT Cash v6 - 10-Trade Cap Validation ===\n");
  console.log("Initial settled_funds:", db.data.account.settled_funds);
  console.log("Daily trade cap:", db.data.operational_limits.daily_trade_cap);
  console.log("");

  for (let i = 1; i <= 11; i++) {
    const proposedTrade = { contracts: 1, side: "BUY" as const };
    const audit = performAudit(proposedTrade);

    if (audit === "YES") {
      applyFriction(1);
      recordTrade(1);
      console.log(`Trade ${i}: YES - Executed. Settled: $${db.data.account.settled_funds.toFixed(2)}`);
    } else {
      console.log(`Trade ${i}: NO  - REJECTED (cap exceeded or limit hit)`);
    }
  }

  console.log("\n=== Result ===");
  console.log("Trades executed:", db.data.operational_limits.trades_executed_today);
  console.log("Final settled_funds:", db.data.account.settled_funds.toFixed(2));
  const passed = db.data.operational_limits.trades_executed_today === 10;
  console.log(passed ? "PASS: 10-trade cap enforced." : "FAIL: Cap not enforced.");
  process.exit(passed ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
