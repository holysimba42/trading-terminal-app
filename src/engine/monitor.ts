/**
 * HFT Cash v6 - Monitoring Server & Alerts
 * Serves dashboard API, computes drawdown, emits alerts.
 */
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { fireAlert } from "./alerts.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.MONITOR_PORT) || 31338;
const DB_PATH = path.join(__dirname, "../../data/db.json");

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
  const server = http.createServer((req, res) => {
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
        })
      );
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

  server.listen(PORT, () => {
    console.log(`[Monitor] http://127.0.0.1:${PORT}/api/status`);
  });

  return server;
}

startMonitor();
