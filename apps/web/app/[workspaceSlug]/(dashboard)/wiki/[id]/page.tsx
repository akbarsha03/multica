"use client";

import { use } from "react";
import { WikiDetail } from "@multica/views/wiki/components";
import { ErrorBoundary } from "@multica/ui/components/common/error-boundary";

export default function WikiDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <ErrorBoundary resetKeys={[id]}>
      <WikiDetail pageId={id} />
    </ErrorBoundary>
  );
}
