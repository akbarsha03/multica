# deploy/ptspgt2 — source-run deployment for the fork

These are the operational files for running this fork **from source** on the
**ptspgt2** host (serving https://multica.unlimitpdf.com). For the full
architecture + gotchas, read `CLAUDE.local.md` at the repo root.

## Files

| File | Installed to | Purpose |
|---|---|---|
| `deploy.sh` | `/opt/multica-app/deploy.sh` | one-command deploy: pull → build (backend + version-stamped CLI + frontend) → migrate → restart services |
| `run-backend.sh` | `/opt/multica-app/run-backend.sh` | launches the Go backend on :8080 (env from `/opt/multica/.env`, DB = docker postgres by container IP) |
| `run-frontend.sh` | `/opt/multica-app/run-frontend.sh` | `next start` on 127.0.0.1:3400, proxying /api → :8080 |
| `systemd/multica-backend-src.service` | `/etc/systemd/system/` | backend service |
| `systemd/multica-web-src.service` | `/etc/systemd/system/` | frontend service |
| `systemd/multica-daemon.service` | `/etc/systemd/system/` | agent-runner daemon (IS_SANDBOX=1, HOME=/root) |
| `systemd/no-self-update.conf` | `/etc/systemd/system/multica-daemon.service.d/` | drop-in: `MULTICA_DAEMON_NO_SELF_UPDATE=true` (stops the daemon clobbering the fork binary — see gotcha #1 in CLAUDE.local.md) |

## First-time install (already done on ptspgt2)

```bash
# toolchain
curl -fsSL https://go.dev/dl/go1.26.1.linux-amd64.tar.gz | tar -C /usr/local -xz   # Go
# node 22 + pnpm assumed present

# clone + checkout
git clone https://github.com/akbarsha03/multica.git /opt/multica-app
cd /opt/multica-app && git checkout main

# wrappers + units
install -m755 deploy/ptspgt2/run-backend.sh deploy/ptspgt2/run-frontend.sh deploy/ptspgt2/deploy.sh /opt/multica-app/
cp deploy/ptspgt2/systemd/*.service /etc/systemd/system/
mkdir -p /etc/systemd/system/multica-daemon.service.d/
cp deploy/ptspgt2/systemd/no-self-update.conf /etc/systemd/system/multica-daemon.service.d/
systemctl daemon-reload
systemctl enable --now multica-backend-src multica-web-src multica-daemon
```

## Day-to-day

```bash
/opt/multica-app/deploy.sh                # deploy current main to prod
systemctl status multica-backend-src multica-web-src multica-daemon
journalctl -u multica-backend-src -f
curl -s http://localhost:8080/healthz
```

> NOTE: if you change these files, re-copy them to their installed locations
> (`deploy.sh`/`run-*.sh` → `/opt/multica-app/`, units → `/etc/systemd/system/`,
> then `systemctl daemon-reload`). The repo copy here is the source of truth.
