/**
 * HFT Cash v6 - Signal Generation
 * Strategy logic for SPY/QQQ 0DTE High Gamma Scalping.
 */
import type { OptionsQuote } from "./parser.js";

export interface TradeSignal {
  side: "BUY" | "SELL";
  contracts: number;
  symbol: string;
  strike: number;
  expiry: string;
}

const MAX_SPREAD_CENTS = 5; // $0.05 friction spread
const MIN_MID_CENTS = 10;   // Avoid penny options noise
const MAX_CONTRACTS = 100;

function is0DTE(expiry: string): boolean {
  if (!expiry) return false;
  const d = new Date(expiry);
  if (Number.isNaN(d.getTime())) return false;
  const today = new Date();
  return d.toDateString() === today.toDateString();
}

function spreadCents(quote: OptionsQuote): number {
  return Math.round((quote.ask - quote.bid) * 100);
}

/**
 * Generate trade signal from options quote. Returns null if no signal.
 */
export function generateSignal(quote: OptionsQuote): TradeSignal | null {
  if (!is0DTE(quote.expiry)) return null;

  const spread = spreadCents(quote);
  if (spread > MAX_SPREAD_CENTS) return null;

  const mid = quote.mid ?? (quote.bid + quote.ask) / 2;
  const midCents = Math.round(mid * 100);
  if (midCents < MIN_MID_CENTS) return null;

  // Simple momentum: bid > ask pressure implies BUY (simplified)
  const side: "BUY" | "SELL" = quote.bid >= quote.ask ? "BUY" : "SELL";
  const contracts = Math.min(1, MAX_CONTRACTS);

  return {
    side,
    contracts,
    symbol: quote.symbol,
    strike: quote.strike,
    expiry: quote.expiry,
  };
}
