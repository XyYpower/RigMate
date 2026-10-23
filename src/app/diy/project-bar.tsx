import { ArrowRight, X } from "lucide-react";
import { formatTime } from "./types";
import type { DiyWorkspace } from "./use-diy-projects";

/** 项目栏：历史项目切换 + 新建（名称/用途/预算）+ 删除（两步确认） */
export function ProjectBar({ diy }: { diy: DiyWorkspace }) {
  const { projects, build, name, useCase, budgetYuan, busy, confirmDelete } = diy;
  return (
    <section className="projbar">
      {projects.length > 0 && (
        <label className="field">
          <span className="field-label">历史项目 <span className="field-hint">切换后自动加载</span></span>
          <select value={build?.id ?? ""} onChange={(event) => diy.switchProject(event.target.value)} disabled={busy}>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}（{project.items.length} 配件 · {formatTime(project.updatedAt)}）
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="field">
        <span className="field-label">新项目名称</span>
        <input value={name} onChange={(event) => diy.setName(event.target.value)} placeholder="例如：我的第一台 DIY 主机" disabled={busy} />
      </label>
      <label className="field">
        <span className="field-label">主要用途</span>
        <input value={useCase} onChange={(event) => diy.setUseCase(event.target.value)} placeholder="例如：2K 游戏 / 开发" disabled={busy} />
      </label>
      <label className="field">
        <span className="field-label">预算（元）· 可选，用于余量计</span>
        <input value={budgetYuan} onChange={(event) => diy.setBudgetYuan(event.target.value)} placeholder="例如：8000" inputMode="numeric" disabled={busy} />
      </label>
      <div className="projbar-actions">
        <button className="button primary" onClick={diy.createProject} disabled={busy || !name.trim()}>
          {busy ? "处理中…" : "新建项目"}<ArrowRight size={14} aria-hidden />
        </button>
        {build && (
          <button className={`button ${confirmDelete ? "danger-active" : "danger"}`} onClick={diy.deleteProject} disabled={busy}>
            {confirmDelete ? `确认删除「${build.name}」？再点一次` : "删除当前项目"}<X size={13} aria-hidden />
          </button>
        )}
      </div>
    </section>
  );
}
