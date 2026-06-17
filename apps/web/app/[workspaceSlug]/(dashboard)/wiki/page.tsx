"use client";

import { WikiEmptyState } from "@multica/views/wiki/components";
import { ErrorBoundary } from "@multica/ui/components/common/error-boundary";

export default function Page() {
  return (
    <ErrorBoundary>
      <WikiEmptyState />
    </ErrorBoundary>
  );
}
