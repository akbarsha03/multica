package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func createWikiPage(t *testing.T, title, content string) WikiPageResponse {
	t.Helper()
	w := httptest.NewRecorder()
	r := newRequest("POST", "/api/wiki/pages", CreateWikiPageRequest{Title: title, Content: content})
	testHandler.CreateWikiPage(w, r)
	if w.Code != http.StatusCreated {
		t.Fatalf("create page: want 201, got %d (%s)", w.Code, w.Body.String())
	}
	var resp WikiPageResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return resp
}

func TestCreateAndListWikiPages(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}
	page := createWikiPage(t, "Standards", "# Conventions")
	if page.ID == "" || page.Title != "Standards" {
		t.Fatalf("unexpected page: %+v", page)
	}
	w := httptest.NewRecorder()
	r := newRequest("GET", "/api/wiki/pages", nil)
	testHandler.ListWikiPages(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("list: want 200, got %d", w.Code)
	}
	var list struct {
		Pages []WikiPageResponse `json:"pages"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &list); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	found := false
	for _, p := range list.Pages {
		if p.ID == page.ID {
			found = true
		}
	}
	if !found {
		t.Fatalf("created page not in list")
	}
}
