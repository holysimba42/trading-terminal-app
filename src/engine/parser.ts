/**
 * HFT Cash v6 - Data Parser
 * Parses raw payloads from sniffer into structured SPY/QQQ 0DTE options data.
 * Webull uses MQTT+protobuf; we also handle JSON/NDJSON for decrypted or mock data.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
const WEBULL_FIELD_MAP: Record<string, string[]> = {
  symbol: ["symbol", "ticker", "name", "tickerId"],
  bid: ["bid", "bidPrice", "b"],
  ask: ["ask", "askPrice", "a"],
  strike: ["strike", "strikePrice", "strikePrice", "k"],
  expiry: ["expiry", "expiration", "exp", "expireDate"],
};

function tryParseJson(buf: Buffer): unknown | null {
  try {
    const str = buf.toString("utf8");
    return JSON.parse(str);
  } catch {
    return null;
  }
}

function extractNumeric(obj: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && !Number.isNaN(v)) return v;
    if (typeof v === "string") {
      const n = parseFloat(v);
      if (!Number.isNaN(n)) return n;
    }
  }
  return undefined;
}

function extractOptionsFromObject(obj: unknown): OptionsQuote | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;

  const symbol = (o.symbol ?? o.ticker ?? o.name ?? "") as string;
  if (!SPY_QQQ_PATTERN.test(symbol)) return null;

  const bid = extractNumeric(o, WEBULL_FIELD_MAP.bid);
  const ask = extractNumeric(o, WEBULL_FIELD_MAP.ask);
  const strike = extractNumeric(o, WEBULL_FIELD_MAP.strike);
  const expiry = (o.expiry ?? o.expiration ?? o.exp ?? "") as string;

  if (bid == null && ask == null) return null;

  const mid = bid != null && ask != null ? (bid + ask) / 2 : (bid ?? ask ?? 0);
  const timestamp = extractNumeric(o, ["timestamp", "time"]) ?? Date.now();

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

function isLikelyProtobuf(buf: Buffer): boolean {
  if (buf.length < 4) return false;
  return buf.some((b) => b > 127);
}

function captureRaw(payload: Buffer): void {
  if (process.env.CAPTURE_RAW !== "1") return;
  try {
    const dir = path.join(__dirname, "../../data/raw-capture");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `raw-${Date.now()}.bin`), payload);
  } catch {
    // ignore
  }
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

  if (results.length === 0 && (isLikelyProtobuf(payload) || payload.length > 20)) {
    captureRaw(payload);
  }

  return results;
}
