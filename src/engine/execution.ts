/**
 * HFT Cash v6 - Execution Bridge
 * Loads C++ kernel addon and executes Ghost-Mode clicks when approved.
 */
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

let kernel: { executeClick: (x?: number, y?: number) => boolean } | null = null;

function loadKernel() {
  if (kernel) return kernel;
  try {
    const addonPath = path.join(__dirname, "../kernel/build/Release/webull_ghost.node");
    kernel = require(addonPath);
    return kernel;
  } catch {
    return null;
  }
}

/**
 * Execute Ghost-Mode click. Returns true if successful.
 * MOCK_EXECUTION=1: always returns true (for testing).
 */
export function executeClick(x?: number, y?: number): boolean {
  if (process.env.MOCK_EXECUTION === "1") return true;
  const k = loadKernel();
  if (!k) return false;
  return k.executeClick(x ?? 0, y ?? 0);
}

function sleepSync(ms: number): void {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    // busy wait
  }
}

/**
 * Execute with retries. Returns true if any attempt succeeds.
 */
export function executeClickWithRetry(retries = 3, delayMs = 50): boolean {
  for (let i = 0; i < retries; i++) {
    if (executeClick()) return true;
    if (i < retries - 1) sleepSync(delayMs);
  }
  return false;
}
