#!/usr/bin/env node
/**
 * Start orchestrator (Terminal 1), wait for ready, then start dashboard (Terminal 2).
 * Single command: npm run dashboard:full
 * Ensures orchestrator is running before dashboard so Operational Tests work.
 */
import { spawn, execSync } from "child_process";
import path from "path";
import fs from "fs";
import net from "net";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");
const ORCHESTRATOR_PORT = 31337;
const SOCKET_PATH = "/tmp/hft-cash-v6-sniffer.sock";

function waitForOrchestrator() {
  return new Promise((resolve) => {
    const deadline = Date.now() + 10000;
    const check = () => {
      const isWin = process.platform === "win32";
      const client = isWin
        ? net.connect(ORCHESTRATOR_PORT, "127.0.0.1", () => {
            client.destroy();
            resolve(true);
          })
        : net.connect(SOCKET_PATH, () => {
            client.destroy();
            resolve(true);
          });
      client.on("error", () => {
        client.destroy();
        if (Date.now() < deadline) setTimeout(check, 200);
        else resolve(false);
      });
    };
    check();
  });
}

const orchestratorPath = path.join(PROJECT_ROOT, "dist/engine/orchestrator.js");
const monitorPath = path.join(PROJECT_ROOT, "dist/engine/monitor.js");
if (!fs.existsSync(orchestratorPath) || !fs.existsSync(monitorPath)) {
  console.error("Run 'npm run build' first.");
  process.exit(1);
}

console.log("[1/3] Stopping existing processes...");
try {
  execSync("node scripts/stop-dashboard.js", { cwd: PROJECT_ROOT, stdio: "inherit" });
} catch {
  /* ignore */
}
await new Promise((r) => setTimeout(r, 500));

console.log("[2/3] Starting orchestrator (Terminal 1)...");
const env = { ...process.env, PAPER_TRADING: "1" };
const orch = spawn("node", ["dist/engine/orchestrator.js"], {
  cwd: PROJECT_ROOT,
  env,
  stdio: "ignore",
  detached: true,
});
orch.unref();

const ready = await waitForOrchestrator();
if (!ready) {
  console.error("[Error] Orchestrator did not become ready in time.");
  process.exit(1);
}
console.log("[2/3] Orchestrator ready.");

console.log("[3/3] Starting dashboard (Terminal 2)...");
const dash = spawn("node", ["scripts/start-dashboard.js"], {
  cwd: PROJECT_ROOT,
  stdio: "inherit",
  detached: true,
});
dash.unref();
