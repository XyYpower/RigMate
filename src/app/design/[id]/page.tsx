"use client";

import { Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { DesignSessionView } from "@/ui/session/session-view";
import { DesignWorkbenchView } from "@/ui/session/design-workbench";

/**
 * /design/[id]（agent-ui-design §5.3，P2）：默认会话时间线视图；
 * ?view=workbench 保留完整工作台（核验台 / 逐行依据 / 版本对比）。
 */
export default function DesignPageRoute() {
  return (
    <Suspense
      fallback={
        <main className="session-page">
          <p className="session-loading" role="status">正在载入会话…</p>
        </main>
      }
    >
      <DesignRouteInner />
    </Suspense>
  );
}

function DesignRouteInner() {
  const params = useSearchParams();
  const { id } = useParams<{ id: string }>();
  if (params.get("view") === "workbench") return <DesignWorkbenchView />;
  return <DesignSessionView requestId={id} />;
}
