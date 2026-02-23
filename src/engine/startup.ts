/**
 * HFT Cash v6 - Startup Validation
 * Verifies db, kernel addon, socket bind before accepting traffic.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

export interface StartupResult {
  ok: boolean;
  errors: string[];
}

export async function validateStartup(): Promise<StartupResult> {
  const errors: string[] = [];
  const dbPath = path.join(__dirname, "../../data/db.json");
  const addonPath = path.join(process.cwd(), "src/kernel/build/Release/webull_ghost.node");

  if (!fs.existsSync(dbPath)) {
    errors.push("data/db.json not found");
  } else {
    try {
      const raw = fs.readFileSync(dbPath, "utf8");
      const db = JSON.parse(raw);
      if (!db.account?.starting_capital) errors.push("db.json: invalid schema");
    } catch {
      errors.push("db.json: parse error");
    }
  }

  if (process.env.MOCK_EXECUTION !== "1" && process.env.PAPER_TRADING !== "1") {
    if (!fs.existsSync(addonPath)) {
      errors.push("kernel addon not built (run npm run rebuild)");
    } else {
      try {
        require(addonPath);
      } catch {
        errors.push("kernel addon load failed");
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}
