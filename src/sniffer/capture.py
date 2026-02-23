#!/usr/bin/env python3
"""
HFT Cash v6 - Ghost-Mode Data Acquisition Layer
Molecular Precision Hook: Targets raw TCP payloads for SPY/QQQ 0DTE High Gamma Scalping.
Intercepts options data before Webull UI rendering. Target: <10ms latency.
"""
import socket
import struct
import os

try:
    import scapy.all as scapy
    SCAPY_AVAILABLE = True
except ImportError:
    SCAPY_AVAILABLE = False

# Unix/Windows Domain Socket path for Node.js engine bridge
SOCKET_PATH = "/tmp/hft-cash-v6-sniffer.sock" if os.name != "nt" else r"\\.\pipe\hft-cash-v6-sniffer"


def forward_to_engine(payload: bytes) -> None:
    """Forward hex payload to Node.js engine via internal socket."""
    try:
        if os.name == "nt":
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.connect(("127.0.0.1", 31337))  # Windows: use TCP fallback
        else:
            sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            sock.connect(SOCKET_PATH)
        sock.sendall(payload.hex().encode() + b"\n")
        sock.close()
    except (ConnectionRefusedError, FileNotFoundError, OSError):
        pass  # Engine not listening; drop packet


def process_packet(packet) -> None:
    """Extract raw TCP payload and forward to Node.js engine."""
    if packet.haslayer(scapy.Raw):
        payload = bytes(packet[scapy.Raw].load)
        if len(payload) > 0:
            forward_to_engine(payload)


def main() -> None:
    if not SCAPY_AVAILABLE:
        print("ERROR: scapy not installed. Run: pip install -r requirements.txt")
        return
    # Target Webull data stream (HTTPS)
    scapy.sniff(filter="tcp port 443", prn=process_packet, store=False)


if __name__ == "__main__":
    main()
