/**
 * HFT Cash v6 - Unified Dashboard Server
 * Single process: engine + socket bridge + HTTP monitor.
 * Operational Tests run in-process — no separate orchestrator needed.
 */
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { initializeSovereignEngine } from "./core.js";
import { startSocketBridge } from "./socket-bridge.js";
import { fireAlert } from "./alerts.js";
import { buildTestPayload } from "./inject-payload.js";
import { fetchRealQuote } from "./fetch-real-options.js";
import { processPayloadInProcess } from "./process-payload.js";
import { logger } from "./logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.MONITOR_PORT) || 31338;
const DB_PATH = path.join(__dirname, "../../data/db.json");
const HISTORICAL_EQUITY_PATH = path.join(__dirname, "../../data/historical-equity.json");

process.env.PAPER_TRADING = process.env.PAPER_TRADING || "1";

export function computeDrawdown(settled: number, peak: number): number {
  if (peak <= 0) return 0;
  return 1 - settled / peak;
}

function loadDb(): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  } catch {
    return {};
  }
}

async function main() {
  const engine = await initializeSovereignEngine();
  logger.info(`Engine initialized. Settled funds: ${engine.db.data.account.settled_funds}`);

  startSocketBridge((payload) => {
    void processPayloadInProcess(engine, payload).catch((err) =>
      logger.error(`Pipeline error: ${err}`)
    );
  });
  logger.info("Socket bridge active (sniffer).");

  const server = http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (req.url === "/health" || req.url === "/api/health") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ status: "ok", ts: new Date().toISOString() }));
      return;
    }

    if (req.url === "/api/status") {
      const db = loadDb();
      const account = (db.account || {}) as Record<string, number>;
      const operational_limits = (db.operational_limits || {}) as Record<string, number>;
      const metrics = (db.metrics || {}) as Record<string, unknown>;
      const equity_curve = (metrics.equity_curve as number[]) || [];
      const audit_trail = (db.audit_trail as unknown[]) || [];
      const peak = Math.max(
        account.starting_capital ?? 300,
        ...(equity_curve.length ? [Math.max(...equity_curve)] : [])
      );
      const drawdown = computeDrawdown(account.settled_funds ?? 300, peak);
      const alert =
        drawdown >= (account.max_drawdown_limit ?? 0.5586)
          ? "MAX_DRAWDOWN"
          : (operational_limits.trades_executed_today ?? 0) >= (operational_limits.daily_trade_cap ?? 10)
            ? "DAILY_CAP"
            : "OK";
      if (alert !== "OK") {
        fireAlert(alert, { drawdown, peak, settled_funds: account.settled_funds });
      }
      let historical_equity: { curve: { date: string; equity: number }[]; net_profit?: number } | null = null;
      try {
        if (fs.existsSync(HISTORICAL_EQUITY_PATH)) {
          const raw = JSON.parse(fs.readFileSync(HISTORICAL_EQUITY_PATH, "utf8"));
          historical_equity = {
            curve: Array.isArray(raw.curve) ? raw.curve : [],
            net_profit: typeof raw.net_profit === "number" ? raw.net_profit : undefined,
          };
        }
      } catch {
        /* ignore */
      }
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          account,
          operational_limits,
          metrics: { equity_curve: equity_curve.slice(-100) },
          audit_trail: audit_trail.slice(-20),
          drawdown,
          peak,
          alert,
          historical_equity,
        })
      );
      return;
    }

    if (req.method === "POST" && req.url === "/api/test-trade") {
      res.setHeader("Content-Type", "application/json");
      const tradesBefore = (loadDb().operational_limits as Record<string, number>)?.trades_executed_today ?? 0;
      const payload = buildTestPayload();
      await processPayloadInProcess(engine, payload);
      const tradesAfter = (loadDb().operational_limits as Record<string, number>)?.trades_executed_today ?? 0;
      const verified = tradesAfter > tradesBefore;
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, verified }));
      return;
    }

    if (req.method === "POST" && req.url === "/api/test-trade-real") {
      res.setHeader("Content-Type", "application/json");
      let realData: Awaited<ReturnType<typeof fetchRealQuote>>;
      try {
        realData = await fetchRealQuote();
      } catch (err) {
        res.statusCode = 503;
        res.end(JSON.stringify({ ok: false, error: `Fetch failed: ${err instanceof Error ? err.message : String(err)}` }));
        return;
      }
      if (!realData) {
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: false, error: "No 0DTE SPY/QQQ option with valid bid/ask found. Try during market hours." }));
        return;
      }
      const tradesBefore = (loadDb().operational_limits as Record<string, number>)?.trades_executed_today ?? 0;
      await processPayloadInProcess(engine, realData.payload);
      const tradesAfter = (loadDb().operational_limits as Record<string, number>)?.trades_executed_today ?? 0;
      const verified = tradesAfter > tradesBefore;
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, verified, source: realData.source }));
      return;
    }

    if (req.url === "/" || req.url === "/index.html") {
      const p = path.join(__dirname, "../../dashboard.html");
      const fallback = path.join(__dirname, "../../index.html");
      const file = fs.existsSync(p) ? p : fallback;
      if (fs.existsSync(file)) {
        res.setHeader("Content-Type", "text/html");
        res.end(fs.readFileSync(file));
        return;
      }
    }

    res.statusCode = 404;
    res.end("Not Found");
  });

  server.on("error", (err) => console.error("[Dashboard] Error:", err.message));
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`[Dashboard] http://127.0.0.1:${PORT}/ (engine in-process, no separate orchestrator)`);
  });
}

main().catch((err) => {
  logger.error(`Fatal: ${err}`);
  process.exit(1);
});
