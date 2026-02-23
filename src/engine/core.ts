/**
 * HFT Cash v6 - Sovereign State Machine & Risk Engine
 * Enforces: 10 trades/day cap, 100 contracts max, $0.07 combined friction per contract.
 * Integrity Watchdog: YES, NO, NO self-reflection audit calibrated to 55.86% max drawdown.
 */
import { JSONFilePreset } from "lowdb/node";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface TradePayload {
  contracts: number;
  side: "BUY" | "SELL";
  symbol?: string;
}

export interface AccountData {
  starting_capital: number;
  settled_funds: number;
  pending_t1_funds: number;
  max_drawdown_limit: number;
}

export interface OperationalLimits {
  daily_trade_cap: number;
  trades_executed_today: number;
  max_contracts_per_order: number;
  friction_spread: number;
  friction_slippage: number;
  commission: number;
}

export interface Metrics {
  target_win_rate: number;
  equity_curve: number[];
}

export interface AuditLogEntry {
  ts: string;
  payload: TradePayload;
  result: AuditResult;
  reason?: string;
}

export interface DbSchema {
  account: AccountData;
  operational_limits: OperationalLimits;
  metrics: Metrics;
  audit_trail: AuditLogEntry[];
}

const defaultData: DbSchema = {
  account: {
    starting_capital: 300.0,
    settled_funds: 300.0,
    pending_t1_funds: 0.0,
    max_drawdown_limit: 0.5586,
  },
  operational_limits: {
    daily_trade_cap: 10,
    trades_executed_today: 0,
    max_contracts_per_order: 100,
    friction_spread: 0.05,
    friction_slippage: 0.02,
    commission: 0.0,
  },
  metrics: {
    target_win_rate: 0.8467,
    equity_curve: [],
  },
  audit_trail: [],
};

export type AuditResult = "YES" | "NO";

export interface SovereignEngine {
  db: { data: DbSchema; write: () => Promise<void> };
  performAudit: (trade: TradePayload) => AuditResult;
  performAuditWithLog: (trade: TradePayload) => { result: AuditResult; reason?: string };
  applyFriction: (contracts: number) => void;
  settleT1: () => void;
  resetDailyTrades: () => void;
  recordTrade: (contracts: number) => void;
  persist: () => Promise<void>;
}

/**
 * Integrity Watchdog: YES, NO, NO self-reflection audit.
 * Calibrated against known historical maximum drawdown of 55.86%.
 */
export function performAudit(
  db: { data: DbSchema },
  proposedTrade: TradePayload
): AuditResult {
  return performAuditWithReason(db, proposedTrade).result;
}

export function performAuditWithReason(
  db: { data: DbSchema },
  proposedTrade: TradePayload
): { result: AuditResult; reason?: string } {
  const { operational_limits, account } = db.data;

  if (operational_limits.trades_executed_today >= operational_limits.daily_trade_cap) {
    return { result: "NO", reason: "daily_trade_cap" };
  }
  if (proposedTrade.contracts > operational_limits.max_contracts_per_order) {
    return { result: "NO", reason: "max_contracts" };
  }

  const peak = Math.max(
    account.starting_capital,
    ...(db.data.metrics.equity_curve.length ? [Math.max(...db.data.metrics.equity_curve)] : [])
  );
  const currentDrawdown = 1 - account.settled_funds / peak;
  if (currentDrawdown >= account.max_drawdown_limit) {
    return { result: "NO", reason: "max_drawdown" };
  }

  return { result: "YES" };
}

function appendAuditLog(db: { data: DbSchema }, payload: TradePayload, result: AuditResult, reason?: string) {
  db.data.audit_trail.push({
    ts: new Date().toISOString(),
    payload: { ...payload },
    result,
    reason,
  });
  if (db.data.audit_trail.length > 1000) {
    db.data.audit_trail = db.data.audit_trail.slice(-500);
  }
}

/**
 * Apply strict $0.07 combined friction per contract (spread + slippage).
 */
export function applyFriction(
  db: { data: DbSchema },
  contracts: number
): void {
  const { friction_spread, friction_slippage } = db.data.operational_limits;
  const totalFriction = contracts * (friction_spread + friction_slippage);
  db.data.account.settled_funds -= totalFriction;
}

/**
 * T+1 Settlement: Move funds from pending to settled (call at EOD).
 */
export function settleT1(db: { data: DbSchema }): void {
  db.data.account.settled_funds += db.data.account.pending_t1_funds;
  db.data.account.pending_t1_funds = 0;
}

/**
 * Reset daily trade counter (call at market open).
 */
export function resetDailyTrades(db: { data: DbSchema }): void {
  db.data.operational_limits.trades_executed_today = 0;
}

export async function initializeSovereignEngine(): Promise<SovereignEngine> {
  const dbPath = path.join(__dirname, "../../data/db.json");
  const db = await JSONFilePreset<DbSchema>(dbPath, defaultData);
  if (!Array.isArray(db.data.audit_trail)) {
    db.data.audit_trail = [];
  }

  return {
    db,
    performAudit: (trade: TradePayload) => performAudit(db, trade),
    performAuditWithLog: (trade: TradePayload) => {
      const { result, reason } = performAuditWithReason(db, trade);
      appendAuditLog(db, trade, result, reason);
      return { result, reason };
    },
    applyFriction: (contracts: number) => applyFriction(db, contracts),
    settleT1: () => settleT1(db),
    resetDailyTrades: () => resetDailyTrades(db),
    recordTrade: (contracts: number) => {
      db.data.operational_limits.trades_executed_today += 1;
      db.data.metrics.equity_curve.push(db.data.account.settled_funds);
    },
    persist: () => db.write(),
  };
}
