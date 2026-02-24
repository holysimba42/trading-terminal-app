/**
 * HFT Cash v6 - Payload Injection
 * Sends a hex payload to the socket bridge (same path as sniffer data).
 * Used to prove the pipeline: bridge → parser → signal → audit → execution.
 */
import net from "net";

const SOCKET_PATH = "/tmp/hft-cash-v6-sniffer.sock";
const TCP_PORT = 31337;
const TCP_HOST = "127.0.0.1";

/**
 * Build a test payload that passes parser + signal filters.
 * Format matches what the sniffer would send (hex-encoded JSON).
 */
export function buildTestPayload(): Buffer {
  const today = new Date().toISOString().slice(0, 10);
  const payload = {
    symbol: "SPY",
    strike: 600,
    expiry: today,
    bid: 1.25,
    ask: 1.30,
  };
  const json = JSON.stringify(payload);
  return Buffer.from(json, "utf8");
}

/**
 * Inject payload into the socket bridge. Same path as sniffer → orchestrator.
 * Returns true if sent successfully.
 */
export function injectPayload(payload: Buffer): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const hex = payload.toString("hex") + "\n";
    const isWindows = process.platform === "win32";
    const client = isWindows
      ? net.connect(TCP_PORT, TCP_HOST, () => {
          client.write(hex, () => {
            client.end();
            resolve({ ok: true });
          });
        })
      : net.connect(SOCKET_PATH, () => {
          client.write(hex, () => {
            client.end();
            resolve({ ok: true });
          });
        });

    client.on("error", (err) => {
      resolve({ ok: false, error: err.message });
    });
  });
}
