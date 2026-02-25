/**
 * HFT Cash v6 - Config Loader
 * Loads config.json for engine-wide settings.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, "../../config.json");

export interface ExecutionConfig {
  retries: number;
  retryDelayMs: number;
}

function loadRaw(): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

export function getExecutionConfig(): ExecutionConfig {
  const raw = loadRaw();
  const exec = (raw.execution || {}) as Record<string, number>;
  return {
    retries: exec.retries ?? 3,
    retryDelayMs: exec.retryDelayMs ?? 50,
  };
}
