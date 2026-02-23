# HFT Cash v6 - Webull Protocol Reference

## Data Sources

| Source | Protocol | Port | Notes |
|--------|----------|------|-------|
| api.webull.com | HTTPS/JSON | 443 | REST API |
| data-api.webull.com | MQTT+TLS | 8883 | Real-time quotes |
| events-api.webull.com | MQTT+TLS | 8883 | Order events |
| usquotes-api.webullfintech.com | MQTT+TLS | 8883 | MQTT market data |

## MQTT + Protobuf (Market Data)

Webull uses MQTTv3.1.1 with Protocol Buffers for streaming.

- **Topic format:** `instrument_id-data_type_code-interval` (e.g. `913256135-1-1000`)
- **Data types:** QUOTE(0), SNAPSHOT(1), TICK(2)
- **Server:** usquotes-api.webullfintech.com:8883
- **Sniffer:** `src/sniffer/config.json` includes all hosts; target_ports: [443, 8883]

## JSON Field Mappings (REST)

| Field | Aliases | Type |
|-------|---------|------|
| symbol | ticker, name | string |
| bid | bidPrice | number |
| ask | askPrice | number |
| strike | strikePrice | number |
| expiry | expiration, exp | string (YYYY-MM-DD) |

## Parsing Strategy

1. **UTF-8 JSON** – Try full parse first (decrypted proxy, mock).
2. **JSON fragments** – Extract `{...}` from mixed payloads.
3. **Protobuf** – Binary; requires .proto schema for full decode.

## Raw Capture

Set `CAPTURE_RAW=1` to log unparseable payloads to `data/raw-capture/` for debugging.
