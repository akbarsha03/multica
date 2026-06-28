# Copy Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Copy workspace" mode to the Create Workspace dialog that deep-copies selected entity types (agents, squads, autopilots, wiki, issues) into a newly created workspace.

**Architecture:** Single `POST /api/workspaces/copy` endpoint runs the entire copy in one ACID transaction; the frontend extends `create-workspace-form.tsx` with a copy-mode toggle, source-workspace dropdown, and entity checkboxes, calling a new `useCopyWorkspace` mutation.

**Tech Stack:** Go (chi, pgx/v5, sqlc), TypeScript, React, TanStack Query, shadcn/ui (Select, Checkbox)

## Global Constraints

- All server work is done on **`/docker/multica-app`** on **`root@srv1757986`** (Grovio server).
- After server code changes: `cd /docker/multica-app && ./deploy.sh` on **both** `root@srv1757986` AND `root@ptspgt2` (at `/root/engg/multica-app` on ptspgt2).
- sqlc v2 config is at `server/sqlc.yaml`; generated files live in `server/pkg/db/generated/`.
- Human member references in the source workspace are **dropped** (assignees/creators set to the copying user).
- Webhook tokens on autopilot triggers are **regenerated**, not copied.
- Project links (`project_id`) are set to NULL on all copied entities.
- Agent `runtime_id` is set to NULL on copy (can't share runtimes across workspaces).

---

### Task 1: Add SQL queries + regenerate

**Files:**
- Modify: `server/pkg/db/queries/issue.sql`
- Modify: `server/pkg/db/generated/` (sqlc regenerated — do not edit manually)

**Interfaces:**
- Produces: `qtx.ListAllWorkspaceIssues(ctx, workspaceID pgtype.UUID) ([]db.Issue, error)`
- Produces: `qtx.SetIssueParent(ctx, db.SetIssueParentParams{ID, ParentIssueID pgtype.UUID}) error`

- [ ] **Step 1: Add queries to issue.sql**

Append to `/docker/multica-app/server/pkg/db/queries/issue.sql`:

```sql
-- name: ListAllWorkspaceIssues :many
SELECT * FROM issue
WHERE workspace_id = $1
ORDER BY position ASC, created_at ASC;

-- name: SetIssueParent :exec
UPDATE issue SET parent_issue_id = $2, updated_at = now()
WHERE id = $1;
```

- [ ] **Step 2: Run sqlc generate**

```bash
ssh root@srv1757986 'cd /docker/multica-app/server && docker run --rm -v $(pwd):/src -w /src sqlc/sqlc:latest generate'
```

If the sqlc docker approach fails, try the local binary:

```bash
ssh root@srv1757986 'cd /docker/multica-app/server && sqlc generate'
```

Expected: no errors. Files updated in `server/pkg/db/generated/issue.sql.go`.

- [ ] **Step 3: Verify generated functions exist**

```bash
ssh root@srv1757986 'grep -n "ListAllWorkspaceIssues\|SetIssueParent" /docker/multica-app/server/pkg/db/generated/issue.sql.go'
```

Expected: both function names appear.

- [ ] **Step 4: Commit**

```bash
ssh root@srv1757986 'cd /docker/multica-app && git add server/pkg/db/queries/issue.sql server/pkg/db/generated/ && git commit -m "feat: add ListAllWorkspaceIssues and SetIssueParent queries"'
```

---

### Task 2: Add CopyWorkspace backend handler

**Files:**
- Modify: `server/internal/handler/workspace.go`

**Interfaces:**
- Consumes: `qtx.ListAllAgents(ctx, srcID)`, `qtx.ListAllSquads(ctx, srcID)`, `qtx.ListSquadMembers(ctx, squadID)`, `qtx.AddSquadMember(ctx, db.AddSquadMemberParams)`, `qtx.ListAutopilots(ctx, db.ListAutopilotsParams)`, `qtx.ListAutopilotTriggers(ctx, autopilotID)`, `qtx.CreateAutopilotTrigger(ctx, db.CreateAutopilotTriggerParams)`, `qtx.ListWikiPages(ctx, srcID)`, `qtx.CreateWikiPage(ctx, db.CreateWikiPageParams)`, `qtx.ListWikiRevisionsForPage(ctx, db.ListWikiRevisionsForPageParams)`, `qtx.CreateWikiRevision(ctx, db.CreateWikiRevisionParams)`, `qtx.UpdateWikiPageContent(ctx, db.UpdateWikiPageContentParams)`, `qtx.MoveWikiPage(ctx, db.MoveWikiPageParams)`, `qtx.ListAllWorkspaceIssues(ctx, srcID)`, `qtx.IncrementIssueCounter(ctx, wsID)`, `qtx.CreateIssue(ctx, db.CreateIssueParams)`, `qtx.SetIssueParent(ctx, db.SetIssueParentParams)`, `generateWebhookToken()` (from autopilot_webhook.go)
- Produces: `POST /api/workspaces/copy` → `WorkspaceResponse` (JSON, 201 on success)

- [ ] **Step 1: Add import for slices package and write handler**

Open `server/internal/handler/workspace.go` and add the `CopyWorkspace` handler after the `CreateWorkspace` function (around line 240). Also add `"slices"` to the import block if not present.

Add these structs and the handler:

```go
type CopySelections struct {
	Agents     bool `json:"agents"`
	Squads     bool `json:"squads"`
	Autopilots bool `json:"autopilots"`
	Wiki       bool `json:"wiki"`
	Issues     bool `json:"issues"`
}

type CopyWorkspaceRequest struct {
	Name              string         `json:"name"`
	Slug              string         `json:"slug"`
	SourceWorkspaceID string         `json:"source_workspace_id"`
	Copy              CopySelections `json:"copy"`
}

func (h *Handler) CopyWorkspace(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}

	var req CopyWorkspaceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	req.Slug = strings.ToLower(strings.TrimSpace(req.Slug))
	if req.Name == "" || req.Slug == "" {
		writeError(w, http.StatusBadRequest, "name and slug are required")
		return
	}
	if !workspaceSlugPattern.MatchString(req.Slug) {
		writeError(w, http.StatusBadRequest, "slug must contain only lowercase letters, numbers, and hyphens")
		return
	}
	if isReservedSlug(req.Slug) {
		writeError(w, http.StatusBadRequest, "slug is reserved")
		return
	}

	srcID, ok := parseUUIDOrBadRequest(w, req.SourceWorkspaceID)
	if !ok {
		return
	}

	userUUID := parseUUID(userID)

	// Verify caller is member of source workspace
	if _, err := h.Queries.GetMemberByUserAndWorkspace(r.Context(), db.GetMemberByUserAndWorkspaceParams{
		UserID:      userUUID,
		WorkspaceID: srcID,
	}); err != nil {
		writeError(w, http.StatusForbidden, "not a member of source workspace")
		return
	}

	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create workspace")
		return
	}
	defer tx.Rollback(r.Context())
	qtx := h.Queries.WithTx(tx)

	// Create new workspace
	issuePrefix := generateIssuePrefix(req.Name)
	newWs, err := qtx.CreateWorkspace(r.Context(), db.CreateWorkspaceParams{
		Name:        req.Name,
		Slug:        req.Slug,
		IssuePrefix: issuePrefix,
	})
	if err != nil {
		if isUniqueViolation(err) {
			writeError(w, http.StatusConflict, "workspace slug already exists")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to create workspace: "+err.Error())
		return
	}

	if _, err := qtx.CreateMember(r.Context(), db.CreateMemberParams{
		WorkspaceID: newWs.ID,
		UserID:      userUUID,
		Role:        "owner",
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to add owner: "+err.Error())
		return
	}

	// --- Copy agents ---
	agentIDMap := map[pgtype.UUID]pgtype.UUID{}
	if req.Copy.Agents {
		agents, err := qtx.ListAllAgents(r.Context(), srcID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to list agents: "+err.Error())
			return
		}
		for _, a := range agents {
			newAgent, err := qtx.CreateAgent(r.Context(), db.CreateAgentParams{
				WorkspaceID:        newWs.ID,
				Name:               a.Name,
				Description:        a.Description,
				AvatarUrl:          a.AvatarUrl,
				RuntimeMode:        a.RuntimeMode,
				RuntimeConfig:      a.RuntimeConfig,
				RuntimeID:          pgtype.UUID{}, // drop runtime link
				Visibility:         a.Visibility,
				MaxConcurrentTasks: a.MaxConcurrentTasks,
				OwnerID:            userUUID,
				Instructions:       a.Instructions,
				CustomEnv:          a.CustomEnv,
				CustomArgs:         a.CustomArgs,
				McpConfig:          a.McpConfig,
				Model:              a.Model,
				ThinkingLevel:      a.ThinkingLevel,
			})
			if err != nil {
				writeError(w, http.StatusInternalServerError, "failed to copy agent: "+err.Error())
				return
			}
			agentIDMap[a.ID] = newAgent.ID
		}
	}

	// --- Copy squads ---
	squadIDMap := map[pgtype.UUID]pgtype.UUID{}
	if req.Copy.Squads {
		squads, err := qtx.ListAllSquads(r.Context(), srcID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to list squads: "+err.Error())
			return
		}
		for _, s := range squads {
			newLeaderID := pgtype.UUID{}
			if mapped, ok := agentIDMap[s.LeaderID]; ok {
				newLeaderID = mapped
			}
			newSquad, err := qtx.CreateSquad(r.Context(), db.CreateSquadParams{
				WorkspaceID: newWs.ID,
				Name:        s.Name,
				Description: s.Description,
				LeaderID:    newLeaderID,
				CreatorID:   userUUID,
				AvatarUrl:   s.AvatarUrl,
			})
			if err != nil {
				writeError(w, http.StatusInternalServerError, "failed to copy squad: "+err.Error())
				return
			}
			squadIDMap[s.ID] = newSquad.ID

			members, err := qtx.ListSquadMembers(r.Context(), s.ID)
			if err != nil {
				writeError(w, http.StatusInternalServerError, "failed to list squad members: "+err.Error())
				return
			}
			for _, m := range members {
				if m.MemberType == "member" {
					continue // drop human members
				}
				newMemberID, ok := agentIDMap[m.MemberID]
				if !ok {
					continue
				}
				if _, err := qtx.AddSquadMember(r.Context(), db.AddSquadMemberParams{
					SquadID:    newSquad.ID,
					MemberType: m.MemberType,
					MemberID:   newMemberID,
					Role:       m.Role,
				}); err != nil {
					writeError(w, http.StatusInternalServerError, "failed to copy squad member: "+err.Error())
					return
				}
			}
		}
	}

	// --- Copy autopilots ---
	if req.Copy.Autopilots {
		autopilots, err := qtx.ListAutopilots(r.Context(), db.ListAutopilotsParams{
			WorkspaceID: srcID,
			Status:      pgtype.Text{},
		})
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to list autopilots: "+err.Error())
			return
		}
		for _, row := range autopilots {
			a := row.Autopilot
			newAssigneeID := pgtype.UUID{}
			newAssigneeType := a.AssigneeType
			switch a.AssigneeType {
			case "agent":
				if mapped, ok := agentIDMap[a.AssigneeID]; ok {
					newAssigneeID = mapped
				}
			case "squad":
				if mapped, ok := squadIDMap[a.AssigneeID]; ok {
					newAssigneeID = mapped
				}
			}

			newAP, err := qtx.CreateAutopilot(r.Context(), db.CreateAutopilotParams{
				WorkspaceID:        newWs.ID,
				Title:              a.Title,
				Description:        a.Description,
				AssigneeType:       newAssigneeType,
				AssigneeID:         newAssigneeID,
				Status:             a.Status,
				ExecutionMode:      a.ExecutionMode,
				IssueTitleTemplate: a.IssueTitleTemplate,
				ProjectID:          pgtype.UUID{},
				CreatedByType:      "member",
				CreatedByID:        userUUID,
			})
			if err != nil {
				writeError(w, http.StatusInternalServerError, "failed to copy autopilot: "+err.Error())
				return
			}

			triggers, err := qtx.ListAutopilotTriggers(r.Context(), a.ID)
			if err != nil {
				writeError(w, http.StatusInternalServerError, "failed to list autopilot triggers: "+err.Error())
				return
			}
			for _, t := range triggers {
				webhookToken := pgtype.Text{}
				if t.Kind == "webhook" {
					tok, err := generateWebhookToken()
					if err != nil {
						writeError(w, http.StatusInternalServerError, "failed to generate webhook token")
						return
					}
					webhookToken = pgtype.Text{String: tok, Valid: true}
				}
				if _, err := qtx.CreateAutopilotTrigger(r.Context(), db.CreateAutopilotTriggerParams{
					AutopilotID:    newAP.ID,
					Kind:           t.Kind,
					Enabled:        t.Enabled,
					CronExpression: t.CronExpression,
					Timezone:       t.Timezone,
					NextRunAt:      t.NextRunAt,
					WebhookToken:   webhookToken,
					Label:          t.Label,
					Provider:       t.Provider,
					EventFilters:   t.EventFilters,
				}); err != nil {
					writeError(w, http.StatusInternalServerError, "failed to copy autopilot trigger: "+err.Error())
					return
				}
			}
		}
	}

	// --- Copy wiki ---
	if req.Copy.Wiki {
		pages, err := qtx.ListWikiPages(r.Context(), srcID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to list wiki pages: "+err.Error())
			return
		}

		pageIDMap := map[pgtype.UUID]pgtype.UUID{}
		type pageInfo struct {
			src   db.WikiPage
			newID pgtype.UUID
		}
		var pageInfos []pageInfo

		// First pass: create all pages with parent_id=NULL
		for _, p := range pages {
			newPage, err := qtx.CreateWikiPage(r.Context(), db.CreateWikiPageParams{
				WorkspaceID:   newWs.ID,
				ParentID:      pgtype.UUID{},
				Title:         p.Title,
				Slug:          p.Slug,
				Content:       p.Content,
				Position:      p.Position,
				CreatedByType: "member",
				CreatedByID:   userUUID,
			})
			if err != nil {
				writeError(w, http.StatusInternalServerError, "failed to copy wiki page: "+err.Error())
				return
			}
			pageIDMap[p.ID] = newPage.ID
			pageInfos = append(pageInfos, pageInfo{src: p, newID: newPage.ID})
		}

		// Copy revisions (oldest first) and update current_revision_id
		for _, pi := range pageInfos {
			revs, err := qtx.ListWikiRevisionsForPage(r.Context(), db.ListWikiRevisionsForPageParams{
				PageID:      pi.src.ID,
				WorkspaceID: srcID,
			})
			if err != nil {
				writeError(w, http.StatusInternalServerError, "failed to list wiki revisions: "+err.Error())
				return
			}
			// Query returns DESC; reverse to get oldest-first for correct base_revision_id chaining
			slices.Reverse(revs)

			revIDMap := map[pgtype.UUID]pgtype.UUID{}
			for _, rev := range revs {
				newBaseRevID := pgtype.UUID{}
				if rev.BaseRevisionID.Valid {
					if mapped, ok := revIDMap[rev.BaseRevisionID]; ok {
						newBaseRevID = mapped
					}
				}
				newRev, err := qtx.CreateWikiRevision(r.Context(), db.CreateWikiRevisionParams{
					PageID:         pi.newID,
					WorkspaceID:    newWs.ID,
					Title:          rev.Title,
					Content:        rev.Content,
					BaseRevisionID: newBaseRevID,
					AuthorType:     "member",
					AuthorID:       userUUID,
					Status:         rev.Status,
					Summary:        rev.Summary,
				})
				if err != nil {
					writeError(w, http.StatusInternalServerError, "failed to copy wiki revision: "+err.Error())
					return
				}
				revIDMap[rev.ID] = newRev.ID
			}

			if pi.src.CurrentRevisionID.Valid {
				if newRevID, ok := revIDMap[pi.src.CurrentRevisionID]; ok {
					if _, err := qtx.UpdateWikiPageContent(r.Context(), db.UpdateWikiPageContentParams{
						ID:                pi.newID,
						WorkspaceID:       newWs.ID,
						Title:             pi.src.Title,
						Content:           pi.src.Content,
						CurrentRevisionID: newRevID,
						UpdatedByType:     "member",
						UpdatedByID:       userUUID,
					}); err != nil {
						writeError(w, http.StatusInternalServerError, "failed to update wiki page revision: "+err.Error())
						return
					}
				}
			}
		}

		// Second pass: wire up parent_id for child pages
		for _, pi := range pageInfos {
			if !pi.src.ParentID.Valid {
				continue
			}
			newParentID, ok := pageIDMap[pi.src.ParentID]
			if !ok {
				continue
			}
			if _, err := qtx.MoveWikiPage(r.Context(), db.MoveWikiPageParams{
				ID:          pi.newID,
				WorkspaceID: newWs.ID,
				ParentID:    newParentID,
				Position:    pi.src.Position,
			}); err != nil {
				writeError(w, http.StatusInternalServerError, "failed to update wiki page parent: "+err.Error())
				return
			}
		}
	}

	// --- Copy issues ---
	if req.Copy.Issues {
		issues, err := qtx.ListAllWorkspaceIssues(r.Context(), srcID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to list issues: "+err.Error())
			return
		}

		issueIDMap := map[pgtype.UUID]pgtype.UUID{}
		type copiedIssue struct {
			newID     pgtype.UUID
			srcParent pgtype.UUID
		}
		var copiedIssues []copiedIssue

		for _, issue := range issues {
			issueNumber, err := qtx.IncrementIssueCounter(r.Context(), newWs.ID)
			if err != nil {
				writeError(w, http.StatusInternalServerError, "failed to increment issue counter: "+err.Error())
				return
			}

			assigneeType := pgtype.Text{}
			assigneeID := pgtype.UUID{}
			if issue.AssigneeType.Valid {
				switch issue.AssigneeType.String {
				case "agent":
					if mapped, ok := agentIDMap[issue.AssigneeID]; ok {
						assigneeType = issue.AssigneeType
						assigneeID = mapped
					}
				case "squad":
					if mapped, ok := squadIDMap[issue.AssigneeID]; ok {
						assigneeType = issue.AssigneeType
						assigneeID = mapped
					}
				// "member" → drop
				}
			}

			newIssue, err := qtx.CreateIssue(r.Context(), db.CreateIssueParams{
				WorkspaceID:   newWs.ID,
				Title:         issue.Title,
				Description:   issue.Description,
				Status:        issue.Status,
				Priority:      issue.Priority,
				AssigneeType:  assigneeType,
				AssigneeID:    assigneeID,
				CreatorType:   "member",
				CreatorID:     userUUID,
				ParentIssueID: pgtype.UUID{},
				ProjectID:     pgtype.UUID{},
				Position:      issue.Position,
				StartDate:     issue.StartDate,
				DueDate:       issue.DueDate,
				Number:        int32(issueNumber),
				Stage:         issue.Stage,
			})
			if err != nil {
				writeError(w, http.StatusInternalServerError, "failed to copy issue: "+err.Error())
				return
			}

			issueIDMap[issue.ID] = newIssue.ID
			copiedIssues = append(copiedIssues, copiedIssue{
				newID:     newIssue.ID,
				srcParent: issue.ParentIssueID,
			})
		}

		// Second pass: wire up parent_issue_id
		for _, ci := range copiedIssues {
			if !ci.srcParent.Valid {
				continue
			}
			newParentID, ok := issueIDMap[ci.srcParent]
			if !ok {
				continue
			}
			if err := qtx.SetIssueParent(r.Context(), db.SetIssueParentParams{
				ID:            ci.newID,
				ParentIssueID: newParentID,
			}); err != nil {
				writeError(w, http.StatusInternalServerError, "failed to update issue parent: "+err.Error())
				return
			}
		}
	}

	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to commit transaction")
		return
	}

	slog.Info("workspace copied", append(logger.RequestAttrs(r), "source_workspace_id", uuidToString(srcID), "new_workspace_id", uuidToString(newWs.ID))...)
	writeJSON(w, http.StatusCreated, workspaceToResponse(newWs))
}
```

- [ ] **Step 2: Add `"slices"` to imports if not already present**

In `server/internal/handler/workspace.go`, check the import block. If `"slices"` is not there, add it:

```go
import (
    // ... existing imports ...
    "slices"
    // ...
)
```

- [ ] **Step 3: Build to verify compilation**

```bash
ssh root@srv1757986 'cd /docker/multica-app/server && go build ./...'
```

Expected: exits 0, no errors.

- [ ] **Step 4: Commit**

```bash
ssh root@srv1757986 'cd /docker/multica-app && git add server/internal/handler/workspace.go && git commit -m "feat: add CopyWorkspace handler"'
```

---

### Task 3: Register route in router.go

**Files:**
- Modify: `server/cmd/server/router.go` (line ~647–650)

**Interfaces:**
- Consumes: `h.CopyWorkspace` from Task 2
- Produces: `POST /api/workspaces/copy` route, registered BEFORE `/{id}` wildcard

- [ ] **Step 1: Add route before `/{id}` wildcard**

In `server/cmd/server/router.go`, find the `r.Route("/api/workspaces", ...)` block (line 647). It currently looks like:

```go
r.Route("/api/workspaces", func(r chi.Router) {
    r.Get("/", h.ListWorkspaces)
    r.Post("/", h.CreateWorkspace)
    r.Route("/{id}", func(r chi.Router) {
```

Change it to:

```go
r.Route("/api/workspaces", func(r chi.Router) {
    r.Get("/", h.ListWorkspaces)
    r.Post("/", h.CreateWorkspace)
    r.Post("/copy", h.CopyWorkspace)
    r.Route("/{id}", func(r chi.Router) {
```

- [ ] **Step 2: Build to verify**

```bash
ssh root@srv1757986 'cd /docker/multica-app/server && go build ./...'
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
ssh root@srv1757986 'cd /docker/multica-app && git add server/cmd/server/router.go && git commit -m "feat: register POST /api/workspaces/copy route"'
```

---

### Task 4: Frontend types, API client, and mutation

**Files:**
- Modify: `packages/core/types/workspace.ts`
- Modify: `packages/core/api/client.ts`
- Modify: `packages/core/workspace/mutations.ts`

**Interfaces:**
- Produces: `CopyWorkspaceRequest` type
- Produces: `api.copyWorkspace(data: CopyWorkspaceRequest): Promise<Workspace>`
- Produces: `useCopyWorkspace()` mutation hook

- [ ] **Step 1: Add CopyWorkspaceRequest type to workspace.ts**

In `packages/core/types/workspace.ts`, append:

```typescript
export interface CopySelections {
  agents: boolean;
  squads: boolean;
  autopilots: boolean;
  wiki: boolean;
  issues: boolean;
}

export interface CopyWorkspaceRequest {
  name: string;
  slug: string;
  source_workspace_id: string;
  copy: CopySelections;
}
```

- [ ] **Step 2: Add copyWorkspace method to client.ts**

In `packages/core/api/client.ts`, after the `createWorkspace` method (line ~1563), add:

```typescript
async copyWorkspace(data: CopyWorkspaceRequest): Promise<Workspace> {
  return this.fetch("/api/workspaces/copy", {
    method: "POST",
    body: JSON.stringify(data),
  });
}
```

Also add `CopyWorkspaceRequest` to the import for `workspace.ts` types at the top of client.ts. Find the existing workspace types import and add it:

```typescript
import type { ..., CopyWorkspaceRequest } from "../types/workspace";
```

- [ ] **Step 3: Add useCopyWorkspace mutation to mutations.ts**

In `packages/core/workspace/mutations.ts`, add after `useCreateWorkspace`:

```typescript
export function useCopyWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CopyWorkspaceRequest) => api.copyWorkspace(data),
    onSuccess: (newWs) => {
      qc.setQueryData(workspaceKeys.list(), (old: Workspace[] = []) => [...old, newWs]);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: workspaceKeys.list() });
    },
  });
}
```

Add `CopyWorkspaceRequest` to the import at the top of mutations.ts:

```typescript
import type { Workspace, CopyWorkspaceRequest } from "../types";
```

- [ ] **Step 4: Build to verify TypeScript**

```bash
ssh root@srv1757986 'cd /docker/multica-app && npx tsc --noEmit -p packages/core/tsconfig.json 2>&1 | head -30'
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
ssh root@srv1757986 'cd /docker/multica-app && git add packages/core/types/workspace.ts packages/core/api/client.ts packages/core/workspace/mutations.ts && git commit -m "feat: add copyWorkspace API client and useCopyWorkspace mutation"'
```

---

### Task 5: Extend create-workspace-form.tsx with copy UI

**Files:**
- Modify: `packages/views/workspace/create-workspace-form.tsx`

**Interfaces:**
- Consumes: `useCopyWorkspace()` from Task 4, `workspaceListOptions()` from `packages/core/workspace/queries.ts`, `Select/SelectContent/SelectItem/SelectTrigger/SelectValue` from `@multica/ui/components/ui/select`, `Checkbox` from `@multica/ui/components/ui/checkbox`
- Produces: Extended form with copy-mode toggle, source workspace dropdown, and entity checkboxes; calls `useCopyWorkspace` when in copy mode, `useCreateWorkspace` otherwise

- [ ] **Step 1: Replace create-workspace-form.tsx with extended version**

Replace the full content of `packages/views/workspace/create-workspace-form.tsx`:

```typescript
"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@multica/ui/components/ui/input";
import { Label } from "@multica/ui/components/ui/label";
import { Button } from "@multica/ui/components/ui/button";
import { Card, CardContent } from "@multica/ui/components/ui/card";
import { Checkbox } from "@multica/ui/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@multica/ui/components/ui/select";
import { useCreateWorkspace, useCopyWorkspace } from "@multica/core/workspace/mutations";
import type { Workspace, CopySelections } from "@multica/core/types";
import { workspaceListOptions } from "@multica/core/workspace/queries";
import { isImeComposing } from "@multica/core/utils";
import {
  WORKSPACE_SLUG_REGEX,
  isWorkspaceSlugConflict,
  nameToWorkspaceSlug,
} from "./slug";
import { useT } from "../i18n";
import { isReservedSlug } from "@multica/core/paths";
import { useConfigStore } from "@multica/core/config";
import { workspaceUrlHost } from "@multica/core/workspace/workspace-url";

export interface CreateWorkspaceFormProps {
  onSuccess: (workspace: Workspace) => void | Promise<void>;
}

const ALL_COPY_SELECTIONS: CopySelections = {
  agents: true,
  squads: true,
  autopilots: true,
  wiki: true,
  issues: true,
};

const COPY_SELECTION_KEYS: (keyof CopySelections)[] = [
  "agents",
  "squads",
  "autopilots",
  "wiki",
  "issues",
];

export function CreateWorkspaceForm({ onSuccess }: CreateWorkspaceFormProps) {
  const { t } = useT("workspace");
  const createWorkspace = useCreateWorkspace();
  const copyWorkspace = useCopyWorkspace();
  const urlHost = workspaceUrlHost(useConfigStore((s) => s.daemonAppUrl));
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugServerError, setSlugServerError] = useState<string | null>(null);
  const slugTouched = useRef(false);

  // Copy mode state
  const [copyMode, setCopyMode] = useState(false);
  const [sourceWorkspaceId, setSourceWorkspaceId] = useState<string>("");
  const [copySelections, setCopySelections] = useState<CopySelections>(ALL_COPY_SELECTIONS);

  const { data: workspaces = [] } = useQuery(workspaceListOptions());

  const slugValidationError =
    slug.length > 0 && !WORKSPACE_SLUG_REGEX.test(slug)
      ? t(($) => $.create_form.errors.slug_format)
      : null;
  const slugReservedError =
    slug.length > 0 && isReservedSlug(slug)
      ? t(($) => $.create_form.errors.slug_reserved)
      : null;
  const slugError = slugValidationError ?? slugReservedError ?? slugServerError;

  const copyModeReady = !copyMode || (copyMode && sourceWorkspaceId !== "");
  const canSubmit =
    name.trim().length > 0 &&
    slug.trim().length > 0 &&
    !slugError &&
    copyModeReady;

  const handleNameChange = (value: string) => {
    setName(value);
    if (!slugTouched.current) {
      setSlug(nameToWorkspaceSlug(value));
      setSlugServerError(null);
    }
  };

  const handleSlugChange = (value: string) => {
    slugTouched.current = true;
    setSlug(value);
    setSlugServerError(null);
  };

  const toggleSelection = (key: keyof CopySelections) => {
    setCopySelections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleError = (error: unknown) => {
    if (isWorkspaceSlugConflict(error)) {
      setSlugServerError(t(($) => $.create_form.errors.slug_taken));
      toast.error(t(($) => $.create_form.errors.slug_conflict_toast));
      return;
    }
    toast.error(
      error instanceof Error && error.message
        ? error.message
        : t(($) => $.create_form.errors.create_failed),
    );
  };

  const handleSubmit = () => {
    if (!canSubmit) return;

    if (copyMode && sourceWorkspaceId) {
      copyWorkspace.mutate(
        {
          name: name.trim(),
          slug: slug.trim(),
          source_workspace_id: sourceWorkspaceId,
          copy: copySelections,
        },
        { onSuccess, onError: handleError },
      );
    } else {
      createWorkspace.mutate(
        { name: name.trim(), slug: slug.trim() },
        { onSuccess, onError: handleError },
      );
    }
  };

  const isPending = createWorkspace.isPending || copyWorkspace.isPending;

  return (
    <Card className="w-full">
      <CardContent className="space-y-4 pt-6">
        <div className="space-y-1.5">
          <Label htmlFor="ws-name">{t(($) => $.create_form.name_label)}</Label>
          <Input
            id="ws-name"
            autoFocus
            type="text"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder={t(($) => $.create_form.name_placeholder)}
            onKeyDown={(e) => {
              if (isImeComposing(e)) return;
              if (e.key === "Enter") handleSubmit();
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ws-slug">{t(($) => $.create_form.url_label)}</Label>
          <div className="flex items-center gap-0 rounded-md border bg-background focus-within:ring-2 focus-within:ring-ring">
            <span className="pl-3 text-sm text-muted-foreground select-none">
              {`${urlHost}/`}
            </span>
            <Input
              id="ws-slug"
              type="text"
              value={slug}
              onChange={(e) => handleSlugChange(e.target.value)}
              placeholder={t(($) => $.create_form.url_placeholder)}
              className="border-0 shadow-none focus-visible:ring-0"
              onKeyDown={(e) => {
                if (isImeComposing(e)) return;
                if (e.key === "Enter") handleSubmit();
              }}
            />
          </div>
          {slugError && (
            <p className="text-xs text-destructive">{slugError}</p>
          )}
        </div>

        {/* Copy mode toggle */}
        <div className="flex items-center gap-2">
          <Checkbox
            id="copy-mode"
            checked={copyMode}
            onCheckedChange={(v) => {
              setCopyMode(!!v);
              if (!v) setSourceWorkspaceId("");
            }}
          />
          <Label htmlFor="copy-mode" className="cursor-pointer font-normal">
            Copy from existing workspace
          </Label>
        </div>

        {copyMode && (
          <div className="space-y-3 pl-6">
            <div className="space-y-1.5">
              <Label>Source workspace</Label>
              <Select value={sourceWorkspaceId} onValueChange={setSourceWorkspaceId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a workspace…" />
                </SelectTrigger>
                <SelectContent>
                  {workspaces.map((ws) => (
                    <SelectItem key={ws.id} value={ws.id}>
                      {ws.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">What to copy</Label>
              {COPY_SELECTION_KEYS.map((key) => (
                <div key={key} className="flex items-center gap-2">
                  <Checkbox
                    id={`copy-${key}`}
                    checked={copySelections[key]}
                    onCheckedChange={() => toggleSelection(key)}
                  />
                  <Label
                    htmlFor={`copy-${key}`}
                    className="cursor-pointer font-normal capitalize"
                  >
                    {key}
                  </Label>
                </div>
              ))}
            </div>
          </div>
        )}

        <Button
          className="w-full"
          size="lg"
          onClick={handleSubmit}
          disabled={isPending || !canSubmit}
        >
          {isPending
            ? t(($) => $.create_form.submitting)
            : t(($) => $.create_form.submit)}
        </Button>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: TypeScript check**

```bash
ssh root@srv1757986 'cd /docker/multica-app && npx tsc --noEmit -p packages/views/tsconfig.json 2>&1 | head -30'
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
ssh root@srv1757986 'cd /docker/multica-app && git add packages/views/workspace/create-workspace-form.tsx && git commit -m "feat: extend create-workspace form with copy-from-workspace mode"'
```

---

### Task 6: Deploy to both servers

**Files:** none (deploy only)

- [ ] **Step 1: Deploy to Grovio server (srv1757986)**

```bash
ssh root@srv1757986 'cd /docker/multica-app && ./deploy.sh'
```

Expected: containers restart cleanly, no build errors.

- [ ] **Step 2: Health-check Grovio**

```bash
ssh root@srv1757986 'curl -sf https://multica.grovio.ai/api/health || curl -sf http://localhost:3400/api/health'
```

Expected: `{"status":"ok"}` or similar.

- [ ] **Step 3: Pull latest on ptspgt2 and deploy**

```bash
ssh root@ptspgt2 'cd /root/engg/multica-app && git pull && ./deploy.sh'
```

Expected: containers restart cleanly.

- [ ] **Step 4: Health-check ptspgt2**

```bash
ssh root@ptspgt2 'curl -sf http://localhost:3400/api/health'
```

Expected: healthy response.

- [ ] **Step 5: Smoke-test the copy endpoint**

Open the app → create workspace dialog → check "Copy from existing workspace" → select a source workspace → ensure entity checkboxes appear → submit and verify the new workspace is created with the selected entities.
