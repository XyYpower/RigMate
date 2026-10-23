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
        meta={build ? `${build.name} · ${build.items.length} 配件 · 更新于 ${formatTime(build.updatedAt)}` : "逐件录入，规则逐条核验"}
        summary={findings.length > 0 ? <span className="header-budget-summary">{findings.length} 条检查结论</span> : undefined}
      />
      <ProjectBar diy={diy} />

      <section className="titleline">
        <div className="titleline-main">
          <h2>{build ? build.name : "高级 DIY"}</h2>
          <p className="titleline-sub">
            {build
              ? `用途 ${build.useCase ?? "未设置"} · 更新于 ${formatTime(build.updatedAt)}`
              : "在上方填写项目名称并新建，数据会实时保存到 SQLite"}
          </p>
          {build && findings.length > 0 && (
            <span className="diy-autocheck-badge"><i aria-hidden />自动检查已开启</span>
          )}
        </div>
        <div className="titleline-actions">
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

      {/* 底部状态条（参考图）：检查历史摘要 + 计数 + 查看报告 */}
      {build && (
        <section className="diy-bottombar" aria-label="检查状态">
          <span className="diy-bottombar-history">
            检查历史 {diy.checkHistory.length > 0 ? `${diy.checkHistory.length} 次` : "· 暂无"}
            {resultMeta && <> · 最近 {resultMeta.time}</>}
          </span>
          <span className="diy-bottombar-counts">
            <em className="block">{counts.block} 项阻断</em> · <em className="warn">{counts.unknown} 项待补充</em> · <em className="warn">{counts.warn} 项警告</em> · <em className="pass">{counts.pass} 项通过</em>
          </span>
          <div className="diy-bottombar-actions">
            <a className="button secondary" href={`/builds/${build.id}/report`}>
              查看报告 <ArrowUpRight size={13} aria-hidden />
            </a>
          </div>
        </section>
      )}

      <footer className="footer">
        <span className="footer-brand">RIGMATE / 先确认能装，再决定买什么</span>
        {/* 操作反馈移至表单按钮旁（form-feedback）：footer 在页面底端，用户看不见 */}
      </footer>
    </main>
  );
}
