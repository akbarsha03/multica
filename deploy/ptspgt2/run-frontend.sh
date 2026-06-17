#!/usr/bin/env bash
# Multica web (Next.js), source-run from the fork. Proxies /api + /ws to the
# local source backend on :8080. Serves on 127.0.0.1:3400 (cloudflared routes here).
export REMOTE_API_URL="http://localhost:8080"
export PORT=3400
export HOSTNAME=127.0.0.1
cd /opt/multica-app/apps/web
exec pnpm start
