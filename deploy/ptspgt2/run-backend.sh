#!/usr/bin/env bash
# Multica backend, source-run from the fork. DB = the still-running docker
# postgres (IP resolved dynamically so a postgres restart can't strand us).
set -a
source /opt/multica/.env
set +a
PG_IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' multica-postgres-1 2>/dev/null)
PG_IP=${PG_IP:-172.28.0.2}
export DATABASE_URL="postgres://${POSTGRES_USER:-multica}:${POSTGRES_PASSWORD:-multica}@${PG_IP}:5432/${POSTGRES_DB:-multica}?sslmode=disable"
export PORT=8080
exec /opt/multica-app/server/multica-server
