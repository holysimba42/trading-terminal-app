#!/usr/bin/env node
/**
 * Stop all dashboard/monitor processes.
 * Kills processes on port 31338 (monitor).
 * Run before opening dashboard to avoid EADDRINUSE.
 * Priority: run before every dashboard iteration.
 */
import { execSync } from "child_process";

const MONITOR_PORT = 31338;

function stopUnix() {
  try {
    execSync(`pkill -f "node dist/engine/monitor" 2>/dev/null || true`, { stdio: "ignore" });
    execSync(`pkill -f "node dist/engine/dashboard-server" 2>/dev/null || true`, {
      stdio: "ignore",
    });
  } catch {
    /* ignore */
  }
  try {
    const pids = execSync(`lsof -ti:${MONITOR_PORT} 2>/dev/null`, {
      encoding: "utf8",
    })
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    for (const pid of pids) {
      execSync(`kill -9 ${pid} 2>/dev/null`, { stdio: "ignore" });
    }
  } catch {
    /* port not in use */
  }
}

function stopWindows() {
  try {
    const out = execSync(`netstat -ano | findstr :${MONITOR_PORT}`, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const lines = out.trim().split("\n");
    const pids = new Set();
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (/^\d+$/.test(pid)) pids.add(pid);
    }
    for (const pid of pids) {
      try {
        execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore" });
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* port not in use */
  }
}

if (process.platform === "win32") {
  stopWindows();
} else {
  stopUnix();
}

console.log("[Stop] Dashboard processes stopped. Port", MONITOR_PORT, "is free.");
console.log("[Stop] Close any dashboard browser tabs for a clean start.");
