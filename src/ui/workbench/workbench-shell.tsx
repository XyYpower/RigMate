import type { ReactNode } from "react";
import { BrandSidebar } from "./brand-sidebar";

/**
 * 三栏工作台壳（DESIGN.md §4）：左 220 导航 / 主区自适应 / 右 340 上下文。
 * DOM 顺序主内容先于上下文栏（读屏与窄屏单列时主任务优先）。
 * aside 为空时主区独占（首页、资料页）；<900px 全部单列（CSS 负责）。
 */
export function WorkbenchShell({
  children,
  aside,
  asideTitle,
}: {
  children: ReactNode;
  aside?: ReactNode;
  /** 上下文栏语义标题（方案页为"核验台"） */
  asideTitle?: string;
}) {
  return (
    <div className={`workbench-shell${aside ? " has-aside" : ""}`}>
      <BrandSidebar />
      <div className="workbench-main">{children}</div>
      {aside && (
        <aside className="workbench-aside" aria-label={asideTitle ?? "上下文"}>
          {asideTitle && <h2 className="workbench-aside-title">{asideTitle}</h2>}
          {aside}
        </aside>
      )}
    </div>
  );
}
