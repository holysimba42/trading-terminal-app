#!/bin/bash
# HFT Cash v6 - Initialize-Project (Linux/macOS)
# Scaffolds stack, builds TypeScript. C++ kernel requires Windows for Webull Ghost-Mode.

set -e
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

echo "=== HFT Cash v6 - Initialize-Project ==="

# Ensure directories exist
mkdir -p src/engine src/kernel src/sniffer data

# npm install
if [ -f package.json ]; then
  npm install
fi

# Build TypeScript
if [ -f tsconfig.json ]; then
  npm run build
fi

# C++ kernel: Build on all platforms (Linux: stub; Windows: full Ghost-Mode)
if [ -f package.json ]; then
  npm run rebuild 2>/dev/null || echo "Note: npm run rebuild failed (node-gyp may need build tools)"
fi

echo "Initialize-Project complete."
