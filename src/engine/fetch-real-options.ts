/**
 * HFT Cash v6 - Real Market Data Fetcher
 * Fetches SPY/QQQ 0DTE options from Yahoo Finance for operational tests.
 */
import YahooFinance from "yahoo-finance2";
import type { OptionsQuote } from "./parser.js";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
const MAX_SPREAD_CENTS = 5;
const MIN_MID_CENTS = 10;

function is0DTE(exp: Date): boolean {
  const today = new Date();
  return exp.toDateString() === today.toDateString();
}

function formatExpiry(d: Date): string {
  return d.toISOString().slice(0, 10);
}

interface OptionExp {
  expirationDate: Date | string;
  calls?: { strike?: number; bid?: number; ask?: number; lastPrice?: number }[];
  puts?: { strike?: number; bid?: number; ask?: number; lastPrice?: number }[];
}

/**
 * Fetch a real 0DTE SPY or QQQ option quote from Yahoo Finance.
 * Prefers 0DTE; falls back to nearest expiry if none (e.g. outside market hours).
 */
export async function fetchReal0DTEQuote(
  symbol: "SPY" | "QQQ"
): Promise<{ payload: Buffer; quote: OptionsQuote; source: string } | null> {
  const data = (await yf.options(symbol)) as { options?: OptionExp[] };
  const opts = (data.options || []).slice();
  opts.sort((a: OptionExp, b: OptionExp) => {
    const da = a.expirationDate instanceof Date ? a.expirationDate : new Date(a.expirationDate);
    const db = b.expirationDate instanceof Date ? b.expirationDate : new Date(b.expirationDate);
    return da.getTime() - db.getTime();
  });

  for (const opt of opts) {
    const exp = opt.expirationDate instanceof Date ? opt.expirationDate : new Date(opt.expirationDate);
    const use0DTE = is0DTE(exp);

    const all = [...(opt.calls || []), ...(opt.puts || [])];
    for (const o of all) {
      const bid = o.bid ?? o.lastPrice;
      const ask = o.ask ?? o.lastPrice;
      if (bid == null && ask == null) continue;

      const b = typeof bid === "number" ? bid : parseFloat(String(bid));
      const a = typeof ask === "number" ? ask : parseFloat(String(ask));
      if (Number.isNaN(b) || Number.isNaN(a)) continue;

      const mid = (b + a) / 2;
      const spreadCents = Math.round((a - b) * 100);
      const midCents = Math.round(mid * 100);

      if (spreadCents > MAX_SPREAD_CENTS || midCents < MIN_MID_CENTS) continue;

      const quote: OptionsQuote = {
        symbol,
        strike: o.strike ?? 0,
        expiry: formatExpiry(exp),
        bid: b,
        ask: a,
        mid,
      };

      const payload = {
        symbol,
        strike: o.strike,
        expiry: formatExpiry(exp),
        bid: b,
        ask: a,
      };
      const json = JSON.stringify(payload);
      const buf = Buffer.from(json, "utf8");

      return {
        payload: buf,
        quote,
        source: `Yahoo ${symbol} ${o.strike} ${formatExpiry(exp)}${use0DTE ? " (0DTE)" : ""}`,
      };
    }
  }

  return null;
}

/** Try SPY first, then QQQ. */
export async function fetchRealQuote(): Promise<{
  payload: Buffer;
  quote: OptionsQuote;
  source: string;
} | null> {
  const spy = await fetchReal0DTEQuote("SPY");
  if (spy) return spy;
  return fetchReal0DTEQuote("QQQ");
}
