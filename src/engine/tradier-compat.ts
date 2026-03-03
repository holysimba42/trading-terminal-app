/**
 * HFT Cash v6 – Tradier Production API Compatibility Layer
 *
 * Verifies that every strategy design stays within Tradier's production
 * API constraints: rate limits, supported order types, market data
 * endpoints, and streaming capabilities.
 *
 * Reference: https://documentation.tradier.com/brokerage-api
 */

/* ------------------------------------------------------------------ */
/*  Tradier API Constants (production environment)                     */
/* ------------------------------------------------------------------ */

export const TRADIER_LIMITS = {
  /** Standard requests (accounts, watchlists, users, orders) per minute */
  standardRPM: 120,
  /** Market data requests per minute */
  marketDataRPM: 120,
  /** Trading requests per minute */
  tradingRPM: 60,
  /** WebSocket endpoint */
  wsEndpoint: "wss://ws.tradier.com/v1/",
  /** HTTP stream auto-close after inactivity (minutes) */
  httpStreamTimeout: 15,
  /** Greeks updated by ORATS */
  greeksUpdateFrequency: "hourly",
  /** Max concurrent streams */
  maxStreams: 1, // one market + one account
} as const;

export const TRADIER_ORDER_TYPES = [
  "market",
  "limit",
  "stop",
  "stop_limit",
] as const;

export const TRADIER_ORDER_SIDES = [
  "buy_to_open",
  "sell_to_open",
  "buy_to_close",
  "sell_to_close",
] as const;

export const TRADIER_ADVANCED_ORDERS = [
  "multileg",   // spreads
  "combo",      // stock + option
  "oto",        // One-Triggers-Other
  "oco",        // One-Cancels-Other
  "otoco",      // One-Triggers-One-Cancels-Other
] as const;

export const TRADIER_DURATIONS = ["day", "gtc", "pre", "post"] as const;

export const TRADIER_STREAMING_FILTERS = [
  "trade",
  "quote",
  "summary",
  "timesale",
  "tradex",
] as const;

export const TRADIER_ENDPOINTS = {
  optionsChains: "/v1/markets/options/chains",
  optionsStrikes: "/v1/markets/options/strikes",
  optionsExpirations: "/v1/markets/options/expirations",
  quotes: "/v1/markets/quotes",
  history: "/v1/markets/history",
  timesales: "/v1/markets/timesales",
  clock: "/v1/markets/clock",
  calendar: "/v1/markets/calendar",
  placeOrder: "/v1/accounts/{account_id}/orders",
  placeMultileg: "/v1/accounts/{account_id}/orders",
  createSession: "/v1/markets/events/session",
} as const;

/* ------------------------------------------------------------------ */
/*  Compatibility Check                                                */
/* ------------------------------------------------------------------ */

export interface CompatCheckResult {
  compatible: boolean;
  feature: string;
  detail: string;
  severity: "ok" | "warning" | "error";
}

export interface StrategyRequirements {
  name: string;
  maxTradesPerMinute: number;
  maxQuotesPerMinute: number;
  needsStreaming: boolean;
  needsGreeks: boolean;
  needsMultileg: boolean;
  needsOTO: boolean;
  needsOCO: boolean;
  orderTypes: string[];
  dataUpdateFreqMs: number;
}

export function checkTradierCompatibility(
  req: StrategyRequirements,
): CompatCheckResult[] {
  const results: CompatCheckResult[] = [];

  // Trading rate limit
  if (req.maxTradesPerMinute <= TRADIER_LIMITS.tradingRPM) {
    results.push({
      compatible: true,
      feature: "Trading rate limit",
      detail: `${req.maxTradesPerMinute} req/min ≤ ${TRADIER_LIMITS.tradingRPM} limit`,
      severity: "ok",
    });
  } else {
    results.push({
      compatible: false,
      feature: "Trading rate limit",
      detail: `${req.maxTradesPerMinute} req/min exceeds ${TRADIER_LIMITS.tradingRPM} limit`,
      severity: "error",
    });
  }

  // Market data rate limit
  if (req.maxQuotesPerMinute <= TRADIER_LIMITS.marketDataRPM) {
    results.push({
      compatible: true,
      feature: "Market data rate limit",
      detail: `${req.maxQuotesPerMinute} req/min ≤ ${TRADIER_LIMITS.marketDataRPM} limit`,
      severity: "ok",
    });
  } else if (req.needsStreaming) {
    results.push({
      compatible: true,
      feature: "Market data (streaming)",
      detail: `WebSocket streaming bypasses REST rate limits for continuous data`,
      severity: "ok",
    });
  } else {
    results.push({
      compatible: false,
      feature: "Market data rate limit",
      detail: `${req.maxQuotesPerMinute} req/min exceeds ${TRADIER_LIMITS.marketDataRPM} limit; use streaming`,
      severity: "error",
    });
  }

  // Greeks availability
  if (req.needsGreeks) {
    results.push({
      compatible: true,
      feature: "Greeks data",
      detail: `Available via options chain endpoint (greeks=true param), updated hourly by ORATS`,
      severity: "warning", // hourly may be stale for 0DTE
    });
  }

  // Streaming
  if (req.needsStreaming) {
    results.push({
      compatible: true,
      feature: "WebSocket streaming",
      detail: `${TRADIER_LIMITS.wsEndpoint} — supports quote/trade/timesale filters, symbol updates without reconnect`,
      severity: "ok",
    });
  }

  // Multileg orders
  if (req.needsMultileg) {
    results.push({
      compatible: true,
      feature: "Multileg orders",
      detail: `Tradier supports multileg (spread) orders`,
      severity: "ok",
    });
  }

  // Advanced order types
  if (req.needsOTO) {
    results.push({
      compatible: true,
      feature: "OTO orders",
      detail: `One-Triggers-Other supported for profit target chaining`,
      severity: "ok",
    });
  }
  if (req.needsOCO) {
    results.push({
      compatible: true,
      feature: "OCO orders",
      detail: `One-Cancels-Other supported for stop-loss + take-profit brackets`,
      severity: "ok",
    });
  }

  // Order types
  for (const ot of req.orderTypes) {
    const supported = (TRADIER_ORDER_TYPES as readonly string[]).includes(ot);
    results.push({
      compatible: supported,
      feature: `Order type: ${ot}`,
      detail: supported ? "Supported" : "NOT supported by Tradier",
      severity: supported ? "ok" : "error",
    });
  }

  // Data freshness for 0DTE
  if (req.dataUpdateFreqMs < 1000) {
    results.push({
      compatible: true,
      feature: "Sub-second data",
      detail: `Achievable via WebSocket streaming (real-time trade/quote filters)`,
      severity: req.needsStreaming ? "ok" : "warning",
    });
  }

  return results;
}

/* ------------------------------------------------------------------ */
/*  Strategy-specific requirements                                     */
/* ------------------------------------------------------------------ */

export function getStrategyRequirements(strategyVersion: string): StrategyRequirements {
  const base: StrategyRequirements = {
    name: "",
    maxTradesPerMinute: 2,   // 10 trades/day ≈ 0.03/min peak < 2/min
    maxQuotesPerMinute: 60,  // options chain poll every second
    needsStreaming: true,    // for real-time quotes
    needsGreeks: false,
    needsMultileg: false,
    needsOTO: false,
    needsOCO: false,
    orderTypes: ["limit"],
    dataUpdateFreqMs: 1000,
  };

  switch (strategyVersion) {
    case "v1":
      return { ...base, name: "Baseline Enhanced" };
    case "v2":
      return { ...base, name: "GEX-Regime Aware", needsGreeks: true };
    case "v3":
      return { ...base, name: "Charm-Window", needsGreeks: true };
    case "v4":
      return {
        ...base,
        name: "Theta-Gamma Ratio",
        needsGreeks: true,
        needsOCO: true, // bracket orders for stops
        orderTypes: ["limit", "stop_limit"],
      };
    case "v5":
      return {
        ...base,
        name: "Composite Edge",
        needsGreeks: true,
        needsOCO: true,
        needsOTO: true,
        orderTypes: ["limit", "stop_limit"],
        dataUpdateFreqMs: 500,
      };
    default:
      return base;
  }
}

export function runFullCompatCheck(): {
  strategy: string;
  results: CompatCheckResult[];
  allCompatible: boolean;
}[] {
  const versions = ["v1", "v2", "v3", "v4", "v5"];
  return versions.map(v => {
    const req = getStrategyRequirements(v);
    const results = checkTradierCompatibility(req);
    return {
      strategy: `${req.name} (${v})`,
      results,
      allCompatible: results.every(r => r.severity !== "error"),
    };
  });
}
