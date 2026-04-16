#!/bin/bash
# Start the racing game dev environment: Vite + API server + Cloudflare tunnel
# Usage: ./dev.sh
# Outputs the tunnel URL to stdout and saves it to /tmp/racing-tunnel-url

set -e
cd "$(dirname "$0")"

echo "=== Racing Game Dev Setup ==="

# Kill any existing processes on our ports
kill $(lsof -ti:3000) 2>/dev/null || true
kill $(lsof -ti:3001) 2>/dev/null || true
pkill -f "cloudflared.*3000" 2>/dev/null || true
sleep 1

# Start API server (port 3001)
echo "[1/3] Starting API server on :3001..."
npx tsx src/server/index.ts > /tmp/racing-server.log 2>&1 &
sleep 2
if ! lsof -ti:3001 >/dev/null 2>&1; then
  echo "ERROR: API server failed to start. Check /tmp/racing-server.log"
  exit 1
fi

# Start Vite dev server (port 3000)
echo "[2/3] Starting Vite on :3000..."
npx vite --host 0.0.0.0 --port 3000 --strictPort > /tmp/racing-vite.log 2>&1 &
sleep 4
if ! lsof -ti:3000 >/dev/null 2>&1; then
  echo "ERROR: Vite failed to start. Check /tmp/racing-vite.log"
  exit 1
fi

# Start Cloudflare tunnel
echo "[3/3] Starting Cloudflare tunnel..."
/tmp/cloudflared tunnel --url http://127.0.0.1:3000 > /tmp/cloudflared.log 2>&1 &
sleep 5

# Extract URL
TUNNEL_URL=$(grep -oP 'https://[a-z0-9-]+\.trycloudflare\.com' /tmp/cloudflared.log | tail -1)

if [ -z "$TUNNEL_URL" ]; then
  echo "ERROR: Could not get tunnel URL. Check /tmp/cloudflared.log"
  exit 1
fi

# Save URL
echo "$TUNNEL_URL" > /tmp/racing-tunnel-url

echo ""
echo "=== READY ==="
echo "  Local:    http://localhost:3000"
echo "  API:      http://localhost:3001"
echo "  Tunnel:   $TUNNEL_URL"
echo ""
echo "  Track:    $TUNNEL_URL/track"
echo "  Practice: $TUNNEL_URL/practice"
echo ""
echo "URL saved to /tmp/racing-tunnel-url"
