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

# C++ kernel: Windows-only for Webull HWND. Skip on Unix.
if [ "$(uname -s)" = "Linux" ] || [ "$(uname -s)" = "Darwin" ]; then
  echo "Skipping C++ kernel rebuild (Windows-only for Webull Ghost-Mode)."
else
  cd src/kernel
  if [ -f binding.gyp ]; then
    node-gyp configure build
    echo "C++ kernel module built."
  fi
  cd "$PROJECT_ROOT"
fi

echo "Initialize-Project complete."
