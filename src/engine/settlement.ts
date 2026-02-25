/**
 * HFT Cash v6 - T+1 Settlement Scripts
 * Run via cron (Linux) or Task Scheduler (Windows).
 * settle-t1: EOD (e.g. 4:00 PM ET) - move pending_t1 to settled
 * reset-daily: Market open (e.g. 9:30 AM ET) - reset trades_executed_today
 */
import { initializeSovereignEngine } from "./core.js";
import { persistToGit } from "./git-persist.js";

async function main() {
  const cmd = process.argv[2] ?? "help";
  const engine = await initializeSovereignEngine();

  switch (cmd) {
    case "settle-t1":
      engine.settleT1();
      await engine.persist();
      persistToGit();
      console.log("[Settlement] T+1 settled. Settled funds:", engine.db.data.account.settled_funds);
      break;
    case "reset-daily":
      engine.resetDailyTrades();
      await engine.persist();
      persistToGit();
      console.log("[Settlement] Daily trades reset. trades_executed_today:", engine.db.data.operational_limits.trades_executed_today);
      break;
    default:
      console.log("Usage: node settlement.js <settle-t1|reset-daily>");
      console.log("  settle-t1   - EOD: move pending_t1 to settled");
      console.log("  reset-daily - Market open: reset daily trade counter");
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
