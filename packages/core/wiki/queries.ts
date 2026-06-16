import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";

// Wiki pages can change server-side (an agent runs `multica wiki page create`,
// or another member edits) with no WS push to this client. Without this, an
// open /wiki tab keeps showing a list it fetched before the change. Force a
// refetch whenever the view is (re)mounted or the tab regains focus so the
// freshly-created/edited content shows up.
const liveRefetch = {
  staleTime: 0,
  refetchOnMount: "always" as const,
  refetchOnWindowFocus: true,
};

export const wikiKeys = {
  all: (wsId: string) => ["wiki", wsId] as const,
  pages: (wsId: string) => [...wikiKeys.all(wsId), "pages"] as const,
  page: (wsId: string, id: string) => [...wikiKeys.all(wsId), "page", id] as const,
  revisions: (wsId: string, pageId: string) => [...wikiKeys.all(wsId), "revisions", pageId] as const,
  proposals: (wsId: string) => [...wikiKeys.all(wsId), "proposals"] as const,
};

export function wikiPagesOptions(wsId: string) {
  return queryOptions({
    queryKey: wikiKeys.pages(wsId),
    queryFn: () => api.listWikiPages(),
    select: (r) => r.pages,
    ...liveRefetch,
  });
}

export function wikiPageOptions(wsId: string, id: string) {
  return queryOptions({
    queryKey: wikiKeys.page(wsId, id),
    queryFn: () => api.getWikiPage(id),
    ...liveRefetch,
  });
}

export function wikiRevisionsOptions(wsId: string, pageId: string) {
  return queryOptions({
    queryKey: wikiKeys.revisions(wsId, pageId),
    queryFn: () => api.listWikiRevisions(pageId),
    select: (r) => r.revisions,
    ...liveRefetch,
  });
}

export function wikiProposalsOptions(wsId: string) {
  return queryOptions({
    queryKey: wikiKeys.proposals(wsId),
    queryFn: () => api.listWikiProposals(),
    select: (r) => r.proposals,
    ...liveRefetch,
  });
}
