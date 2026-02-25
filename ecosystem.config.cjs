/**
 * HFT Cash v6 - PM2 Ecosystem
 * pm2 start ecosystem.config.cjs
 */
const path = require("path");
const fs = require("fs");
const logsDir = path.join(__dirname, "logs");
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

module.exports = {
  apps: [
    {
      name: "hft-cash-v6",
      script: "dist/engine/orchestrator.js",
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "200M",
      error_file: "logs/error.log",
      out_file: "logs/out.log",
      merge_logs: true,
      env: { NODE_ENV: "production" },
    },
    {
      name: "hft-cash-v6-monitor",
      script: "dist/engine/monitor.js",
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      error_file: "logs/monitor-error.log",
      out_file: "logs/monitor-out.log",
      env: { PAPER_TRADING: "1" },
    },
  ],
};
