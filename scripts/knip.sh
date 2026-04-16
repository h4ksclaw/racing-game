#!/bin/bash
# Run knip with vite configs temporarily excluded (they use import.meta)
# knip v4 can't parse vite config files
cd "$(dirname "$0")/.."

# Temporarily hide vite configs
mkdir -p /tmp/knip-stash
for f in vite.config.ts ; do
  [ -f "$f" ] && mv "$f" /tmp/knip-stash/
done

npx knip --no-exit-code
EXIT=$?

# Restore vite configs
for f in vite.config.ts ; do
  [ -f "/tmp/knip-stash/$f" ] && mv "/tmp/knip-stash/$f" .
done
rmdir /tmp/knip-stash 2>/dev/null || true

exit $EXIT
