/**
 * HFT Cash v6 - File Logger
 * Writes to logs/ when available. Rotates by size (default 5MB).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.join(__dirname, "../../logs");
const LOG_FILE = path.join(LOG_DIR, "app.log");
const MAX_LOG_BYTES = Number(process.env.LOG_MAX_MB) * 1024 * 1024 || 5 * 1024 * 1024;

function ensureLogDir() {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

function maybeRotate() {
  try {
    const stat = fs.statSync(LOG_FILE);
    if (stat.size >= MAX_LOG_BYTES) {
      const rotated = path.join(LOG_DIR, `app.${Date.now()}.log`);
      fs.renameSync(LOG_FILE, rotated);
    }
  } catch {
    // ignore
  }
}

function logLine(level: string, msg: string) {
  const line = `[${new Date().toISOString()}] [${level}] ${msg}\n`;
  process.stdout.write(line);
  if (ensureLogDir()) {
    try {
      maybeRotate();
      fs.appendFileSync(LOG_FILE, line);
    } catch {
      // ignore
    }
  }
}

export const logger = {
  info: (msg: string) => logLine("INFO", msg),
  warn: (msg: string) => logLine("WARN", msg),
  error: (msg: string) => logLine("ERROR", msg),
};
