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

func TestUpdateWikiPageCreatesMergedRevision(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}
	page := createWikiPage(t, "Runbook", "v1")
	w := httptest.NewRecorder()
	r := newRequest("PATCH", "/api/wiki/pages/"+page.ID, UpdateWikiPageRequest{Title: "Runbook", Content: "v2"})
	r = withURLParam(r, "pageId", page.ID)
	testHandler.UpdateWikiPage(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("update: want 200, got %d (%s)", w.Code, w.Body.String())
	}
	var updated WikiPageResponse
	if err := json.Unmarshal(w.Body.Bytes(), &updated); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if updated.Content != "v2" || updated.CurrentRevisionID == nil {
		t.Fatalf("want content v2 + current_revision set, got %+v", updated)
	}
	hw := httptest.NewRecorder()
	hr := newRequest("GET", "/api/wiki/pages/"+page.ID+"/revisions", nil)
	hr = withURLParam(hr, "pageId", page.ID)
	testHandler.ListWikiRevisions(hw, hr)
	var hist struct {
		Revisions []WikiRevisionResponse `json:"revisions"`
	}
	if err := json.Unmarshal(hw.Body.Bytes(), &hist); err != nil {
		t.Fatalf("decode hist: %v", err)
	}
	if len(hist.Revisions) == 0 || hist.Revisions[0].Status != "merged" {
		t.Fatalf("want a merged revision, got %+v", hist.Revisions)
	}
}

func TestProposeThenMergeRevision(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}
	page := createWikiPage(t, "Arch Doc", "base")
	pw := httptest.NewRecorder()
	pr := newRequest("POST", "/api/wiki/pages/"+page.ID+"/revisions", ProposeWikiRevisionRequest{Title: "Arch Doc", Content: "improved", Summary: "tighten"})
	pr = withURLParam(pr, "pageId", page.ID)
	testHandler.ProposeWikiRevision(pw, pr)
	if pw.Code != http.StatusCreated {
		t.Fatalf("propose: want 201, got %d (%s)", pw.Code, pw.Body.String())
	}
	var rev WikiRevisionResponse
	if err := json.Unmarshal(pw.Body.Bytes(), &rev); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if rev.Status != "proposed" {
		t.Fatalf("want proposed, got %s", rev.Status)
	}
	mw := httptest.NewRecorder()
	mr := newRequest("POST", "/api/wiki/revisions/"+rev.ID+"/merge", nil)
	mr = withURLParam(mr, "revId", rev.ID)
	testHandler.MergeWikiRevision(mw, mr)
	if mw.Code != http.StatusOK {
		t.Fatalf("merge: want 200, got %d (%s)", mw.Code, mw.Body.String())
	}
	gw := httptest.NewRecorder()
	gr := newRequest("GET", "/api/wiki/pages/"+page.ID, nil)
	gr = withURLParam(gr, "pageId", page.ID)
	testHandler.GetWikiPage(gw, gr)
	var got WikiPageResponse
	if err := json.Unmarshal(gw.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.Content != "improved" {
		t.Fatalf("want merged content 'improved', got %q", got.Content)
	}
}

func TestRequireHumanActorBlocksTaskToken(t *testing.T) {
	req := newRequest("POST", "/api/wiki/revisions/x/merge", nil)
	req.Header.Set("X-Actor-Source", "task_token")
	rec := httptest.NewRecorder()
	RequireHumanActor(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) })).ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for task_token, got %d", rec.Code)
	}
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

func TestRejectNonProposedRevisionConflict(t *testing.T) {
	if testHandler == nil || testPool == nil { t.Skip("database not available") }
	page := createWikiPage(t, "Guarded Doc", "base")
	// propose
	pw := httptest.NewRecorder()
	pr := newRequest("POST", "/api/wiki/pages/"+page.ID+"/revisions", ProposeWikiRevisionRequest{Title: "Guarded Doc", Content: "x", Summary: "s"})
	pr = withURLParam(pr, "pageId", page.ID)
	testHandler.ProposeWikiRevision(pw, pr)
	if pw.Code != http.StatusCreated { t.Fatalf("propose: %d (%s)", pw.Code, pw.Body.String()) }
	var rev WikiRevisionResponse
	if err := json.Unmarshal(pw.Body.Bytes(), &rev); err != nil { t.Fatalf("decode: %v", err) }
	// merge it
	mw := httptest.NewRecorder()
	mr := newRequest("POST", "/api/wiki/revisions/"+rev.ID+"/merge", nil)
	mr = withURLParam(mr, "revId", rev.ID)
	testHandler.MergeWikiRevision(mw, mr)
	if mw.Code != http.StatusOK { t.Fatalf("merge: %d", mw.Code) }
	// now reject the already-merged revision → expect 409
	rw := httptest.NewRecorder()
	rr := newRequest("POST", "/api/wiki/revisions/"+rev.ID+"/reject", nil)
	rr = withURLParam(rr, "revId", rev.ID)
	testHandler.RejectWikiRevision(rw, rr)
	if rw.Code != http.StatusConflict { t.Fatalf("reject merged: want 409, got %d (%s)", rw.Code, rw.Body.String()) }
}

func TestArchiveNonexistentPage404(t *testing.T) {
	if testHandler == nil || testPool == nil { t.Skip("database not available") }
	w := httptest.NewRecorder()
	r := newRequest("DELETE", "/api/wiki/pages/00000000-0000-0000-0000-000000000000", nil)
	r = withURLParam(r, "pageId", "00000000-0000-0000-0000-000000000000")
	testHandler.ArchiveWikiPage(w, r)
	if w.Code != http.StatusNotFound { t.Fatalf("archive unknown: want 404, got %d", w.Code) }
}
