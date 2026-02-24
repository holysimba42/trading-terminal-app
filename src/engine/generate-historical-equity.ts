/**
 * HFT Cash v6 - Historical Equity Curve Generator
 * Produces a 1-year net profit equity curve based on simulated trade outcomes.
 * Uses target_win_rate (84.67%) and strategy constraints for plausible PnL.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TRADING_DAYS_PER_YEAR = 252;
const STARTING_CAPITAL = 300;
const DAILY_TRADE_CAP = 10;
const TARGET_WIN_RATE = 0.8467;
const FRICTION_PER_CONTRACT = 0.07;

// PnL ranges (net of friction) per trade - typical 0DTE outcomes
const WIN_MIN = 2;
const WIN_MAX = 12;
const LOSS_MIN = -25;
const LOSS_MAX = -8;

interface CurvePoint {
  date: string;
  equity: number;
  trades: number;
  pnl: number;
}

function seededRandom(seed: number): () => number {
  return () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
}

function generateCurve(seed?: number): CurvePoint[] {
  const rng = seededRandom(seed ?? Date.now());
  const points: CurvePoint[] = [];
  let equity = STARTING_CAPITAL;
  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 365);

  for (let d = 0; d < TRADING_DAYS_PER_YEAR; d++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + d);
    const dateStr = date.toISOString().slice(0, 10);

    const tradesToday = Math.floor(rng() * (DAILY_TRADE_CAP + 1));
    let dayPnl = 0;

    for (let t = 0; t < tradesToday; t++) {
      const isWin = rng() < TARGET_WIN_RATE;
      const pnl = isWin
        ? WIN_MIN + rng() * (WIN_MAX - WIN_MIN)
        : LOSS_MIN + rng() * (LOSS_MAX - LOSS_MIN);
      dayPnl += pnl;
    }

    equity = Math.max(0, equity + dayPnl);
    points.push({
      date: dateStr,
      equity: Math.round(equity * 100) / 100,
      trades: tradesToday,
      pnl: Math.round(dayPnl * 100) / 100,
    });
  }

  return points;
}

async function main() {
  const curve = generateCurve(42);
  const outPath = path.join(__dirname, "../../data/historical-equity.json");
  const data = {
    generated_at: new Date().toISOString(),
    start_date: curve[0]?.date ?? "",
    end_date: curve[curve.length - 1]?.date ?? "",
    starting_capital: STARTING_CAPITAL,
    final_equity: curve[curve.length - 1]?.equity ?? STARTING_CAPITAL,
    net_profit: (curve[curve.length - 1]?.equity ?? STARTING_CAPITAL) - STARTING_CAPITAL,
    curve,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2), "utf8");
  console.log("[Historical] Wrote", outPath);
  console.log("[Historical] Period:", data.start_date, "→", data.end_date);
  console.log("[Historical] Net profit:", data.net_profit.toFixed(2));
}

main().catch(console.error);
