"use client";

import { Suspense } from "react";
import { ProjectsPageInner } from "./projects-inner";

/** /projects（我的方案）：Suspense 包裹 useSearchParams（Next app router 要求）。 */
export default function ProjectsPage() {
  return (
    <Suspense fallback={null}>
      <ProjectsPageInner />
    </Suspense>
  );
}
