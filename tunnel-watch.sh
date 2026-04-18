#!/bin/bash
# Extract the Cloudflare tunnel URL from cloudflared logs and save it.
# Works with both direct cloudflared output and PM2-managed logs.
#
# Usage:
#   ./tunnel-watch.sh          # extract + save URL
#   ./tunnel-watch.sh probe    # extract + verify with curl
#   ./tunnel-watch.sh poll     # continuous monitoring (checks every 10s)

URL_FILE="/tmp/racing-tunnel-url"

find_url() {
    # Check PM2 logs first, then fallback to /tmp
    for LOG in \
        /var/lib/openclaw/.pm2/logs/racing-tunnel-error.log \
        /var/lib/openclaw/.pm2/logs/racing-tunnel-out.log \
        /tmp/cloudflared.log; do
        URL=$(grep -oP 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" 2>/dev/null | tail -1)
        if [ -n "$URL" ]; then
            echo "$URL"
            return 0
        fi
    done
    return 1
}

extract_url() {
    for i in $(seq 1 30); do
        URL=$(find_url)
        if [ -n "$URL" ]; then
            echo "$URL" > "$URL_FILE"
            echo "$URL"
            return 0
        fi
        sleep 0.5
    done
    echo "ERROR: No tunnel URL found" >&2
    return 1
}

probe() {
    URL=$(extract_url)
    if [ -z "$URL" ]; then
        echo "FAIL: no tunnel URL"
        exit 1
    fi
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$URL/practice?perf=low" 2>/dev/null)
    if [ "$HTTP_CODE" = "200" ]; then
        echo "OK: $URL/practice?perf=low (HTTP $HTTP_CODE)"
        exit 0
    else
        echo "FAIL: $URL/practice?perf=low (HTTP $HTTP_CODE)"
        exit 1
    fi
}

poll() {
    echo "Polling tunnel URL every 10s... (Ctrl+C to stop)"
    while true; do
        URL=$(find_url)
        if [ -n "$URL" ]; then
            echo "$URL" > "$URL_FILE"
            HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$URL/practice?perf=low" 2>/dev/null)
            echo "$(date +%H:%M:%S) $URL — practice HTTP $HTTP_CODE"
        else
            echo "$(date +%H:%M:%S) no tunnel URL found"
        fi
        sleep 10
    done
}

case "${1:-}" in
    probe) probe ;;
    poll)  poll ;;
    *)     extract_url ;;
esac
