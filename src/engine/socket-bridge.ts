/**
 * HFT Cash v6 - Socket Bridge
 * Receives hex payloads from Python sniffer via Unix socket (Linux) or TCP (Windows).
 * Forwards raw Buffer to parser/signal layer.
 */
import net from "net";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SOCKET_PATH = "/tmp/hft-cash-v6-sniffer.sock";
const TCP_PORT = 31337;
const TCP_HOST = "127.0.0.1";

export type PayloadCallback = (payload: Buffer) => void;

function parseHexLine(line: string): Buffer | null {
  const trimmed = line.trim();
  if (!trimmed || !/^[0-9a-fA-F]+$/.test(trimmed)) return null;
  try {
    return Buffer.from(trimmed, "hex");
  } catch {
    return null;
  }
}

export function startSocketBridge(onPayload: PayloadCallback): net.Server {
  const isWindows = process.platform === "win32";
  const server = net.createServer((socket) => {
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const payload = parseHexLine(line);
        if (payload && payload.length > 0) {
          onPayload(payload);
        }
      }
    });
  });

  if (isWindows) {
    server.listen(TCP_PORT, TCP_HOST, () => {
      console.log(`[SocketBridge] Listening on ${TCP_HOST}:${TCP_PORT} (TCP)`);
    });
  } else {
    try {
      fs.unlinkSync(SOCKET_PATH);
    } catch {
      // ignore if not exists
    }
    server.listen(SOCKET_PATH, () => {
      console.log(`[SocketBridge] Listening on ${SOCKET_PATH} (Unix)`);
    });
  }

  return server;
}
