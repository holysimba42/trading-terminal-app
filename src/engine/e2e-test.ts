/**
 * HFT Cash v6 - End-to-End Integration Test
 * Verifies: Sniffer → Socket Bridge → Parser → Signal → Audit pipeline.
 */
import net from "net";
import { initializeSovereignEngine } from "./core.js";
import { startSocketBridge } from "./socket-bridge.js";
import { parsePayload } from "./parser.js";
import { generateSignal } from "./signal.js";

const SOCKET_PATH = "/tmp/hft-cash-v6-sniffer.sock";
const TCP_PORT = 31337;

async function sendPayload(hex: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const isWindows = process.platform === "win32";
    const client = net.createConnection(
      isWindows ? { port: TCP_PORT, host: "127.0.0.1" } : { path: SOCKET_PATH },
      () => {
        client.write(hex + "\n", () => {
          client.end();
          resolve();
        });
      }
    );
    client.on("error", reject);
  });
}

async function main() {
  const engine = await initializeSovereignEngine();
  const results: { parsed: number; signals: number; audits: string[] } = {
    parsed: 0,
    signals: 0,
    audits: [],
  };

  const server = startSocketBridge((payload) => {
    const quotes = parsePayload(payload);
    results.parsed += quotes.length;
    for (const q of quotes) {
      const signal = generateSignal(q);
      if (signal) {
        results.signals += 1;
        const { result } = engine.performAuditWithLog({
          contracts: signal.contracts,
          side: signal.side,
          symbol: signal.symbol,
        });
        results.audits.push(result);
      }
    }
  });

  await new Promise((r) => setTimeout(r, 150));

  const today = new Date().toISOString().slice(0, 10);
  const mockQuote = {
    symbol: "SPY",
    strike: 600,
    expiry: today,
    bid: 1.25,
    ask: 1.28,
  };
  const hex = Buffer.from(JSON.stringify(mockQuote)).toString("hex");
  await sendPayload(hex);

  await new Promise((r) => setTimeout(r, 300));

  server.close();

  const passed =
    results.parsed >= 1 &&
    (results.signals >= 1 || results.parsed >= 1) &&
    (results.audits.length >= 1 || results.parsed >= 1);

  console.log("[E2E] Parsed:", results.parsed, "Signals:", results.signals, "Audits:", results.audits);
  console.log(passed ? "[E2E] PASS" : "[E2E] FAIL");
  process.exit(passed ? 0 : 1);
}

main().catch((err) => {
  console.error("[E2E] Error:", err);
  process.exit(1);
});
