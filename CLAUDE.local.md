# CLAUDE.local.md — fork + deployment context

> Loads automatically alongside the upstream `CLAUDE.md` (which documents the
> codebase). THIS file is the **fork + production-deployment** context for
> `github.com/akbarsha03/multica` running on the **ptspgt2** server. Read it
> before building, running, or deploying.

## What this is

This is a **fork** of multica that adds a **per-workspace wiki** and runs
**from source** (NOT prebuilt images) on the **ptspgt2** Tailscale host,
serving the live site **https://multica.unlimitpdf.com**.

- Repo: `origin` = `github.com/akbarsha03/multica`. Default branch: **`main`**.
- Server working copy / build root: **`/opt/multica-app`** (this directory on ptspgt2).
- The custom feature lives under the `wiki` paths (see "Wiki feature" below).

## Toolchain (already installed on ptspgt2)

- Go **1.26.1** at `/usr/local/go/bin` (add to PATH: `export PATH=/usr/local/go/bin:$PATH`)
- Node **22**, pnpm **10** at `/usr/bin`
- `claude` at `/root/.local/bin/claude`, logged in as **founders@grovio.ai** (Max)

## Runtime architecture (source-run via systemd)

| Service (systemd) | What it runs | Port | Notes |
|---|---|---|---|
| `multica-backend-src` | `deploy/ptspgt2/run-backend.sh` → Go binary `server/multica-server` | `:8080` | env from `/opt/multica/.env`; `DATABASE_URL` → the docker postgres by **container IP** (resolved at start) |
| `multica-web-src` | `run-frontend.sh` → `next start` | `127.0.0.1:3400` | `REMOTE_API_URL=http://localhost:8080` |
| `multica-daemon` | `/usr/local/bin/multica daemon start --foreground` | — | runs the AI agents (claude/copilot/antigravity); `IS_SANDBOX=1`, `HOME=/root`, `MULTICA_DAEMON_NO_SELF_UPDATE=true` |
| docker `multica-postgres-1` | Postgres 17 (pgvector) | container `:5432` | the ONLY docker container kept running |

`cloudflared` (host) routes `multica.unlimitpdf.com` → `:3400` (frontend) and
`/ws` → `:8080` (backend). The original dockerized `multica-backend-1` /
`multica-frontend-1` containers are **stopped** (used only for rollback).

Ops files live in **`deploy/ptspgt2/`** (this repo); installed copies live at
`/opt/multica-app/{deploy,run-backend,run-frontend}.sh` and
`/etc/systemd/system/multica-{backend-src,web-src,daemon}.service` (+ the
`multica-daemon.service.d/no-self-update.conf` drop-in). See
`deploy/ptspgt2/README.md`.

## Build

From `server/` (Go) or repo root (frontend), with `PATH` including Go:

```bash
# backend
(cd server && go build -o multica-server ./cmd/server)

# CLI + daemon binary — MUST version-stamp (see gotcha #1)
(cd server && go build -ldflags "-X main.version=0.3.23 -X main.commit=$(git rev-parse --short HEAD) -X main.date=$(date -u +%Y-%m-%dT%H:%M:%SZ)" -o /usr/local/bin/multica ./cmd/multica)

# frontend
pnpm install --frozen-lockfile
NEXT_PUBLIC_APP_VERSION=wiki pnpm --filter @multica/web build

# migrations (DATABASE_URL points at the docker postgres)
(cd server && DATABASE_URL="postgres://multica:<pw>@<pg-container-ip>:5432/multica?sslmode=disable" go run ./cmd/migrate up)
```

## Deploy (one command — ships to LIVE prod)

```bash
/opt/multica-app/deploy.sh      # = deploy/ptspgt2/deploy.sh
```

It does: `git pull --ff-only` → build backend + version-stamped CLI → build
frontend → run migrations → `systemctl restart multica-backend-src
multica-web-src multica-daemon`. **It builds from the current working tree and
restarts prod** — so:
- **Don't run it mid-edit.** Commit (or stash) to a clean state first; a
  half-finished file becomes a broken prod build.
- It **interrupts running agent tasks** (daemon restart). Deploy when the
  queue is quiet (`select count(*) from agent_task_queue where status='running'`).

Manage / inspect:
```bash
systemctl status|restart multica-backend-src multica-web-src multica-daemon
journalctl -u multica-backend-src -f        # backend logs
curl -s http://localhost:8080/healthz       # {db:ok, migrations:ok}
```

## CRITICAL gotchas (these have bitten us)

1. **The daemon self-updates → it will WIPE the fork.** The multica server can
   tell the daemon to "update the CLI" (UI Runtimes/Agents "Update" button, or
   on a version mismatch). The daemon then downloads the **official** release
   and overwrites `/usr/local/bin/multica` — erasing the fork's `multica wiki`
   command + the agent's wiki brief. Two defenses, **both required**:
   - **Version-stamp** every CLI build (`-ldflags "-X main.version=0.3.23 …"`,
     which `deploy.sh` does) so the UI sees it as current → no "outdated" warning.
     **Never `go build ./cmd/multica` without the ldflags.**
   - `MULTICA_DAEMON_NO_SELF_UPDATE=true` (systemd drop-in) → `handleUpdate`
     (`server/internal/daemon/daemon.go`) and the auto-update poller
     (`auto_update.go`) **refuse**. Don't expect the UI "Update" button to work —
     it returns `failed: "CLI self-update is disabled"` by design.
2. **Sync the fork to prod's upstream version before deploying.** This fork is
   rebased onto upstream `main` (currently **0.3.23**, DB migration **119**).
   Running an older fork against a newer DB collides migration numbers and
   downgrades prod. When rebasing onto a newer upstream: bump `VERSION` in
   `deploy.sh`, and renumber any new migration to come **after** upstream's latest.
   The wiki migration is `server/migrations/120_wiki.up.sql`.
3. **Postgres lives in docker** (`multica-postgres-1`). The source backend
   reaches it by container IP (resolved dynamically in `run-backend.sh`). Don't
   stop/recreate postgres without updating; restore from `/opt/multica/backups/`.
4. **Don't commit `server/multica-server`** (the built binary; gitignored).
5. **Coordinate the working tree.** Both this server (`/opt/multica-app`) and a
   Mac clone push `origin`. `git pull` before editing to avoid divergence, or
   develop in one place only.

## Rollback to stock images (if a deploy breaks prod)

```bash
systemctl disable --now multica-backend-src multica-web-src
docker start multica-backend-1 multica-frontend-1     # back to v0.3.21 images, ~30s
# DB only if a migration must be undone:
#   docker exec -i multica-postgres-1 pg_restore -U multica -d multica --clean < /opt/multica/backups/multica-prefork-*.dump
```

## Wiki feature (the fork's custom addition)

Per-workspace, **human + agent collaborative** wiki. Humans CRUD pages; agents
**create new pages live** but **propose** edits to existing pages (PR-style →
human approves). Markdown (GFM + KaTeX) + **mermaid** rendering; master-detail
UI; live updates via the `wiki_changed` WS event.

**Backend:** `server/migrations/120_wiki.up.sql` (tables `wiki_page`,
`wiki_revision`), `server/pkg/db/queries/wiki.sql`,
`server/internal/handler/wiki.go` (REST API + the `wiki_changed` publish +
`GetWikiPageBySlug`), `server/cmd/multica/cmd_wiki.go` (the `multica wiki page
list/get/create/propose` CLI agents use), `server/internal/daemon/execenv/runtime_config.go`
(the `## Wiki` section injected into the agent brief). Agents propose-only on
existing pages is enforced by `handler.RequireHumanActor` in
`server/cmd/server/router.go`.

**Frontend:** `packages/core/types/wiki.ts`, `packages/core/wiki/{queries,mutations,ws-updaters}.ts`,
wiki methods/schemas in `packages/core/api/{client,schemas}.ts`, the
`wiki_changed` case in `packages/core/realtime/use-realtime-sync.ts`,
`packages/views/wiki/components/` (`wiki-shell` = persistent tree layout,
`wiki-sidebar`, `wiki-detail` = view/edit toggle, `wiki-tree`, `wiki-diff`,
`wiki-review-dialog`, `wiki-empty-state`), and the routes under
`apps/web/app/[workspaceSlug]/(dashboard)/wiki/` (`layout.tsx`, `page.tsx`, `[id]/page.tsx`).

**Self-update guard** (so the wiki CLI survives): `selfUpdateDisabled()` in
`server/internal/daemon/daemon.go` + `auto_update.go`.
