"use client";

import { WikiPage } from "@multica/views/wiki/components";
import { ErrorBoundary } from "@multica/ui/components/common/error-boundary";

export default function Page() {
  return (
    <ErrorBoundary>
      <WikiPage />
    </ErrorBoundary>
  );
}
