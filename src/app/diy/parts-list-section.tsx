import { CATEGORY_META, hasAnySpec } from "@/ui/category-form";
import { formatYuan, type Build } from "./types";
import type { DiyWorkspace } from "./use-diy-projects";

/** 规格表清单：类型徽章 + 型号摘要 + 价格（未计价如实为空）+ 录入状态 + 行内改/删 */
export function PartsListSection({ build, diy }: { build: Build | null; diy: DiyWorkspace }) {
  const { editingItemId, confirmItemId, busy } = diy;
  return (
    <section className="sec">
      <div className="sec-head">
        <h3 className="sec-title">清单</h3>
        <span className="count-badge">{build?.items.length ?? 0} / 8 类</span>
      </div>
      {build?.items.length ? (
        <div className="table">
          <div className="thead" aria-hidden>
            <span>类型</span>
            <span>型号 / 关键规格</span>
            <span className="col-price">价格</span>
            <span className="col-state">状态</span>
            <span />
          </div>
          {build.items.map((item) => (
            <div className={`item-row ${editingItemId === item.id ? "editing" : ""}`} key={item.id}>
              <span className="cat-label">{CATEGORY_META[item.category].badge}</span>
              <div className="item-main">
                <strong title={item.displayNameOriginal ?? item.label}>
                  {item.displayName ?? item.label}
                </strong>
                <span>
                  {CATEGORY_META[item.category].label} · {CATEGORY_META[item.category].summary(item.spec ?? {})}
                  {item.source?.startsWith("catalog:") ? " · 目录型号" : ""}
                </span>
              </div>
              <span className={`item-price ${typeof item.priceCents === "number" ? "" : "empty"}`}>
                {typeof item.priceCents === "number" ? formatYuan(item.priceCents) : "—"}
              </span>
              <span className={hasAnySpec(item.spec ?? {}) ? "item-state confirmed" : "item-state pending"}>
                {hasAnySpec(item.spec ?? {}) ? "已录入" : "待补充"}
              </span>
              <div className="item-actions">
                <button className={`item-action ${editingItemId === item.id ? "active" : ""}`} onClick={() => diy.startEdit(item)} disabled={busy}>改</button>
                <button
                  className={`item-action danger ${confirmItemId === item.id ? "active" : ""}`}
                  onClick={() => diy.removeItem(item.id)}
                  disabled={busy}
                >
                  {confirmItemId === item.id ? "确认删" : "删"}
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="empty-line">清单为空</p>
      )}
    </section>
  );
}
