/**
 * HFT Cash v6 - Latency Instrumentation
 * Measures pipeline stages: receive → parse → signal → audit → execute.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface LatencyRecord {
  receivedAt: number;
  parsedAt?: number;
  signalAt?: number;
  executedAt?: number;
}

function loadLatencyConfig(): { targetDataMs: number; targetExecMs: number } {
  try {
    const raw = fs.readFileSync(path.join(__dirname, "../../config.json"), "utf8");
    const c = JSON.parse(raw);
    return {
      targetDataMs: c.latency?.targetDataMs ?? 10,
      targetExecMs: c.latency?.targetExecMs ?? 5,
    };
  } catch {
    return { targetDataMs: 10, targetExecMs: 5 };
  }
}

export function createLatencyRecord(): LatencyRecord {
  return { receivedAt: Date.now() };
}

export function recordParse(rec: LatencyRecord): void {
  rec.parsedAt = Date.now();
}

export function recordSignal(rec: LatencyRecord): void {
  rec.signalAt = Date.now();
}

export function recordExecuted(rec: LatencyRecord): void {
  rec.executedAt = Date.now();
}

export function dataLatencyMs(rec: LatencyRecord): number {
  return (rec.parsedAt ?? rec.receivedAt) - rec.receivedAt;
}

export function execLatencyMs(rec: LatencyRecord): number {
  if (!rec.executedAt || !rec.signalAt) return 0;
  return rec.executedAt - rec.signalAt;
}

export function isWithinTargets(rec: LatencyRecord): { data: boolean; exec: boolean } {
  const cfg = loadLatencyConfig();
  return {
    data: dataLatencyMs(rec) < cfg.targetDataMs,
    exec: rec.executedAt ? execLatencyMs(rec) < cfg.targetExecMs : true,
  };
}
