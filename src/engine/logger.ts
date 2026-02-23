/**
 * HFT Cash v6 - File Logger
 * Writes to logs/ when available, falls back to stdout.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.join(__dirname, "../../logs");

function ensureLogDir() {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

function logLine(level: string, msg: string) {
  const line = `[${new Date().toISOString()}] [${level}] ${msg}\n`;
  process.stdout.write(line);
  if (ensureLogDir()) {
    try {
      fs.appendFileSync(path.join(LOG_DIR, "app.log"), line);
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
