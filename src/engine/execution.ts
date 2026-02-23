/**
 * HFT Cash v6 - Execution Bridge
 * Loads C++ kernel addon and executes Ghost-Mode clicks when approved.
 */
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

let kernel: { executeClick: () => boolean } | null = null;

function loadKernel(): { executeClick: () => boolean } | null {
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
 * Execute Ghost-Mode click. Returns true if successful (Windows + Webull found).
 */
export function executeClick(): boolean {
  const k = loadKernel();
  if (!k) return false;
  return k.executeClick();
}
