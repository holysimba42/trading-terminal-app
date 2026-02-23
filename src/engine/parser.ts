/**
 * HFT Cash v6 - Data Parser
 * Parses raw payloads from sniffer into structured SPY/QQQ 0DTE options data.
 * Webull uses MQTT+protobuf; we also handle JSON/NDJSON for decrypted or mock data.
 */
export interface OptionsQuote {
  symbol: string;
  strike: number;
  expiry: string;
  bid: number;
  ask: number;
  mid?: number;
  timestamp?: number;
}

const SPY_QQQ_PATTERN = /(?:SPY|QQQ)/i;
const NUMERIC_FIELDS = ["bid", "ask", "strike", "close", "last", "volume"];

function tryParseJson(buf: Buffer): unknown | null {
  try {
    const str = buf.toString("utf8");
    return JSON.parse(str);
  } catch {
    return null;
  }
}

function extractNumeric(obj: Record<string, unknown>, key: string): number | undefined {
  const v = obj[key];
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isNaN(n) ? undefined : n;
  }
  return undefined;
}

function extractOptionsFromObject(obj: unknown): OptionsQuote | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;

  const symbol = (o.symbol ?? o.ticker ?? o.name ?? "") as string;
  if (!SPY_QQQ_PATTERN.test(symbol)) return null;

  const bid = extractNumeric(o, "bid") ?? extractNumeric(o, "bidPrice");
  const ask = extractNumeric(o, "ask") ?? extractNumeric(o, "askPrice");
  const strike = extractNumeric(o, "strike") ?? extractNumeric(o, "strikePrice");
  const expiry = (o.expiry ?? o.expiration ?? o.exp ?? "") as string;

  if (bid == null && ask == null) return null;

  const mid = bid != null && ask != null ? (bid + ask) / 2 : (bid ?? ask ?? 0);
  const timestamp = extractNumeric(o, "timestamp") ?? extractNumeric(o, "time") ?? Date.now();

  return {
    symbol: symbol.toUpperCase().startsWith("SPY") ? "SPY" : "QQQ",
    strike: strike ?? 0,
    expiry: String(expiry),
    bid: bid ?? mid,
    ask: ask ?? mid,
    mid,
    timestamp,
  };
}

function extractJsonFragments(buf: Buffer): unknown[] {
  const str = buf.toString("utf8");
  const results: unknown[] = [];
  const jsonLike = /\{[^{}]*\}/g;
  let m;
  while ((m = jsonLike.exec(str)) !== null) {
    try {
      results.push(JSON.parse(m[0]));
    } catch {
      // skip invalid
    }
  }
  return results;
}

/**
 * Parse raw payload into OptionsQuote(s). Returns empty array if unparseable.
 */
export function parsePayload(payload: Buffer): OptionsQuote[] {
  const results: OptionsQuote[] = [];

  const parsed = tryParseJson(payload);
  if (parsed) {
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        const q = extractOptionsFromObject(item);
        if (q) results.push(q);
      }
    } else {
      const q = extractOptionsFromObject(parsed);
      if (q) results.push(q);
    }
  }

  if (results.length === 0) {
    for (const obj of extractJsonFragments(payload)) {
      const q = extractOptionsFromObject(obj);
      if (q) results.push(q);
    }
  }

  return results;
}
