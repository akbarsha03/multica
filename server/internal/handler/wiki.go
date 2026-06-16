package handler

import (
	"encoding/json"
	"net/http"
	"regexp"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
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
		writeError(w, http.StatusInternalServerError, "failed to create wiki page")
		return
	}

	writeJSON(w, http.StatusOK, wikiPageToResponse(page))
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

	pageID := chi.URLParam(r, "pageId")
	pageUUID, ok := parseUUIDOrBadRequest(w, pageID, "page id")
	if !ok {
		return
	}

	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return
	}

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

	writeJSON(w, http.StatusOK, wikiPageToResponse(page))
}
