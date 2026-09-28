import type { ReactNode } from "react";
import { BrandSidebar } from "./brand-sidebar";

/**
 * 三栏工作台壳（DESIGN.md §4）：左 220 导航 / 主区自适应 / 右 340 上下文。
 * aside 为空时主区独占（首页、资料页）；<900px 全部单列（CSS 负责）。
 */
export function WorkbenchShell({
  children,
  aside,
}: {
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className={`workbench-shell${aside ? " has-aside" : ""}`}>
      <BrandSidebar />
      <div className="workbench-main">{children}</div>
      {aside && <aside className="workbench-aside">{aside}</aside>}
    </div>
  );
}
