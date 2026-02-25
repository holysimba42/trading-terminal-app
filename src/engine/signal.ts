/**
 * HFT Cash v6 - Signal Generation
 * Strategy logic for SPY/QQQ 0DTE High Gamma Scalping.
 */
import type { OptionsQuote } from "./parser.js";
import { getSignalConfig } from "./signal-config.js";

export interface TradeSignal {
  side: "BUY" | "SELL";
  contracts: number;
  symbol: string;
  strike: number;
  expiry: string;
}

export interface OptionsQuoteExtended extends OptionsQuote {
  volume?: number;
}

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
export function generateSignal(quote: OptionsQuote | OptionsQuoteExtended): TradeSignal | null {
  const cfg = getSignalConfig();
  if (!is0DTE(quote.expiry)) return null;

  const spread = spreadCents(quote);
  if (spread > cfg.maxSpreadCents) return null;

  const mid = quote.mid ?? (quote.bid + quote.ask) / 2;
  const midCents = Math.round(mid * 100);
  if (midCents < cfg.minMidCents) return null;

  const ext = quote as OptionsQuoteExtended;
  if (ext.volume != null && ext.volume < cfg.minVolume) return null;

  const side: "BUY" | "SELL" = quote.bid >= quote.ask ? "BUY" : "SELL";
  const contracts = Math.min(Math.max(1, Math.floor(mid * 100 * cfg.positionSizePct)), cfg.maxContracts);

  return {
    side,
    contracts,
    symbol: quote.symbol,
    strike: quote.strike,
    expiry: quote.expiry,
  };
}
