"use client";

import { useEffect, useMemo, useState } from "react";
import {
  buildSpecPayload,
  CATEGORY_META,
  CATEGORY_ORDER,
  hasAnySpec,
  specToFormValues,
  type FieldDef,
  type ItemSpec,
} from "@/ui/category-form";
import { FindingCard } from "@/ui/components/finding-card";
import { StatusChip } from "@/ui/components/status-chip";
import type { BudgetSummary, Finding, FindingStatus } from "@/domain/build/types";

type Category = keyof typeof CATEGORY_META;

type Item = {
  id: string;
  category: Category;
  label: string;
  spec: ItemSpec;
  priceCents?: number;
};

type Build = {
  id: string;
  name: string;
  useCase: string | null;
  status: string;
  updatedAt: string;
  budgetCents: number | null;
  budgetSummary?: BudgetSummary;
  items: Item[];
};

type CategoryDraft = { label: string; price: string; fields: Record<string, string> };

const EMPTY_DRAFT: CategoryDraft = { label: "", price: "", fields: {} };

function latestFirst(builds: Build[]): Build[] {
  return [...builds].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatYuan(cents: number): string {
  return `¥${(cents / 100).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
}

/** 预算余量计（业务规格 §10.1 + 设计稿 §6.3）：PSU 余量表语言——预算=额定，已计价=当前功耗，未计价=幽灵区间 */
function BudgetMeter({ summary, itemCount }: { summary: BudgetSummary; itemCount: number }) {
  const hasBudget = summary.budgetCents !== null && summary.budgetCents > 0;
  const budget = summary.budgetCents ?? 0;
  const ratio = hasBudget ? Math.min(summary.pricedTotalCents / budget, 1) : 0;
  const over = hasBudget && summary.pricedTotalCents > budget;
  const difference = summary.differenceCents;

  return (
    <section className="panel meter-panel" aria-label="预算余量计">
      <div className="panel-heading">
        <div><span className="step-label">预算余量计 / BUDGET</span><h3>整机价格余量</h3></div>
        <span className="meter-index" aria-hidden>⚡</span>
      </div>
      <div className="meter-readout">
        <div className="readout">
          <span className="readout-label">预算水平线</span>
          <span className={`readout-num ${hasBudget ? "" : "muted"}`}>{hasBudget ? formatYuan(budget) : "未设置"}</span>
          <span className="readout-sub">创建项目时填写</span>
        </div>
        <div className="readout">
          <span className="readout-label">已计价</span>
          <span className="readout-num accent">{formatYuan(summary.pricedTotalCents)}</span>
          <span className="readout-sub">{summary.pricedCount} / {itemCount} 件</span>
        </div>
        <div className="readout">
          <span className="readout-label">未计价</span>
          <span className="readout-num">{summary.unpricedCount} 件</span>
          <span className="readout-sub">不按零元计入</span>
        </div>
        <div className="readout">
          <span className="readout-label">{over ? "超支" : "余量"}</span>
          <span className={`readout-num ${over ? "over" : ""} ${difference === null ? "muted" : ""}`}>
            {difference === null ? "—" : `${difference < 0 ? "−" : ""}${formatYuan(Math.abs(difference))}`}
          </span>
          <span className="readout-sub">{hasBudget ? "仅基于已计价部分" : "需要预算数据"}</span>
        </div>
      </div>
      {hasBudget ? (
        <>
          <div className="meter-bar" role="img" aria-label={`预算 ${formatYuan(budget)}，已计价 ${formatYuan(summary.pricedTotalCents)}`}>
            <div className="meter-ghost-zone" aria-hidden />
            <div className={`meter-fill ${over ? "over" : ""}`} style={{ width: `${ratio * 100}%` }} />
            <div className="meter-ticks" aria-hidden />
          </div>
          <div className="meter-scale" aria-hidden>
            <span>0</span><span>25%</span><span>50%</span><span>75%</span><span>{formatYuan(budget)}</span>
          </div>
          {summary.unpricedCount > 0 && (
            <p className="meter-ghost-note">
              斜纹区间 = 未计价 {summary.unpricedCount} 件（{summary.unpricedLabels.join("、")}），不按零元计入，差额会随补价变化。
            </p>
          )}
        </>
      ) : (
        <p className="meter-hint">
          该项目创建时未设置预算。新建项目时填写「预算（元）」，这里会显示预算水平线与已计价占比；未计价件永远不按零元计入。
        </p>
      )}
    </section>
  );
}

export default function Home() {
  const [build, setBuild] = useState<Build | null>(null);
  const [projects, setProjects] = useState<Build[]>([]);
  const [name, setName] = useState("我的第一台 DIY 主机");
  const [useCase, setUseCase] = useState("2K 游戏");
  const [budgetYuan, setBudgetYuan] = useState("");
  const [itemCategory, setItemCategory] = useState<Category>("cpu");
  const [drafts, setDrafts] = useState<Record<string, CategoryDraft>>({});
  const [findings, setFindings] = useState<Finding[]>([]);
  const [resultMeta, setResultMeta] = useState<{ time: string; stale: boolean } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [confirmItemId, setConfirmItemId] = useState<string | null>(null);
  const [message, setMessage] = useState("正在加载你的历史项目…");
  const [busy, setBusy] = useState(false);

  const meta = CATEGORY_META[itemCategory];
  const draft = drafts[itemCategory] ?? EMPTY_DRAFT;
  const fieldValues = draft.fields;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/builds");
        if (!response.ok) return;
        const data = await response.json();
        if (cancelled) return;
        const builds: Build[] = latestFirst(data.builds ?? []);
        setProjects(builds);
        const latest = builds[0];
        if (latest) {
          setBuild(latest);
          setMessage(
            `已恢复最近的项目「${latest.name}」，共 ${latest.items.length} 个配件。历史项目可在左侧切换。`,
          );
          const checkResponse = await fetch(`/api/builds/${latest.id}/check`);
          if (cancelled) return;
          if (checkResponse.ok) {
            const checkData = await checkResponse.json();
            if (checkData.check) {
              setFindings(checkData.check.findings);
              setResultMeta({
                time: new Date(checkData.check.createdAt).toLocaleString(),
                stale: Boolean(checkData.check.stale),
              });
            }
          }
        } else {
          setMessage("还没有历史项目。先创建一个项目，数据会实时保存到数据库。");
        }
      } catch {
        if (!cancelled) setMessage("无法连接服务，请确认开发服务器正在运行。");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const counts = useMemo(() => {
    const result: Record<FindingStatus, number> = {
      pass: 0,
      block: 0,
      warn: 0,
      unknown: 0,
      not_applicable: 0,
    };
    for (const finding of findings) result[finding.status] += 1;
    return result;
  }, [findings]);

  function switchProject(id: string) {
    const target = projects.find((project) => project.id === id);
    if (!target || target.id === build?.id) return;
    setBuild(target);
    setFindings([]);
    setResultMeta(null);
    setConfirmDelete(false);
    setEditingItemId(null);
    setConfirmItemId(null);
    setMessage(`已切换到项目「${target.name}」，共 ${target.items.length} 个配件。`);
    void (async () => {
      const response = await fetch(`/api/builds/${target.id}/check`);
      if (!response.ok) return;
      const data = await response.json();
      if (data.check) {
        setFindings(data.check.findings);
        setResultMeta({
          time: new Date(data.check.createdAt).toLocaleString(),
          stale: Boolean(data.check.stale),
        });
      }
    })();
  }

  async function deleteProject() {
    if (!build) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      setMessage("再点一次「确认删除」就会连同配件和检查记录一起删除。");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/builds/${build.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("删除失败");
      const remaining = latestFirst(projects.filter((project) => project.id !== build.id));
      setProjects(remaining);
      setBuild(remaining[0] ?? null);
      setFindings([]);
      setResultMeta(null);
      setConfirmDelete(false);
      setEditingItemId(null);
      setConfirmItemId(null);
      setMessage(
        remaining[0]
          ? `项目已删除。已切换到「${remaining[0].name}」。`
          : "项目已删除。当前没有其他项目。",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除失败");
    } finally {
      setBusy(false);
    }
  }

  async function createProject() {
    const budgetRaw = budgetYuan.trim();
    let budgetCents: number | undefined;
    if (budgetRaw) {
      const yuan = Number(budgetRaw);
      if (!Number.isFinite(yuan) || yuan <= 0) {
        setMessage("预算需要是大于 0 的数字（单位：元）。");
        return;
      }
      budgetCents = Math.round(yuan * 100);
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/builds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, useCase, budgetCents }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "创建失败");
      const created: Build = data.build;
      setBuild(created);
      setProjects((prev) => latestFirst([created, ...prev]));
      setFindings([]);
      setResultMeta(null);
      setConfirmDelete(false);
      setEditingItemId(null);
      setConfirmItemId(null);
      setMessage(`新项目「${created.name}」已创建并保存。旧项目仍在历史列表里，随时可以切回。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "创建失败");
    } finally {
      setBusy(false);
    }
  }

  async function addItem() {
    if (!build) return;
    const { spec, error } = buildSpecPayload(meta, draft.fields);
    if (error) {
      setMessage(error);
      return;
    }
    const price = parsePriceInput();
    if (price.error) {
      setMessage(price.error);
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/builds/${build.id}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: itemCategory, label: draft.label, spec, priceCents: price.priceCents }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "添加失败");
      const updated: Build = data.build;
      setBuild(updated);
      setProjects((prev) => prev.map((project) => (project.id === updated.id ? updated : project)));
      setDrafts((prev) => ({ ...prev, [itemCategory]: EMPTY_DRAFT }));
      if (findings.length > 0) {
        setResultMeta((prev) => (prev ? { ...prev, stale: true } : prev));
      }
      setMessage(`${meta.label} 已加入清单并保存。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "添加失败");
    } finally {
      setBusy(false);
    }
  }

  function startEdit(item: Item) {
    setItemCategory(item.category);
    setDrafts((prev) => ({
      ...prev,
      [item.category]: {
        label: item.label,
        price: typeof item.priceCents === "number" ? String(item.priceCents / 100) : "",
        fields: specToFormValues(CATEGORY_META[item.category], item.spec ?? {}),
      },
    }));
    setEditingItemId(item.id);
    setConfirmItemId(null);
    setMessage(`正在编辑「${item.label}」：改完点「保存修改」，或点「取消编辑」。`);
  }

  function cancelEdit() {
    if (!editingItemId) return;
    setDrafts((prev) => ({ ...prev, [itemCategory]: EMPTY_DRAFT }));
    setEditingItemId(null);
    setMessage("已取消编辑。");
  }

  function parsePriceInput(): { priceCents: number | undefined; error: string | null } {
    const raw = draft.price.trim();
    if (!raw) return { priceCents: undefined, error: null };
    const yuan = Number(raw);
    if (!Number.isFinite(yuan) || yuan <= 0) {
      return { priceCents: undefined, error: "价格需要是大于 0 的数字（单位：元）。" };
    }
    return { priceCents: Math.round(yuan * 100), error: null };
  }

  async function saveItem() {
    if (!build || !editingItemId) return;
    const { spec, error } = buildSpecPayload(meta, draft.fields);
    if (error) {
      setMessage(error);
      return;
    }
    const price = parsePriceInput();
    if (price.error) {
      setMessage(price.error);
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/builds/${build.id}/items/${editingItemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: draft.label, spec, priceCents: price.priceCents }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "保存失败");
      const updated: Build = data.build;
      setBuild(updated);
      setProjects((prev) => prev.map((project) => (project.id === updated.id ? updated : project)));
      setDrafts((prev) => ({ ...prev, [itemCategory]: EMPTY_DRAFT }));
      setEditingItemId(null);
      if (findings.length > 0) {
        setResultMeta((prev) => (prev ? { ...prev, stale: true } : prev));
      }
      setMessage(`「${draft.label}」的修改已保存。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function removeItem(itemId: string) {
    if (!build) return;
    if (confirmItemId !== itemId) {
      setConfirmItemId(itemId);
      setMessage("再点一次「确认删」会删除这个配件（项目保留）。");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/builds/${build.id}/items/${itemId}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "删除失败");
      const updated: Build = data.build;
      setBuild(updated);
      setProjects((prev) => prev.map((project) => (project.id === updated.id ? updated : project)));
      setConfirmItemId(null);
      if (editingItemId === itemId) {
        setEditingItemId(null);
        setDrafts((prev) => ({ ...prev, [itemCategory]: EMPTY_DRAFT }));
      }
      if (findings.length > 0) {
        setResultMeta((prev) => (prev ? { ...prev, stale: true } : prev));
      }
      setMessage("配件已删除，项目保留。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除失败");
    } finally {
      setBusy(false);
    }
  }

  async function runCheck() {
    if (!build) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/builds/${build.id}/check`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "检查失败");
      const updated: Build = data.build;
      setBuild(updated);
      setProjects((prev) => prev.map((project) => (project.id === updated.id ? updated : project)));
      setFindings(data.findings);
      setResultMeta({ time: "刚刚更新", stale: false });
      setMessage(
        data.findings.some((finding: Finding) => finding.status === "block")
          ? "检查完成：存在阻断问题，请先处理。"
          : "检查完成，结果已保存。",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "检查失败");
    } finally {
      setBusy(false);
    }
  }

  function renderField(field: FieldDef) {
    const value = fieldValues[field.key] ?? "";
    const setValue = (next: string) =>
      setDrafts((prev) => ({
        ...prev,
        [itemCategory]: {
          label: prev[itemCategory]?.label ?? "",
          price: prev[itemCategory]?.price ?? "",
          fields: { ...(prev[itemCategory]?.fields ?? {}), [field.key]: next },
        },
      }));
    if (field.type === "select") {
      return (
        <label key={field.key}>
          {field.label}
          <select value={value} onChange={(event) => setValue(event.target.value)} disabled={busy}>
            <option value="">待选择</option>
            {field.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      );
    }
    return (
      <label key={field.key}>
        {field.label}
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={field.placeholder}
          inputMode={field.type === "number" ? "numeric" : undefined}
          disabled={busy}
        />
      </label>
    );
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark">R</div>
          <div>
            <p className="eyebrow">RIGMATE / DIY WORKBENCH</p>
            <h1>装机清单工作台</h1>
            <p className="tagline">先确认能装，再决定买什么。</p>
          </div>
        </div>
        <div className="topbar-side">
          <div className="topbar-status"><span className="status-dot" /> 规则引擎在线 · 12 条规则</div>
        </div>
      </header>

      <div className="workbench">
        {/* 左栏：项目 + 添加配件 */}
        <div className="col col-left">
          <section className="panel">
            <div className="panel-heading">
              <div><span className="step-label">01 / 项目</span><h3>装机任务</h3></div>
              <span className="panel-index">A</span>
            </div>
            {projects.length > 0 && (
              <label>
                历史项目（切换后自动加载清单）
                <select value={build?.id ?? ""} onChange={(event) => switchProject(event.target.value)} disabled={busy}>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}（{project.items.length} 配件 · {formatTime(project.updatedAt)}）
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>新项目名称<input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：我的第一台 DIY 主机" disabled={busy} /></label>
            <label>主要用途<input value={useCase} onChange={(event) => setUseCase(event.target.value)} placeholder="例如：2K 游戏 / 开发" disabled={busy} /></label>
            <label>预算（元）· 可选，用于余量计<input value={budgetYuan} onChange={(event) => setBudgetYuan(event.target.value)} placeholder="例如：8000" inputMode="numeric" disabled={busy} /></label>
            <button className="button primary" onClick={createProject} disabled={busy || !name.trim()}>{busy ? "处理中…" : "新建项目"}<span>→</span></button>
            {build && <div className="project-created"><span className="check-icon">✓</span><div><strong>{build.name}</strong><small>{build.useCase ?? "未设置用途"} · {build.items.length} 个配件 · 数据已保存到 SQLite</small></div></div>}
            {build && (
              <button className={`button ${confirmDelete ? "danger-active" : "danger"}`} onClick={deleteProject} disabled={busy}>
                {confirmDelete ? `确认删除「${build.name}」？再点一次` : "删除当前项目"}<span>✕</span>
              </button>
            )}
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div><span className="step-label">02 / 配件</span><h3>{editingItemId ? "编辑配件" : "添加配件"}</h3></div>
              <span className="panel-index">B</span>
            </div>
            <div className="chip-row" role="tablist" aria-label="配件类别">
              {CATEGORY_ORDER.map((category) => (
                <button
                  key={category}
                  className={`chip ${itemCategory === category ? "selected" : ""}`}
                  onClick={() => {
                    if (editingItemId) {
                      setEditingItemId(null);
                      setDrafts((prev) => ({ ...prev, [itemCategory]: EMPTY_DRAFT }));
                      setMessage("已退出编辑（切换了类别）。");
                    }
                    setItemCategory(category);
                  }}
                  disabled={busy}
                >
                  {CATEGORY_META[category].label}
                </button>
              ))}
            </div>
            {editingItemId && (
              <p className="edit-note">正在编辑清单中的配件：类别保持不变，改完点「保存修改」。</p>
            )}
            <label>型号或商品名称<input value={draft.label} onChange={(event) => setDrafts((prev) => ({ ...prev, [itemCategory]: { label: event.target.value, price: prev[itemCategory]?.price ?? "", fields: prev[itemCategory]?.fields ?? {} } }))} placeholder={`${meta.label}型号`} disabled={busy} /></label>
            <label>价格（元）· 可选<input value={draft.price} onChange={(event) => setDrafts((prev) => ({ ...prev, [itemCategory]: { label: prev[itemCategory]?.label ?? "", price: event.target.value, fields: prev[itemCategory]?.fields ?? {} } }))} placeholder="例如：2899" inputMode="decimal" disabled={busy} /></label>
            {meta.fields.map(renderField)}
            {editingItemId ? (
              <div className="edit-actions">
                <button className="button secondary" onClick={saveItem} disabled={!draft.label.trim() || busy}>保存修改 <span>✓</span></button>
                <button className="button ghost" onClick={cancelEdit} disabled={busy}>取消编辑</button>
              </div>
            ) : (
              <button className="button secondary" onClick={addItem} disabled={!build || !draft.label.trim() || busy}>加入清单 <span>＋</span></button>
            )}
            {!build && <p className="helper">请先创建或选择一个项目。</p>}
          </section>
        </div>

        {/* 中栏：预算余量计 + 当前清单 */}
        <div className="col col-mid">
          {build?.budgetSummary && (
            <BudgetMeter summary={build.budgetSummary} itemCount={build.items.length} />
          )}
          <section className="panel">
            <div className="panel-heading list-heading">
              <div><span className="step-label">03 / 当前清单</span><h3>{build ? build.name : "还没有活动项目"}</h3></div>
              <span className="count-badge">{build?.items.length ?? 0} / 8 类</span>
            </div>
            {build?.items.length ? (
              <div className="item-list">
                {build.items.map((item) => (
                  <div className={`item-row ${editingItemId === item.id ? "editing" : ""}`} key={item.id}>
                    <div className={`part-icon part-${item.category}`}>{CATEGORY_META[item.category].badge}</div>
                    <div className="item-main">
                      <strong>{item.label}</strong>
                      <span>{CATEGORY_META[item.category].label} · {CATEGORY_META[item.category].summary(item.spec ?? {})}</span>
                    </div>
                    {typeof item.priceCents === "number" && (
                      <span className="item-price">{formatYuan(item.priceCents)}</span>
                    )}
                    <span className={hasAnySpec(item.spec ?? {}) ? "item-state confirmed" : "item-state pending"}>
                      {hasAnySpec(item.spec ?? {}) ? "已录入" : "待补充"}
                    </span>
                    <div className="item-actions">
                      <button className={`item-action ${editingItemId === item.id ? "active" : ""}`} onClick={() => startEdit(item)} disabled={busy}>改</button>
                      <button
                        className={`item-action danger ${confirmItemId === item.id ? "active" : ""}`}
                        onClick={() => removeItem(item.id)}
                        disabled={busy}
                      >
                        {confirmItemId === item.id ? "确认删" : "删"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <div className="empty-symbol">＋</div>
                <p>添加配件后，这里会显示你的当前清单，数据实时保存。</p>
              </div>
            )}
            <div className="list-actions">
              <span className="data-note">数据由你确认 · 不自动猜测具体型号</span>
            </div>
          </section>
        </div>

        {/* 右栏：诊断流 */}
        <div className="col col-right">
          <section className="panel">
            <div className="results-heading">
              <div><span className="step-label">04 / 检查结果</span><h3>兼容性诊断</h3></div>
              {findings.length > 0 && resultMeta && <span className="result-time">结果时间：{resultMeta.time}</span>}
            </div>
            {resultMeta?.stale && (
              <div className="stale-banner">清单在这次检查之后发生过变化，以下结论基于旧清单，请重新运行检查。</div>
            )}
            <div className="count-row">
              <StatusChip status="block" count={counts.block} />
              <StatusChip status="unknown" count={counts.unknown} />
              <StatusChip status="warn" count={counts.warn} />
              <StatusChip status="pass" count={counts.pass} />
            </div>
            {findings.length ? (
              <div className="findings">
                {findings.map((finding) => (
                  <FindingCard key={finding.ruleId} finding={finding} />
                ))}
              </div>
            ) : (
              <div className="results-empty">
                <div className="results-icon">◎</div>
                <div>
                  <strong>检查结果会显示在这里</strong>
                  <p>完成配件录入后运行检查，结论按阻断、待补充、警告、通过的顺序展示。</p>
                </div>
              </div>
            )}
            <div className="list-actions">
              <span className="data-note">数据由你确认 · 不自动猜测具体型号</span>
              <button className="button check-button" onClick={runCheck} disabled={!build || build.items.length === 0 || busy}>运行兼容性检查 <span>↗</span></button>
            </div>
          </section>
        </div>
      </div>

      <footer className="footer"><span>RIGMATE / 业务规则优先</span><span>{message}</span></footer>
    </main>
  );
}
