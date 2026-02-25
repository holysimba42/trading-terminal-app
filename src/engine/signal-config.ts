/**
 * HFT Cash v6 - Signal Configuration
 * Tunable strategy parameters. Loads from config.json when available.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, "../../config.json");

export interface SignalConfig {
  maxSpreadCents: number;
  minMidCents: number;
  minVolume: number;
  maxContracts: number;
  positionSizePct: number;
}

export const DEFAULT_SIGNAL_CONFIG: SignalConfig = {
  maxSpreadCents: 5,
  minMidCents: 10,
  minVolume: 0,
  maxContracts: 100,
  positionSizePct: 0.02,
};

function loadFromFile(): Partial<SignalConfig> {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return parsed.signal ?? {};
  } catch {
    return {};
  }
}

let config: SignalConfig = { ...DEFAULT_SIGNAL_CONFIG, ...loadFromFile() };

export function getSignalConfig(): SignalConfig {
  return { ...config };
}

export function setSignalConfig(c: Partial<SignalConfig>): void {
  config = { ...config, ...c };
}
