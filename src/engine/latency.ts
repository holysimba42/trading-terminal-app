/**
 * HFT Cash v6 - Latency Instrumentation
 * Measures pipeline stages: receive → parse → signal → audit → execute.
 */
export interface LatencyRecord {
  receivedAt: number;
  parsedAt?: number;
  signalAt?: number;
  executedAt?: number;
}

const TARGET_DATA_MS = 10;
const TARGET_EXEC_MS = 5;

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
  return {
    data: dataLatencyMs(rec) < TARGET_DATA_MS,
    exec: rec.executedAt ? execLatencyMs(rec) < TARGET_EXEC_MS : true,
  };
}
