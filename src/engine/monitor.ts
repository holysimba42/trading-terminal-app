/**
 * HFT Cash v6 - Monitoring Server & Alerts
 * Serves dashboard API, computes drawdown, emits alerts.
 */
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { fireAlert } from "./alerts.js";
import { buildTestPayload, injectPayload } from "./inject-payload.js";
import { fetchRealQuote } from "./fetch-real-options.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.MONITOR_PORT) || 31338;
const DB_PATH = path.join(__dirname, "../../data/db.json");
const HISTORICAL_EQUITY_PATH = path.join(__dirname, "../../data/historical-equity.json");

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

export function startMonitor() {
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
          historical_equity: historical_equity,
        })
      );
      return;
    }

    if (req.method === "POST" && req.url === "/api/test-trade") {
      res.setHeader("Content-Type", "application/json");
      const dbBefore = loadDb();
      const tradesBefore = (dbBefore.operational_limits as Record<string, number>)?.trades_executed_today ?? 0;
      const payload = buildTestPayload();
      const result = await injectPayload(payload);
      if (!result.ok) {
        res.statusCode = 503;
        res.end(JSON.stringify(result));
        return;
      }
      await new Promise((r) => setTimeout(r, 1500));
      const dbAfter = loadDb();
      const tradesAfter = (dbAfter.operational_limits as Record<string, number>)?.trades_executed_today ?? 0;
      const verified = tradesAfter > tradesBefore;
      if (!verified) {
        res.statusCode = 200;
        res.end(
          JSON.stringify({
            ok: true,
            verified: false,
            error:
              "Payload sent but db not updated. Run orchestrator from the SAME project folder: cd to project, then npm start.",
          })
        );
        return;
      }
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, verified: true }));
      return;
    }

    if (req.method === "POST" && req.url === "/api/test-trade-real") {
      res.setHeader("Content-Type", "application/json");
      const dbBefore = loadDb();
      const tradesBefore = (dbBefore.operational_limits as Record<string, number>)?.trades_executed_today ?? 0;

      let realData: Awaited<ReturnType<typeof fetchRealQuote>>;
      try {
        realData = await fetchRealQuote();
      } catch (err) {
        res.statusCode = 503;
        res.end(
          JSON.stringify({
            ok: false,
            error: `Fetch failed: ${err instanceof Error ? err.message : String(err)}`,
          })
        );
        return;
      }

      if (!realData) {
        res.statusCode = 200;
        res.end(
          JSON.stringify({
            ok: false,
            error: "No 0DTE SPY/QQQ option with valid bid/ask found. Try during market hours.",
          })
        );
        return;
      }

      const result = await injectPayload(realData.payload);
      if (!result.ok) {
        res.statusCode = 503;
        res.end(JSON.stringify(result));
        return;
      }
      await new Promise((r) => setTimeout(r, 1500));
      const dbAfter = loadDb();
      const tradesAfter = (dbAfter.operational_limits as Record<string, number>)?.trades_executed_today ?? 0;
      const verified = tradesAfter > tradesBefore;
      if (!verified) {
        res.statusCode = 200;
        res.end(
          JSON.stringify({
            ok: true,
            verified: false,
            source: realData.source,
            error:
              "Payload sent but db not updated. Run orchestrator from the SAME project folder: npm start.",
          })
        );
        return;
      }
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, verified: true, source: realData.source }));
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

  server.on("error", (err) => {
    console.error("[Monitor] Error:", err.message);
  });

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`[Monitor] http://127.0.0.1:${PORT}/api/status (also http://0.0.0.0:${PORT})`);
  });

  return server;
}

startMonitor();
