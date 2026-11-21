"use client";

import { ArrowUpRight, RefreshCw } from "lucide-react";
import { CATEGORY_META, CATEGORY_ORDER } from "@/ui/category-form";
import { SizeCompare } from "@/ui/workbench/size-compare";
import { WorkspaceHeader } from "@/ui/workbench/workspace-header";
import { formatTime } from "./types";
import { useDiyProjects } from "./use-diy-projects";
import { ProjectBar } from "./project-bar";
import { BudgetSummarySection } from "./budget-summary-section";
import { PartsListSection } from "./parts-list-section";
import { ItemEntrySection } from "./item-entry-section";
import { DiagnosticsAside } from "./diagnostics-aside";

/**
 * 高级 DIY 工作台（拆分自原 945 行单文件，行为不变）：
 * 状态与动作集中在 useDiyProjects；区块组件只读 + 回调。
 * 结构：项目栏 → 标题行 → 预算数据行/余量尺 → 清单+录入（左） / 诊断（右） → 底部状态条。
 */
export default function Home() {
  const diy = useDiyProjects();
  const { build, findings, resultMeta, busy, itemCategory, setItemCategory, counts } = diy;
  const summary = build?.budgetSummary;

  return (
    <main className="shell">
      <WorkspaceHeader
        title="高级 DIY"
        meta={build ? `${build.name} · ${build.items.length} 配件` : undefined}
        summary={findings.length > 0 ? <span className="header-budget-summary">{findings.length} 条检查结论</span> : undefined}
      />
      <ProjectBar diy={diy} />

      {/* 紧凑状态带（hallmark v4）：签名物清单的状态一目一行 */}
      <section className="titleline diy-statusline">
        <div className="titleline-main">
          <h2>{build ? build.name : "高级 DIY"}</h2>
          <p className="titleline-sub">
            {build
              ? `${build.useCase ?? "未设置"} · 更新于 ${formatTime(build.updatedAt)}`
              : "还没有项目，在上方新建即可开始"}
          </p>
          {build && findings.length > 0 && (
            <span className="diy-autocheck-badge"><i aria-hidden />自动检查已开启</span>
          )}
        </div>
        <div className="titleline-actions">
          {build && (
            <a className="button secondary" href={`/builds/${build.id}/report`}>
              查看报告 <ArrowUpRight size={13} aria-hidden />
            </a>
          )}
          <button
            className="button primary check-button"
            onClick={diy.runCheck}
            disabled={!build || build.items.length === 0 || busy}
          >
            重新检查 <RefreshCw size={14} aria-hidden />
          </button>
        </div>
      </section>

      {summary && <BudgetSummarySection summary={summary} itemCount={build?.items.length ?? 0} />}

      <div className="sheet diy-grid">
        {/* 参考图：左侧类别子导航 */}
        <nav className="diy-subnav" role="tablist" aria-label="配件类别">
          {CATEGORY_ORDER.map((category) => (
            <button
              key={category}
              role="tab"
              aria-selected={itemCategory === category}
              className={`diy-subnav-item ${itemCategory === category ? "active" : ""}`}
              onClick={() => {
                diy.exitEditOnCategorySwitch();
                setItemCategory(category);
              }}
              disabled={busy}
            >
              {CATEGORY_META[category].label}
            </button>
          ))}
        </nav>
        <div className="diy-main">
          {/* 规格表 */}
          <PartsListSection build={build} diy={diy} />

          {/* 尺寸核对（参考图"机箱 & 显卡侧视图"）：数据齐才显示对比条 */}
          <SizeCompare items={build?.items ?? []} />

          {/* 配件录入 */}
          <ItemEntrySection diy={diy} />
        </div>

        {/* 诊断：参考图右栏 */}
        <DiagnosticsAside diy={diy} />
      </div>

    </main>
  );
}
