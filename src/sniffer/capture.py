#!/usr/bin/env python3
"""
HFT Cash v6 - Ghost-Mode Data Acquisition Layer
Molecular Precision Hook: Targets raw TCP payloads for SPY/QQQ 0DTE High Gamma Scalping.
Intercepts options data before Webull UI rendering. Target: <10ms latency.
Configured to isolate Webull data server IP routes via config.json.
"""
import json
import os
import socket
from pathlib import Path

try:
    import scapy.all as scapy
    SCAPY_AVAILABLE = True
except ImportError:
    SCAPY_AVAILABLE = False

CONFIG_PATH = Path(__file__).parent / "config.json"


def load_config() -> dict:
    """Load sniffer config. Falls back to defaults if missing."""
    if CONFIG_PATH.exists():
        with open(CONFIG_PATH) as f:
            return json.load(f)
    return {
        "webull_hosts": ["api.webull.com", "data-api.webull.com", "events-api.webull.com"],
        "fallback_filter": "tcp port 443",
        "target_port": 443,
    }


def resolve_webull_ips(hosts: list[str]) -> list[str]:
    """Resolve Webull hostnames to IPs for BPF filter isolation."""
    ips = set()
    for host in hosts:
        try:
            result = socket.getaddrinfo(host, None, socket.AF_INET)
            for _, _, _, _, (ip, _) in result:
                ips.add(ip)
        except (socket.gaierror, OSError):
            pass
    return list(ips)


def build_bpf_filter(ips: list[str], ports: list[int], fallback: str) -> str:
    """Build BPF filter isolating Webull data server routes."""
    if not ips:
        return fallback
    port_clauses = " or ".join(f"tcp port {p}" for p in ports)
    host_clauses = " or ".join(f"host {ip}" for ip in ips)
    return f"({port_clauses}) and ({host_clauses})"


def forward_to_engine(payload: bytes, config: dict) -> None:
    """Forward hex payload to Node.js engine via internal socket."""
    bridge = config.get("socket_bridge", {})
    if os.name == "nt":
        addr = bridge.get("tcp_fallback", ["127.0.0.1", 31337])
        host, port = addr[0], addr[1]
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.connect((host, port))
            sock.sendall(payload.hex().encode() + b"\n")
            sock.close()
        except (ConnectionRefusedError, OSError):
            pass
    else:
        path = bridge.get("unix_path", "/tmp/hft-cash-v6-sniffer.sock")
        try:
            sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            sock.connect(path)
            sock.sendall(payload.hex().encode() + b"\n")
            sock.close()
        except (ConnectionRefusedError, FileNotFoundError, OSError):
            pass


def process_packet(packet, config: dict) -> None:
    """Extract raw TCP payload and forward to Node.js engine."""
    if packet.haslayer(scapy.Raw):
        payload = bytes(packet[scapy.Raw].load)
        if len(payload) > 0:
            forward_to_engine(payload, config)


def main() -> None:
    import sys
    dry_run = "--dry-run" in sys.argv

    if not SCAPY_AVAILABLE:
        print("ERROR: scapy not installed. Run: pip install -r requirements.txt")
        print("On Windows: Install Npcap for packet capture (https://npcap.com)")
        return

    config = load_config()
    hosts = config.get("webull_hosts", [])
    ports = config.get("target_ports") or [config.get("target_port", 443)]
    if isinstance(ports, int):
        ports = [ports]
    fallback = config.get("fallback_filter", "tcp port 443 or tcp port 8883")

    ips = resolve_webull_ips(hosts)
    bpf = build_bpf_filter(ips, ports, fallback)

    if ips:
        print(f"Webull IPs isolated: {', '.join(ips)}")
        print(f"BPF filter: {bpf}")
    else:
        print(f"Could not resolve Webull hosts. Using fallback: {bpf}")

    if dry_run:
        print("Dry-run: config validated. Run without --dry-run to capture (requires root/Npcap).")
        return

    iface = config.get("interface")
    kwargs = {"filter": bpf, "prn": lambda p: process_packet(p, config), "store": False}
    if iface:
        kwargs["iface"] = iface

    scapy.sniff(**kwargs)


if __name__ == "__main__":
    main()
