package handler

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"regexp"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

// WikiPageResponse is the JSON shape returned for a wiki page.
type WikiPageResponse struct {
	ID                string  `json:"id"`
	WorkspaceID       string  `json:"workspace_id"`
	ParentID          *string `json:"parent_id"`
	CurrentRevisionID *string `json:"current_revision_id"`
	Title             string  `json:"title"`
	Slug              string  `json:"slug"`
	Content           string  `json:"content"`
	Position          int32   `json:"position"`
	CreatedByType     string  `json:"created_by_type"`
	CreatedByID       string  `json:"created_by_id"`
	UpdatedByType     string  `json:"updated_by_type"`
	UpdatedByID       string  `json:"updated_by_id"`
	CreatedAt         string  `json:"created_at"`
	UpdatedAt         string  `json:"updated_at"`
	ArchivedAt        *string `json:"archived_at"`
}

// wikiPageToResponse converts a db.WikiPage to WikiPageResponse.
func wikiPageToResponse(p db.WikiPage) WikiPageResponse {
	return WikiPageResponse{
		ID:                uuidToString(p.ID),
		WorkspaceID:       uuidToString(p.WorkspaceID),
		ParentID:          uuidToPtr(p.ParentID),
		CurrentRevisionID: uuidToPtr(p.CurrentRevisionID),
		Title:             p.Title,
		Slug:              p.Slug,
		Content:           p.Content,
		Position:          p.Position,
		CreatedByType:     p.CreatedByType,
		CreatedByID:       uuidToString(p.CreatedByID),
		UpdatedByType:     p.UpdatedByType,
		UpdatedByID:       uuidToString(p.UpdatedByID),
		CreatedAt:         timestampToString(p.CreatedAt),
		UpdatedAt:         timestampToString(p.UpdatedAt),
		ArchivedAt:        timestampToPtr(p.ArchivedAt),
	}
}

// CreateWikiPageRequest is the request body for creating a wiki page.
type CreateWikiPageRequest struct {
	Title    string  `json:"title"`
	Content  string  `json:"content"`
	ParentID *string `json:"parent_id"`
}

var nonAlphanumRe = regexp.MustCompile(`[^a-z0-9]+`)

// slugify converts a title to a URL-friendly slug.
func slugify(title string) string {
	s := strings.ToLower(title)
	s = nonAlphanumRe.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	if s == "" {
		s = "page"
	}
	return s
}

// CreateWikiPage handles POST /api/wiki/pages.
func (h *Handler) CreateWikiPage(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}

	workspaceID := h.resolveWorkspaceID(r)
	if workspaceID == "" {
		writeError(w, http.StatusBadRequest, "workspace_id is required")
		return
	}

	var req CreateWikiPageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Title == "" {
		writeError(w, http.StatusBadRequest, "title is required")
		return
	}

	actorType, actorID := h.resolveActor(r, userID, workspaceID)

	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return
	}

	actorUUID, ok := parseUUIDOrBadRequest(w, actorID, "actor id")
	if !ok {
		return
	}

	var parentUUID pgtype.UUID // zero value = NULL
	if req.ParentID != nil && *req.ParentID != "" {
		parentUUID, ok = parseUUIDOrBadRequest(w, *req.ParentID, "parent_id")
		if !ok {
			return
		}
	}

	params := db.CreateWikiPageParams{
		WorkspaceID:   wsUUID,
		ParentID:      parentUUID,
		Title:         req.Title,
		Slug:          slugify(req.Title),
		Content:       req.Content,
		Position:      0,
		CreatedByType: actorType,
		CreatedByID:   actorUUID,
	}

	page, err2 := h.Queries.CreateWikiPage(r.Context(), params)
	if err2 != nil {
		if isUniqueViolation(err2) {
			writeError(w, http.StatusConflict, "a page with this title already exists in the workspace")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to create wiki page")
		return
	}

	writeJSON(w, http.StatusCreated, wikiPageToResponse(page))
	h.publish(protocol.EventWikiChanged, workspaceID, actorType, actorID, map[string]any{"page_id": uuidToString(page.ID)})
}

// ListWikiPages handles GET /api/wiki/pages.
func (h *Handler) ListWikiPages(w http.ResponseWriter, r *http.Request) {
	if _, ok := requireUserID(w, r); !ok {
		return
	}

	workspaceID := h.resolveWorkspaceID(r)
	if workspaceID == "" {
		writeError(w, http.StatusBadRequest, "workspace_id is required")
		return
	}

	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return
	}

	pages, err := h.Queries.ListWikiPages(r.Context(), wsUUID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list wiki pages")
		return
	}

	out := make([]WikiPageResponse, len(pages))
	for i, p := range pages {
		out[i] = wikiPageToResponse(p)
	}

	writeJSON(w, http.StatusOK, map[string]any{"pages": out})
}

// GetWikiPage handles GET /api/wiki/pages/{pageId}.
func (h *Handler) GetWikiPage(w http.ResponseWriter, r *http.Request) {
	if _, ok := requireUserID(w, r); !ok {
		return
	}

	workspaceID := h.resolveWorkspaceID(r)
	if workspaceID == "" {
		writeError(w, http.StatusBadRequest, "workspace_id is required")
		return
	}

	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return
	}

	// pageId accepts either a UUID or a human-readable slug, mirroring the
	// `multica wiki page get <id-or-slug>` CLI. Agent-authored markdown links
	// reference pages by slug (e.g. /wiki/<slug>), so resolve both shapes here
	// instead of 400-ing on a non-UUID.
	pageRef := chi.URLParam(r, "pageId")
	var page db.WikiPage
	var err error
	if pageUUID, perr := util.ParseUUID(pageRef); perr == nil {
		page, err = h.Queries.GetWikiPage(r.Context(), db.GetWikiPageParams{
			ID:          pageUUID,
			WorkspaceID: wsUUID,
		})
	} else {
		page, err = h.Queries.GetWikiPageBySlug(r.Context(), db.GetWikiPageBySlugParams{
			WorkspaceID: wsUUID,
			Slug:        pageRef,
		})
	}
	if err != nil {
		if isNotFound(err) {
			writeError(w, http.StatusNotFound, "wiki page not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to get wiki page")
		return
	}

	writeJSON(w, http.StatusOK, wikiPageToResponse(page))
}

// GetWikiPageBySlug handles GET /api/wiki/pages/by-slug/{slug}.
func (h *Handler) GetWikiPageBySlug(w http.ResponseWriter, r *http.Request) {
	if _, ok := requireUserID(w, r); !ok {
		return
	}

	workspaceID := h.resolveWorkspaceID(r)
	if workspaceID == "" {
		writeError(w, http.StatusBadRequest, "workspace_id is required")
		return
	}

	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return
	}

	slug := chi.URLParam(r, "slug")

	page, err := h.Queries.GetWikiPageBySlug(r.Context(), db.GetWikiPageBySlugParams{
		WorkspaceID: wsUUID,
		Slug:        slug,
	})
	if err != nil {
		if isNotFound(err) {
			writeError(w, http.StatusNotFound, "wiki page not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to get wiki page")
		return
	}

	writeJSON(w, http.StatusOK, wikiPageToResponse(page))
}

// WikiRevisionResponse is the JSON shape for a wiki revision.
type WikiRevisionResponse struct {
	ID             string  `json:"id"`
	PageID         string  `json:"page_id"`
	WorkspaceID    string  `json:"workspace_id"`
	Title          string  `json:"title"`
	Content        string  `json:"content"`
	BaseRevisionID *string `json:"base_revision_id"`
	AuthorType     string  `json:"author_type"`
	AuthorID       string  `json:"author_id"`
	Status         string  `json:"status"`
	Summary        *string `json:"summary"`
	ReviewedByID   *string `json:"reviewed_by_id"`
	ReviewedAt     *string `json:"reviewed_at"`
	CreatedAt      string  `json:"created_at"`
}

// wikiRevisionToResponse converts a db.WikiRevision to WikiRevisionResponse.
func wikiRevisionToResponse(rev db.WikiRevision) WikiRevisionResponse {
	return WikiRevisionResponse{
		ID:             uuidToString(rev.ID),
		PageID:         uuidToString(rev.PageID),
		WorkspaceID:    uuidToString(rev.WorkspaceID),
		Title:          rev.Title,
		Content:        rev.Content,
		BaseRevisionID: uuidToPtr(rev.BaseRevisionID),
		AuthorType:     rev.AuthorType,
		AuthorID:       uuidToString(rev.AuthorID),
		Status:         rev.Status,
		Summary:        textToPtr(rev.Summary),
		ReviewedByID:   uuidToPtr(rev.ReviewedByID),
		ReviewedAt:     timestampToPtr(rev.ReviewedAt),
		CreatedAt:      timestampToString(rev.CreatedAt),
	}
}

// ListWikiRevisions handles GET /api/wiki/pages/{pageId}/revisions.
func (h *Handler) ListWikiRevisions(w http.ResponseWriter, r *http.Request) {
	if _, ok := requireUserID(w, r); !ok {
		return
	}

	workspaceID := h.resolveWorkspaceID(r)
	if workspaceID == "" {
		writeError(w, http.StatusBadRequest, "workspace_id is required")
		return
	}

	pageID := chi.URLParam(r, "pageId")
	pageUUID, ok := parseUUIDOrBadRequest(w, pageID, "page id")
	if !ok {
		return
	}

	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return
	}

	revisions, err := h.Queries.ListWikiRevisionsForPage(r.Context(), db.ListWikiRevisionsForPageParams{
		PageID:      pageUUID,
		WorkspaceID: wsUUID,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list revisions")
		return
	}

	out := make([]WikiRevisionResponse, len(revisions))
	for i, rev := range revisions {
		out[i] = wikiRevisionToResponse(rev)
	}

	writeJSON(w, http.StatusOK, map[string]any{"revisions": out})
}

// ListWikiProposals handles GET /api/wiki/proposals.
func (h *Handler) ListWikiProposals(w http.ResponseWriter, r *http.Request) {
	if _, ok := requireUserID(w, r); !ok {
		return
	}

	workspaceID := h.resolveWorkspaceID(r)
	if workspaceID == "" {
		writeError(w, http.StatusBadRequest, "workspace_id is required")
		return
	}

	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return
	}

	proposals, err := h.Queries.ListProposedWikiRevisions(r.Context(), wsUUID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list proposals")
		return
	}

	out := make([]WikiRevisionResponse, len(proposals))
	for i, rev := range proposals {
		out[i] = wikiRevisionToResponse(rev)
	}

	writeJSON(w, http.StatusOK, map[string]any{"proposals": out})
}

// UpdateWikiPageRequest is the request body for updating a wiki page (human live-edit).
type UpdateWikiPageRequest struct {
	Title   string `json:"title"`
	Content string `json:"content"`
	Summary string `json:"summary"`
}

// UpdateWikiPage handles PATCH /api/wiki/pages/{pageId}.
// Creates a merged revision and updates the page's current_revision_id.
func (h *Handler) UpdateWikiPage(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}

	workspaceID := h.resolveWorkspaceID(r)
	if workspaceID == "" {
		writeError(w, http.StatusBadRequest, "workspace_id is required")
		return
	}

	pageID := chi.URLParam(r, "pageId")
	pageUUID, ok := parseUUIDOrBadRequest(w, pageID, "page id")
	if !ok {
		return
	}

	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return
	}

	var req UpdateWikiPageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Load the current page to get BaseRevisionID.
	page, err := h.Queries.GetWikiPage(r.Context(), db.GetWikiPageParams{
		ID:          pageUUID,
		WorkspaceID: wsUUID,
	})
	if err != nil {
		if isNotFound(err) {
			writeError(w, http.StatusNotFound, "wiki page not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to get wiki page")
		return
	}

	actorType, actorID := h.resolveActor(r, userID, workspaceID)
	actorUUID, ok := parseUUIDOrBadRequest(w, actorID, "actor id")
	if !ok {
		return
	}

	// Begin transaction: revision + page update must be atomic.
	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to start transaction")
		return
	}
	defer tx.Rollback(r.Context())
	qtx := h.Queries.WithTx(tx)

	// Create a merged revision.
	rev, err := qtx.CreateWikiRevision(r.Context(), db.CreateWikiRevisionParams{
		PageID:         pageUUID,
		WorkspaceID:    wsUUID,
		Title:          req.Title,
		Content:        req.Content,
		BaseRevisionID: page.CurrentRevisionID,
		AuthorType:     actorType,
		AuthorID:       actorUUID,
		Status:         "merged",
		Summary:        strToText(req.Summary),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create revision")
		return
	}

	// Update the page with the new content and current_revision_id.
	updated, err := qtx.UpdateWikiPageContent(r.Context(), db.UpdateWikiPageContentParams{
		ID:                pageUUID,
		WorkspaceID:       wsUUID,
		Title:             req.Title,
		Content:           req.Content,
		CurrentRevisionID: rev.ID,
		UpdatedByType:     actorType,
		UpdatedByID:       actorUUID,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update wiki page")
		return
	}

	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to commit update")
		return
	}

	writeJSON(w, http.StatusOK, wikiPageToResponse(updated))
	h.publish(protocol.EventWikiChanged, workspaceID, actorType, actorID, map[string]any{"page_id": uuidToString(updated.ID)})
}

// ArchiveWikiPage handles DELETE /api/wiki/pages/{pageId}.
func (h *Handler) ArchiveWikiPage(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}

	workspaceID := h.resolveWorkspaceID(r)
	if workspaceID == "" {
		writeError(w, http.StatusBadRequest, "workspace_id is required")
		return
	}

	pageID := chi.URLParam(r, "pageId")
	pageUUID, ok := parseUUIDOrBadRequest(w, pageID, "page id")
	if !ok {
		return
	}

	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return
	}

	// Pre-flight: ensure the page exists before archiving.
	if _, err := h.Queries.GetWikiPage(r.Context(), db.GetWikiPageParams{
		ID:          pageUUID,
		WorkspaceID: wsUUID,
	}); err != nil {
		if isNotFound(err) {
			writeError(w, http.StatusNotFound, "wiki page not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to get wiki page")
		return
	}

	if err := h.Queries.ArchiveWikiPage(r.Context(), db.ArchiveWikiPageParams{
		ID:          pageUUID,
		WorkspaceID: wsUUID,
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to archive wiki page")
		return
	}

	actorType, actorID := h.resolveActor(r, userID, workspaceID)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	h.publish(protocol.EventWikiChanged, workspaceID, actorType, actorID, map[string]any{"page_id": pageID})
}

// ProposeWikiRevisionRequest is the request body for proposing a revision.
type ProposeWikiRevisionRequest struct {
	Title   string `json:"title"`
	Content string `json:"content"`
	Summary string `json:"summary"`
}

// ProposeWikiRevision handles POST /api/wiki/pages/{pageId}/revisions.
// Creates a proposed revision (by member or agent). On agent proposal, creates
// an inbox notification for the workspace owner (best-effort).
func (h *Handler) ProposeWikiRevision(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}

	workspaceID := h.resolveWorkspaceID(r)
	if workspaceID == "" {
		writeError(w, http.StatusBadRequest, "workspace_id is required")
		return
	}

	pageID := chi.URLParam(r, "pageId")
	pageUUID, ok := parseUUIDOrBadRequest(w, pageID, "page id")
	if !ok {
		return
	}

	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return
	}

	var req ProposeWikiRevisionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Load the current page to get BaseRevisionID.
	page, err := h.Queries.GetWikiPage(r.Context(), db.GetWikiPageParams{
		ID:          pageUUID,
		WorkspaceID: wsUUID,
	})
	if err != nil {
		if isNotFound(err) {
			writeError(w, http.StatusNotFound, "wiki page not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to get wiki page")
		return
	}

	actorType, actorID := h.resolveActor(r, userID, workspaceID)
	actorUUID, ok := parseUUIDOrBadRequest(w, actorID, "actor id")
	if !ok {
		return
	}

	rev, err := h.Queries.CreateWikiRevision(r.Context(), db.CreateWikiRevisionParams{
		PageID:         pageUUID,
		WorkspaceID:    wsUUID,
		Title:          req.Title,
		Content:        req.Content,
		BaseRevisionID: page.CurrentRevisionID,
		AuthorType:     actorType,
		AuthorID:       actorUUID,
		Status:         "proposed",
		Summary:        strToText(req.Summary),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create revision")
		return
	}

	// Best-effort inbox notification for agent proposals.
	if actorType == "agent" {
		h.notifyAgentWikiProposal(r, wsUUID, workspaceID, actorUUID, actorID, page, rev)
	}

	writeJSON(w, http.StatusCreated, wikiRevisionToResponse(rev))
	h.publish(protocol.EventWikiChanged, workspaceID, actorType, actorID, map[string]any{"page_id": uuidToString(rev.PageID)})
}

// notifyAgentWikiProposal creates an inbox item for the workspace owner when an agent
// proposes a wiki revision. This is best-effort — errors are logged but do not fail the request.
func (h *Handler) notifyAgentWikiProposal(r *http.Request, wsUUID pgtype.UUID, workspaceID string, agentUUID pgtype.UUID, agentID string, page db.WikiPage, rev db.WikiRevision) {
	ownerUserID, err := h.Queries.GetWorkspaceOwnerUserID(r.Context(), wsUUID)
	if err != nil {
		slog.Warn("wiki: could not find workspace owner for inbox notify", "workspace_id", workspaceID, "error", err)
		return
	}

	summary := ""
	if rev.Summary.Valid {
		summary = rev.Summary.String
	}

	details, _ := json.Marshal(map[string]any{
		"wiki_page_id":     uuidToString(page.ID),
		"wiki_revision_id": uuidToString(rev.ID),
		"page_title":       page.Title,
	})

	item, err := h.Queries.CreateInboxItem(r.Context(), db.CreateInboxItemParams{
		WorkspaceID:   wsUUID,
		RecipientType: "member",
		RecipientID:   ownerUserID,
		Type:          "wiki_proposal",
		Severity:      "action_required",
		Title:         "Agent proposed an edit: " + page.Title,
		Body:          strToText(summary),
		ActorType:     strToText("agent"),
		ActorID:       agentUUID,
		Details:       details,
	})
	if err != nil {
		slog.Warn("wiki: failed to create inbox item for agent proposal", "error", err)
		return
	}

	resp := inboxToResponse(item)
	h.publish(protocol.EventInboxNew, workspaceID, "agent", agentID, map[string]any{"item": resp})
}

// MergeWikiRevision handles POST /api/wiki/revisions/{revId}/merge.
// Applies a proposed revision to the live page and marks it as merged.
func (h *Handler) MergeWikiRevision(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}

	workspaceID := h.resolveWorkspaceID(r)
	if workspaceID == "" {
		writeError(w, http.StatusBadRequest, "workspace_id is required")
		return
	}

	revID := chi.URLParam(r, "revId")
	revUUID, ok := parseUUIDOrBadRequest(w, revID, "revision id")
	if !ok {
		return
	}

	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return
	}

	rev, err := h.Queries.GetWikiRevision(r.Context(), db.GetWikiRevisionParams{
		ID:          revUUID,
		WorkspaceID: wsUUID,
	})
	if err != nil {
		if isNotFound(err) {
			writeError(w, http.StatusNotFound, "revision not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to get revision")
		return
	}

	if rev.Status != "proposed" {
		writeError(w, http.StatusConflict, "only proposed revisions can be merged")
		return
	}

	_, actorID := h.resolveActor(r, userID, workspaceID)
	reviewerUUID, ok := parseUUIDOrBadRequest(w, actorID, "reviewer id")
	if !ok {
		return
	}

	// Begin transaction: status change + page update must be atomic.
	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to start transaction")
		return
	}
	defer tx.Rollback(r.Context())
	qtx := h.Queries.WithTx(tx)

	merged, err := qtx.SetWikiRevisionStatus(r.Context(), db.SetWikiRevisionStatusParams{
		ID:           revUUID,
		WorkspaceID:  wsUUID,
		Status:       "merged",
		ReviewedByID: reviewerUUID,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to merge revision")
		return
	}

	// Apply the revision content to the page.
	_, err = qtx.UpdateWikiPageContent(r.Context(), db.UpdateWikiPageContentParams{
		ID:                rev.PageID,
		WorkspaceID:       wsUUID,
		Title:             rev.Title,
		Content:           rev.Content,
		CurrentRevisionID: rev.ID,
		UpdatedByType:     "member",
		UpdatedByID:       reviewerUUID,
	})
	if err != nil {
		if isNotFound(err) {
			writeError(w, http.StatusConflict, "cannot merge: wiki page is archived")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to update page after merge")
		return
	}

	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to commit merge")
		return
	}

	writeJSON(w, http.StatusOK, wikiRevisionToResponse(merged))
	h.publish(protocol.EventWikiChanged, workspaceID, "member", actorID, map[string]any{"page_id": uuidToString(rev.PageID)})
}

// RejectWikiRevision handles POST /api/wiki/revisions/{revId}/reject.
func (h *Handler) RejectWikiRevision(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}

	workspaceID := h.resolveWorkspaceID(r)
	if workspaceID == "" {
		writeError(w, http.StatusBadRequest, "workspace_id is required")
		return
	}

	revID := chi.URLParam(r, "revId")
	revUUID, ok := parseUUIDOrBadRequest(w, revID, "revision id")
	if !ok {
		return
	}

	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return
	}

	rev, err := h.Queries.GetWikiRevision(r.Context(), db.GetWikiRevisionParams{
		ID:          revUUID,
		WorkspaceID: wsUUID,
	})
	if err != nil {
		if isNotFound(err) {
			writeError(w, http.StatusNotFound, "revision not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to get revision")
		return
	}

	if rev.Status != "proposed" {
		writeError(w, http.StatusConflict, "revision is not pending review")
		return
	}

	_, actorID := h.resolveActor(r, userID, workspaceID)
	reviewerUUID, ok := parseUUIDOrBadRequest(w, actorID, "reviewer id")
	if !ok {
		return
	}

	rejected, err := h.Queries.SetWikiRevisionStatus(r.Context(), db.SetWikiRevisionStatusParams{
		ID:           revUUID,
		WorkspaceID:  wsUUID,
		Status:       "rejected",
		ReviewedByID: reviewerUUID,
	})
	if err != nil {
		if isNotFound(err) {
			writeError(w, http.StatusNotFound, "revision not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to reject revision")
		return
	}

	writeJSON(w, http.StatusOK, wikiRevisionToResponse(rejected))
	h.publish(protocol.EventWikiChanged, workspaceID, "member", actorID, map[string]any{"page_id": uuidToString(rev.PageID)})
}
