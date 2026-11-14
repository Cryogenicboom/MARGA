#!/usr/bin/env sh
# Start MARGA on macOS / Linux: installs the frontend packages on first run, then opens the app.
#   ./start.sh
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js is not installed. Install Node.js 22 LTS or newer from https://nodejs.org"
  echo "(or with your package manager, e.g. 'brew install node'), then run ./start.sh again."
  exit 1
fi

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "Node.js $(node --version) is too old. MARGA needs Node.js 18 or newer (22 LTS recommended)."
  exit 1
fi

if [ ! -d frontend/node_modules ]; then
  echo "Installing frontend packages - first run only, this takes about a minute..."
  npm --prefix frontend install --no-fund --no-audit
fi

echo ""
echo " Starting MARGA. Your browser will open automatically (usually http://localhost:3000)."
echo " Press Ctrl+C to stop."
echo ""
exec npm --prefix frontend run dev
