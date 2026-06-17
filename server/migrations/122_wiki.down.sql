ALTER TABLE wiki_page DROP CONSTRAINT IF EXISTS fk_wiki_page_current_revision;
DROP TABLE IF EXISTS wiki_revision;
DROP TABLE IF EXISTS wiki_page;
