/**
 * HFT Cash v6 - Orchestrator
 * Starts socket bridge and wires sniffer payloads to parser/signal/execution pipeline.
 */
import { initializeSovereignEngine, type SovereignEngine } from "./core.js";
import { startSocketBridge } from "./socket-bridge.js";
import { parsePayload } from "./parser.js";
import { generateSignal, type TradeSignal } from "./signal.js";
import { executeClickWithRetry } from "./execution.js";
import { persistToGit } from "./git-persist.js";
import { logger } from "./logger.js";
import {
  createLatencyRecord,
  recordParse,
  recordSignal,
  recordExecuted,
  dataLatencyMs,
  execLatencyMs,
  isWithinTargets,
} from "./latency.js";
import { validateStartup } from "./startup.js";

async function main() {
  const startup = await validateStartup();
  if (!startup.ok) {
    startup.errors.forEach((e) => logger.error(`Startup: ${e}`));
    process.exit(1);
  }

  const engine = await initializeSovereignEngine();
  logger.info(`Engine initialized. Settled funds: ${engine.db.data.account.settled_funds}`);

  const server = startSocketBridge((payload) => {
    if (payload.length === 0) return;
    const rec = createLatencyRecord();
    const quotes = parsePayload(payload);
    recordParse(rec);
    for (const q of quotes) {
      if (process.env.DEBUG) {
        console.log("[Orchestrator] Parsed:", q.symbol, q.strike, "bid:", q.bid, "ask:", q.ask);
      }
      const signal = generateSignal(q);
      if (signal) {
        recordSignal(rec);
        void onTradeSignal(engine, signal, rec);
      }
    }
  });

  const shutdown = () => {
    logger.info("Shutting down...");
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  logger.info("Socket bridge active. Awaiting sniffer data.");
}

async function onTradeSignal(
  engine: SovereignEngine,
  signal: TradeSignal,
  rec: import("./latency.js").LatencyRecord
) {
  const payload = { contracts: signal.contracts, side: signal.side, symbol: signal.symbol };
  const { result } = engine.performAuditWithLog(payload);
  if (result !== "YES") return;

  const paperTrading = process.env.PAPER_TRADING === "1";
  const ok = paperTrading || executeClickWithRetry(3, 50);
  if (ok) {
    if (!paperTrading) recordExecuted(rec);
    engine.applyFriction(signal.contracts);
    engine.recordTrade(signal.contracts);
    await engine.persist();
    if (!paperTrading) persistToGit();
    const { data, exec } = isWithinTargets(rec);
    if (process.env.DEBUG) {
      logger.info(
        `Executed: ${signal.side} ${signal.contracts} ${signal.symbol} | data: ${dataLatencyMs(rec)}ms exec: ${execLatencyMs(rec)}ms`
      );
    }
    if (!data || !exec) logger.warn(`Latency target miss: data=${dataLatencyMs(rec)}ms exec=${execLatencyMs(rec)}ms`);
  }
}

main().catch((err) => {
  logger.error(`Fatal: ${err}`);
  process.exit(1);
});
