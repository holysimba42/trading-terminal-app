/**
 * HFT Cash v6 - Alert Notifications
 * Webhook on MAX_DRAWDOWN / DAILY_CAP.
 */
import https from "https";
import http from "http";

export function fireAlert(alert: string, payload: Record<string, unknown>): void {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return;

  const body = JSON.stringify({
    alert,
    ts: new Date().toISOString(),
    ...payload,
  });

  const parsed = new URL(url);
  const isHttps = parsed.protocol === "https:";
  const req = (isHttps ? https : http).request(
    {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    },
    () => {}
  );
  req.on("error", () => {});
  req.write(body);
  req.end();
}
