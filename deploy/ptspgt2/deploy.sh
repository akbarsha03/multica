#!/usr/bin/env bash
# One-command deploy for the source-run fork on ptspgt2.
# Usage: ssh root@ptspgt2 /opt/multica-app/deploy.sh
# NOTE: restarts the daemon too (picks up agent-brief / CLI changes) — this
# interrupts any agent task mid-run. Deploy when the queue is quiet.
set -e
cd /opt/multica-app
export PATH=/usr/local/go/bin:$PATH

# Stamp this so the daemon reports a real version (NOT "dev"), otherwise the UI
# flags the CLI as outdated and an "Update" click would try to self-replace the
# fork binary. Bump when rebasing onto a newer upstream.
VERSION="0.3.24"
DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
LDFLAGS="-X main.version=${VERSION} -X main.commit=${COMMIT} -X main.date=${DATE}"

echo "[deploy] git pull"
git pull --ff-only
COMMIT="$(git rev-parse --short HEAD)"

echo "[deploy] build backend"
(cd server && go build -o multica-server ./cmd/server)

echo "[deploy] build + install CLI/daemon binary (version-stamped) -> /usr/local/bin/multica"
(cd server && go build -ldflags "${LDFLAGS}" -o /tmp/multica-new ./cmd/multica)
cp -a /usr/local/bin/multica "/usr/local/bin/multica.bak.$(date +%s)"
install /tmp/multica-new /usr/local/bin/multica

echo "[deploy] install + build frontend"
pnpm install --frozen-lockfile
NEXT_PUBLIC_APP_VERSION=wiki pnpm --filter @multica/web build

echo "[deploy] run migrations"
(cd server
 set -a; source /opt/multica/.env; set +a
 PG_IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' multica-postgres-1)
 export DATABASE_URL="postgres://${POSTGRES_USER:-multica}:${POSTGRES_PASSWORD:-multica}@${PG_IP}:5432/${POSTGRES_DB:-multica}?sslmode=disable"
 go run ./cmd/migrate up)

echo "[deploy] restart services (backend + web + daemon)"
# The daemon refuses server-driven self-update via MULTICA_DAEMON_NO_SELF_UPDATE=true
# (systemd drop-in: /etc/systemd/system/multica-daemon.service.d/no-self-update.conf).
systemctl restart multica-backend-src multica-web-src multica-daemon
sleep 6
curl -s -o /dev/null -w "[deploy] backend healthz: %{http_code}\n" http://localhost:8080/healthz
echo "[deploy] daemon: $(/usr/local/bin/multica --version | head -1)"
echo "[deploy] done"
