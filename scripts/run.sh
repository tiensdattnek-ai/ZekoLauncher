#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
#  Zeko Launcher — script khởi động (Linux / macOS)
# ─────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${ZEKO_PORT:-4179}"

if ! command -v node >/dev/null 2>&1; then
  echo "✗ Cần Node.js 18 trở lên. Tải tại https://nodejs.org" >&2
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "✗ Node.js quá cũ (đang có $(node -v)). Cần >= 18." >&2
  exit 1
fi

if [ ! -d node_modules/express ]; then
  echo "→ Cài phụ thuộc lần đầu…"
  npm install --no-audit --no-fund
fi

echo "→ Khởi động Zeko Launcher tại http://localhost:$PORT"
exec node server/index.js
