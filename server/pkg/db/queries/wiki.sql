-- name: ListWikiPages :many
SELECT * FROM wiki_page
WHERE workspace_id = $1 AND archived_at IS NULL
ORDER BY position ASC, created_at ASC;

-- name: GetWikiPage :one
SELECT * FROM wiki_page
WHERE id = $1 AND workspace_id = $2 AND archived_at IS NULL;

-- name: GetWikiPageBySlug :one
SELECT * FROM wiki_page
WHERE workspace_id = $1 AND slug = $2 AND archived_at IS NULL;

-- name: CreateWikiPage :one
INSERT INTO wiki_page (
    workspace_id, parent_id, title, slug, content, position,
    created_by_type, created_by_id, updated_by_type, updated_by_id
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $7, $8)
RETURNING *;

-- name: UpdateWikiPageContent :one
UPDATE wiki_page
SET title = $3, content = $4, current_revision_id = $5,
    updated_by_type = $6, updated_by_id = $7, updated_at = now()
WHERE id = $1 AND workspace_id = $2 AND archived_at IS NULL
RETURNING *;

-- name: MoveWikiPage :one
UPDATE wiki_page
SET parent_id = $3, position = $4, updated_at = now()
WHERE id = $1 AND workspace_id = $2 AND archived_at IS NULL
RETURNING *;

-- name: ArchiveWikiPage :exec
UPDATE wiki_page SET archived_at = now(), updated_at = now()
WHERE id = $1 AND workspace_id = $2;

-- name: CreateWikiRevision :one
INSERT INTO wiki_revision (
    page_id, workspace_id, title, content, base_revision_id,
    author_type, author_id, status, summary
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
RETURNING *;

-- name: ListWikiRevisionsForPage :many
SELECT * FROM wiki_revision
WHERE page_id = $1 AND workspace_id = $2
ORDER BY created_at DESC;

-- name: ListProposedWikiRevisions :many
SELECT * FROM wiki_revision
WHERE workspace_id = $1 AND status = 'proposed'
ORDER BY created_at DESC;

-- name: GetWikiRevision :one
SELECT * FROM wiki_revision
WHERE id = $1 AND workspace_id = $2;

-- name: SetWikiRevisionStatus :one
UPDATE wiki_revision
SET status = $3, reviewed_by_id = $4, reviewed_at = now()
WHERE id = $1 AND workspace_id = $2
RETURNING *;
