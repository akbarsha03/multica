import type { QueryClient } from "@tanstack/react-query";
import { wikiKeys } from "./queries";

export function onWikiChanged(qc: QueryClient, wsId: string) {
  qc.invalidateQueries({ queryKey: wikiKeys.all(wsId) });
}
