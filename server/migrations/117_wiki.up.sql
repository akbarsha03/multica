-- Per-workspace wiki. wiki_page is the live page + tree; wiki_revision holds
-- every version AND every proposed edit (status encodes which). Humans edit
-- live (status='merged'); agents may only create status='proposed' revisions
-- that a human reviews. Mirrors the comment table's author_type convention.
CREATE TABLE wiki_page (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id        UUID NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    parent_id           UUID REFERENCES wiki_page(id) ON DELETE CASCADE,
    title               TEXT NOT NULL,
    slug                TEXT NOT NULL,
    content             TEXT NOT NULL DEFAULT '',
    position            INTEGER NOT NULL DEFAULT 0,
    current_revision_id UUID,
    created_by_type     TEXT NOT NULL CHECK (created_by_type IN ('member','agent')),
    created_by_id       UUID NOT NULL,
    updated_by_type     TEXT NOT NULL CHECK (updated_by_type IN ('member','agent')),
    updated_by_id       UUID NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at         TIMESTAMPTZ
);
CREATE INDEX idx_wiki_page_workspace ON wiki_page(workspace_id) WHERE archived_at IS NULL;
CREATE INDEX idx_wiki_page_parent ON wiki_page(parent_id);
CREATE UNIQUE INDEX idx_wiki_page_workspace_slug ON wiki_page(workspace_id, slug) WHERE archived_at IS NULL;

CREATE TABLE wiki_revision (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    page_id          UUID NOT NULL REFERENCES wiki_page(id) ON DELETE CASCADE,
    workspace_id     UUID NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    title            TEXT NOT NULL,
    content          TEXT NOT NULL,
    base_revision_id UUID REFERENCES wiki_revision(id),
    author_type      TEXT NOT NULL CHECK (author_type IN ('member','agent')),
    author_id        UUID NOT NULL,
    status           TEXT NOT NULL CHECK (status IN ('merged','proposed','rejected')),
    summary          TEXT,
    reviewed_by_id   UUID,
    reviewed_at      TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_wiki_revision_page_status ON wiki_revision(page_id, status);
CREATE INDEX idx_wiki_revision_workspace_status ON wiki_revision(workspace_id, status);

ALTER TABLE wiki_page
    ADD CONSTRAINT fk_wiki_page_current_revision
    FOREIGN KEY (current_revision_id) REFERENCES wiki_revision(id);
