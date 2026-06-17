"use client";

import type { ReactNode } from "react";
import { useParams } from "next/navigation";
import { WikiShell } from "@multica/views/wiki/components";

// Persistent shell for /wiki and /wiki/[id]: the tree stays mounted on the
// left while the routed page renders in the right pane. The active page id
// comes from the [id] route param (undefined on /wiki).
export default function WikiLayout({ children }: { children: ReactNode }) {
  const params = useParams();
  const activeId = typeof params?.id === "string" ? params.id : undefined;
  return <WikiShell activeId={activeId}>{children}</WikiShell>;
}
