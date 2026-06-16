export interface WikiPage {
  id: string; workspace_id: string; parent_id: string | null;
  current_revision_id: string | null;
  title: string; slug: string; content: string; position: number;
  created_by_type: "member" | "agent"; created_by_id: string;
  updated_by_type: "member" | "agent"; updated_by_id: string;
  created_at: string; updated_at: string; archived_at?: string | null;
}

export type WikiRevisionStatus = "merged" | "proposed" | "rejected";

export interface WikiRevision {
  id: string; page_id: string; workspace_id: string;
  title: string; content: string; base_revision_id: string | null;
  author_type: "member" | "agent"; author_id: string;
  status: WikiRevisionStatus; summary: string | null;
  reviewed_by_id: string | null; reviewed_at: string | null; created_at: string;
}

export interface WikiPageTreeNode extends WikiPage { children: WikiPageTreeNode[] }
