/**
 * HFT Cash v6 - In-Process Payload Pipeline
 * Runs parse → signal → audit → execution without socket.
 * Used by monitor for test-trade when engine runs in same process.
 */
import type { SovereignEngine } from "./core.js";
import { parsePayload } from "./parser.js";
import { generateSignal, type TradeSignal } from "./signal.js";
import { executeClickWithRetry } from "./execution.js";
import { persistToGit } from "./git-persist.js";
import { logger } from "./logger.js";
import { fireAlert } from "./alerts.js";
import { getExecutionConfig } from "./config-loader.js";

export async function processPayloadInProcess(
  engine: SovereignEngine,
  payload: Buffer
): Promise<void> {
  if (payload.length === 0) return;
  const quotes = parsePayload(payload);
  for (const q of quotes) {
    const signal = generateSignal(q);
    if (signal) {
      await onTradeSignal(engine, signal);
    }
  }
}

async function onTradeSignal(engine: SovereignEngine, signal: TradeSignal): Promise<void> {
  const payload = { contracts: signal.contracts, side: signal.side, symbol: signal.symbol };
  const { result, reason } = engine.performAuditWithLog(payload);
  if (result !== "YES") {
    if (reason === "daily_trade_cap" || reason === "max_drawdown") {
      fireAlert("AUDIT_REJECT", { reason, payload });
    }
    return;
  }
  const paperTrading = process.env.PAPER_TRADING === "1";
  const execCfg = getExecutionConfig();
  const ok = paperTrading || executeClickWithRetry(execCfg.retries, execCfg.retryDelayMs);
  if (!ok && !paperTrading) {
    fireAlert("EXECUTION_FAILED", { payload, reason: "executeClickWithRetry returned false" });
    logger.warn("Execution failed after audit approval");
    return;
  }
  if (ok) {
    engine.applyFriction(signal.contracts);
    engine.recordTrade(signal.contracts);
    await engine.persist();
    logger.info(`[Pipeline] Trade recorded: ${signal.contracts} ${signal.side} ${signal.symbol}`);
    if (!paperTrading) persistToGit();
  }
}
