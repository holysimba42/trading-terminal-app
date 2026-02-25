#!/usr/bin/env node
/**
 * Start monitor and open dashboard in browser.
 * Run from project root: npm run dashboard
 * Stops any existing dashboard processes first (priority rule).
 */
import { spawn, exec, execSync } from "child_process";
import path from "path";
import fs from "fs";
import http from "http";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");
const PORT = 31338;
const URL = `http://127.0.0.1:${PORT}/`;

function openBrowser() {
  const cmd =
    process.platform === "win32"
      ? `start "" "${URL}"`
      : process.platform === "darwin"
        ? `open "${URL}"`
        : `xdg-open "${URL}"`;
  exec(cmd, () => {});
}

function waitForReady() {
  return new Promise((resolve) => {
    const deadline = Date.now() + 5000;
    const check = () => {
      const req = http.get(`${URL}health`, (res) => {
        if (res.statusCode === 200) {
          resolve(true);
          return;
        }
        if (Date.now() < deadline) setTimeout(check, 200);
        else resolve(false);
      });
      req.on("error", () => {
        if (Date.now() < deadline) setTimeout(check, 200);
        else resolve(false);
      });
      req.setTimeout(500, () => {
        req.destroy();
        if (Date.now() < deadline) setTimeout(check, 200);
        else resolve(false);
      });
    };
    check();
  });
}

const serverPath = path.join(PROJECT_ROOT, "dist/engine/dashboard-server.js");
if (!fs.existsSync(serverPath)) {
  console.error("Run 'npm run build' first.");
  process.exit(1);
}

// Priority: stop existing dashboard before starting (avoids EADDRINUSE)
try {
  execSync("node scripts/stop-dashboard.js", {
    cwd: PROJECT_ROOT,
    stdio: "inherit",
  });
} catch {
  /* ignore */
}
await new Promise((r) => setTimeout(r, 500));

const monitor = spawn("node", ["dist/engine/dashboard-server.js"], {
  cwd: PROJECT_ROOT,
  stdio: "inherit",
  env: { ...process.env, PAPER_TRADING: "1" },
});

let monitorExited = false;
monitor.on("error", (err) => {
  console.error("Failed to start monitor:", err);
  process.exit(1);
});
monitor.on("exit", (code) => {
  monitorExited = true;
  if (code !== 0 && code !== null) {
    console.error("Monitor exited with code", code, "- port may be in use.");
  }
});

(async () => {
  const ready = await waitForReady();
  if (ready) {
    openBrowser();
    console.log("Dashboard:", URL);
  } else if (monitorExited) {
    openBrowser();
    console.log("Dashboard:", URL);
    console.log("(Monitor may have failed; if page does not load, try: pkill -f 'node dist/engine/monitor')");
  } else {
    openBrowser();
    console.log("Dashboard:", URL);
  }
})();
