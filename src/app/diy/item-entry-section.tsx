import { Check, Plus } from "lucide-react";
import { specToFormValues, type FieldDef } from "@/ui/category-form";
import type { DiyWorkspace } from "./use-diy-projects";

/** 配件录入：目录检索/选型（自动带出已核规格）+ 手填字段 + 目录署名（ODC-By） */
export function ItemEntrySection({ diy }: { diy: DiyWorkspace }) {
  const {
    build, busy, meta, draft, itemCategory, setDrafts, editingItemId,
    catalogSearch, setCatalogSearch, catalogOptions, catalogProvenance,
    addItem, cancelEdit, saveItem, message, fieldValues,
  } = diy;

  function renderField(field: FieldDef) {
    const value = fieldValues[field.key] ?? "";
    const setValue = (next: string) =>
      setDrafts((prev) => ({
        ...prev,
        [itemCategory]: {
          label: prev[itemCategory]?.label ?? "",
          price: prev[itemCategory]?.price ?? "",
          catalogId: prev[itemCategory]?.catalogId,
          fields: { ...(prev[itemCategory]?.fields ?? {}), [field.key]: next },
        },
      }));
    if (field.type === "select") {
      return (
        <label className="field" key={field.key}>
          <span className="field-label">{field.label}</span>
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
      <label className="field" key={field.key}>
        <span className="field-label">{field.label}</span>
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={field.placeholder}
          inputMode={field.type === "number" || field.type === "count" ? "numeric" : undefined}
          disabled={busy}
        />
      </label>
    );
  }

  return (
    <section className="sec">
      <div className="sec-head">
        <h3 className="sec-title">{editingItemId ? "编辑配件" : "配件录入"}</h3>
        <span className="sec-meta">数据由你确认，不自动猜测型号</span>
      </div>
      {editingItemId && (
        <p className="edit-note">正在编辑清单中的配件：类别保持不变，改完点「保存修改」。</p>
      )}
      <div className="addgrid">
        <label className="field wide">
          <span className="field-label">
            检索目录（输入型号关键词） <span className="field-hint">种子 + BuildCores 导入共万级条目</span>
          </span>
          <input
            value={catalogSearch}
            onChange={(event) => setCatalogSearch(event.target.value)}
            placeholder="例如：9800X3D / 4070 SUPER / B650M"
            disabled={busy}
          />
        </label>
        <label className="field wide">
          <span className="field-label">从目录选择型号 <span className="field-hint">自动带出已核规格</span></span>
          <select
            value={draft.catalogId ?? ""}
            onChange={(event) => {
              const entryId = event.target.value || undefined;
              const entry = entryId
                ? catalogOptions.find((e) => e.id === entryId)
                : undefined;
              setDrafts((prev) => ({
                ...prev,
                [itemCategory]: {
                  label: entry ? entry.name : prev[itemCategory]?.label ?? "",
                  price: prev[itemCategory]?.price ?? "",
                  catalogId: entry?.id,
                  fields: entry ? specToFormValues(meta, entry.spec) : prev[itemCategory]?.fields ?? {},
                },
              }));
            }}
            disabled={busy}
          >
            <option value="">手动填写（不使用目录）</option>
            {catalogOptions.map((entry) => (
              <option key={entry.id} value={entry.id} title={entry.displayNameOriginal ?? entry.name}>
                {entry.displayName ?? entry.name}
              </option>
            ))}
          </select>
        </label>
        {catalogProvenance && (
          <p className="catalog-provenance field wide">
            目录含{" "}
            <a
              href={catalogProvenance.upstreamUrl}
              target="_blank"
              rel="noreferrer"
            >
              BuildCores OpenDB
            </a>{" "}
            导入 {catalogProvenance.entryCount} 条 · commit{" "}
            {catalogProvenance.upstreamCommit.slice(0, 7)} ·{" "}
            {catalogProvenance.license}（须保留署名）
          </p>
        )}
        <label className="field wide">
          <span className="field-label">型号或商品名称</span>
          <input
            value={draft.label}
            onChange={(event) =>
              setDrafts((prev) => ({
                ...prev,
                [itemCategory]: { label: event.target.value, price: prev[itemCategory]?.price ?? "", catalogId: prev[itemCategory]?.catalogId, fields: prev[itemCategory]?.fields ?? {} },
              }))
            }
            placeholder={`${meta.label}型号`}
            disabled={busy}
          />
        </label>
        <label className="field">
          <span className="field-label">价格（元）· 可选</span>
          <input
            value={draft.price}
            onChange={(event) =>
              setDrafts((prev) => ({
                ...prev,
                [itemCategory]: { label: prev[itemCategory]?.label ?? "", price: event.target.value, catalogId: prev[itemCategory]?.catalogId, fields: prev[itemCategory]?.fields ?? {} },
              }))
            }
            placeholder="例如：2899"
            inputMode="decimal"
            disabled={busy}
          />
        </label>
        {meta.fields.map(renderField)}
      </div>
      <div className="form-actions">
        {editingItemId ? (
          <>
            <button className="button ghost" onClick={cancelEdit} disabled={busy}>取消编辑</button>
            <button className="button secondary" onClick={saveItem} disabled={!draft.label.trim() || busy}>
              保存修改 <Check size={14} aria-hidden />
            </button>
          </>
        ) : (
          <button className="button secondary" onClick={addItem} disabled={!build || !draft.label.trim() || busy}>
            加入清单 <Plus size={14} aria-hidden />
          </button>
        )}
      </div>
      {/* 操作反馈必须离按钮近：footer 在页面最底端，校验错误看不见会被当成"点了没反应" */}
      {message && <p className="form-feedback">{message}</p>}
      {!build && <p className="helper">请先创建或选择一个项目。</p>}
    </section>
  );
}
