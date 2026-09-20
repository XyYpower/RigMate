"use client";

import { useEffect, useMemo, useState } from "react";
import {
  buildSpecPayload,
  CATEGORY_META,
  CATEGORY_ORDER,
  hasAnySpec,
  type FieldDef,
  type ItemSpec,
} from "@/ui/category-form";
import { FindingCard } from "@/ui/components/finding-card";
import { StatusChip } from "@/ui/components/status-chip";
import { BuildCanvas } from "@/ui/canvas/build-canvas";
import type { Finding, FindingStatus } from "@/domain/build/types";

type Category = keyof typeof CATEGORY_META;

type Item = {
  id: string;
  category: Category;
  label: string;
  spec: ItemSpec;
};

type Build = {
  id: string;
  name: string;
  useCase: string | null;
  status: string;
  updatedAt: string;
  items: Item[];
};

type CategoryDraft = { label: string; fields: Record<string, string> };

const EMPTY_DRAFT: CategoryDraft = { label: "", fields: {} };

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

export default function Home() {
  const [build, setBuild] = useState<Build | null>(null);
  const [projects, setProjects] = useState<Build[]>([]);
  const [name, setName] = useState("我的第一台 DIY 主机");
  const [useCase, setUseCase] = useState("2K 游戏");
  const [itemCategory, setItemCategory] = useState<Category>("cpu");
  const [drafts, setDrafts] = useState<Record<string, CategoryDraft>>({});
  const [findings, setFindings] = useState<Finding[]>([]);
  const [resultMeta, setResultMeta] = useState<{ time: string; stale: boolean } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
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
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/builds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, useCase }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "创建失败");
      const created: Build = data.build;
      setBuild(created);
      setProjects((prev) => latestFirst([created, ...prev]));
      setFindings([]);
      setResultMeta(null);
      setConfirmDelete(false);
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
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/builds/${build.id}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: itemCategory, label: draft.label, spec }),
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
              <div><span className="step-label">02 / 配件</span><h3>添加配件</h3></div>
              <span className="panel-index">B</span>
            </div>
            <div className="chip-row" role="tablist" aria-label="配件类别">
              {CATEGORY_ORDER.map((category) => (
                <button
                  key={category}
                  className={`chip ${itemCategory === category ? "selected" : ""}`}
                  onClick={() => setItemCategory(category)}
                  disabled={busy}
                >
                  {CATEGORY_META[category].label}
                </button>
              ))}
            </div>
            <label>型号或商品名称<input value={draft.label} onChange={(event) => setDrafts((prev) => ({ ...prev, [itemCategory]: { label: event.target.value, fields: prev[itemCategory]?.fields ?? {} } }))} placeholder={`${meta.label}型号`} disabled={busy} /></label>
            {meta.fields.map(renderField)}
            <button className="button secondary" onClick={addItem} disabled={!build || !draft.label.trim() || busy}>加入清单 <span>＋</span></button>
            {!build && <p className="helper">请先创建或选择一个项目。</p>}
          </section>
        </div>

        {/* 中栏：当前清单 + 尺寸核对示意 */}
        <div className="col col-mid">
          <section className="panel">
            <div className="panel-heading list-heading">
              <div><span className="step-label">03 / 当前清单</span><h3>{build ? build.name : "还没有活动项目"}</h3></div>
              <span className="count-badge">{build?.items.length ?? 0} / 8 类</span>
            </div>
            {build?.items.length ? (
              <div className="item-list">
                {build.items.map((item) => (
                  <div className="item-row" key={item.id}>
                    <div className={`part-icon part-${item.category}`}>{CATEGORY_META[item.category].badge}</div>
                    <div className="item-main">
                      <strong>{item.label}</strong>
                      <span>{CATEGORY_META[item.category].label} · {CATEGORY_META[item.category].summary(item.spec ?? {})}</span>
                    </div>
                    <span className={hasAnySpec(item.spec ?? {}) ? "item-state confirmed" : "item-state pending"}>
                      {hasAnySpec(item.spec ?? {}) ? "已录入" : "待补充"}
                    </span>
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

          <section className="panel">
            <div className="panel-heading">
              <div><span className="step-label">04 / 尺寸核对</span><h3>尺寸核对示意图</h3></div>
              <span className="panel-index">D</span>
            </div>
            <p className="panel-note">
              按已录入的规格数字绘制的规则示意图，仅表达显卡长度、散热器高度与机箱限值的比较关系——不是渲染图，不代表配件真实外观。规格未知时显示虚线幽灵件。
            </p>
            <BuildCanvas
              items={(build?.items ?? []).map((item) => ({
                category: item.category,
                label: item.label,
                spec: item.spec ?? {},
              }))}
            />
          </section>
        </div>

        {/* 右栏：诊断流 */}
        <div className="col col-right">
          <section className="panel">
            <div className="results-heading">
              <div><span className="step-label">05 / 检查结果</span><h3>兼容性诊断</h3></div>
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
