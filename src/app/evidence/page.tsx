"use client";

import { useEffect, useState } from "react";

type EvidenceRecord = {
  id: string;
  category: string;
  productName: string;
  priceCents: number;
  priceBasis?: string;
  sourceType: string;
  platform?: string;
  shop?: string;
  condition?: string;
  evidenceUrl?: string;
  note?: string;
  capturedAt: string;
};

const CATEGORY_LABELS: Record<string, string> = {
  cpu: "CPU",
  motherboard: "主板",
  gpu: "显卡",
  ram: "内存",
  storage: "SSD/HDD",
  psu: "电源",
  cooler: "散热器",
  case: "机箱",
};

const PLATFORMS = ["京东", "淘宝", "拼多多", "抖音", "线下", "其他"];
const CONDITIONS = ["全新", "散片", "二手"];
const BASES = ["到手价", "标价", "券后价"];

function formatYuan(cents: number): string {
  return `¥${(cents / 100).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const EMPTY_FORM = {
  category: "cpu",
  productName: "",
  priceYuan: "",
  priceBasis: "",
  platform: "",
  shop: "",
  condition: "",
  evidenceUrl: "",
  note: "",
};

export default function EvidencePage() {
  const [records, setRecords] = useState<EvidenceRecord[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formMessage, setFormMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [filterCategory, setFilterCategory] = useState("");

  async function loadList(category: string) {
    const query = category ? `?category=${category}` : "";
    const response = await fetch(`/api/evidence${query}`);
    if (!response.ok) throw new Error("failed");
    const data = await response.json();
    setRecords(data.evidence ?? []);
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (!cancelled) await loadList("");
      } catch {
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function setField(field: keyof typeof EMPTY_FORM, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function submitEvidence() {
    const priceYuan = Number(form.priceYuan.replace(/[¥,]/g, ""));
    if (!form.productName.trim()) {
      setFormMessage("型号名不能为空。");
      return;
    }
    if (!Number.isFinite(priceYuan) || priceYuan <= 0) {
      setFormMessage("价格需要是大于 0 的数字（单位：元）。");
      return;
    }
    setSubmitting(true);
    setFormMessage("");
    try {
      const response = await fetch("/api/evidence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: form.category,
          productName: form.productName.trim(),
          priceCents: Math.round(priceYuan * 100),
          priceBasis: form.priceBasis || undefined,
          sourceType: "manual_entry",
          platform: form.platform || undefined,
          shop: form.shop || undefined,
          condition: form.condition || undefined,
          evidenceUrl: form.evidenceUrl || undefined,
          note: form.note || undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "提交失败");
      setFormMessage(`已记录：${data.evidence.productName} ${formatYuan(data.evidence.priceCents)}。`);
      setForm((prev) => ({ ...prev, productName: "", priceYuan: "", evidenceUrl: "", note: "" }));
      await loadList(filterCategory);
    } catch (error) {
      setFormMessage(error instanceof Error ? error.message : "提交失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="hw-page">
      <header className="hw-head">
        <h1>证据台账</h1>
        <p className="hw-sub">
          价格证据的追加式台账（规格 §8.2）：只增不改，每条注明渠道、口径与时间。V1 仅手动来源。
        </p>
      </header>

      <section className="sec">
        <div className="hw-sec-head">
          <h2>录入证据</h2>
        </div>
        <div className="ev-form">
          <label className="ev-field">
            <span>类别</span>
            <select value={form.category} onChange={(event) => setField("category", event.target.value)}>
              {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="ev-field ev-wide">
            <span>型号 / 商品名</span>
            <input value={form.productName} onChange={(event) => setField("productName", event.target.value)} placeholder="例如：技嘉 B650M 小雕" />
          </label>
          <label className="ev-field">
            <span>价格（元）</span>
            <input value={form.priceYuan} onChange={(event) => setField("priceYuan", event.target.value)} placeholder="例如：1099" />
          </label>
          <label className="ev-field">
            <span>价格口径</span>
            <select value={form.priceBasis} onChange={(event) => setField("priceBasis", event.target.value)}>
              <option value="">未注明</option>
              {BASES.map((basis) => (
                <option key={basis} value={basis}>
                  {basis}
                </option>
              ))}
            </select>
          </label>
          <label className="ev-field">
            <span>渠道</span>
            <select value={form.platform} onChange={(event) => setField("platform", event.target.value)}>
              <option value="">未注明</option>
              {PLATFORMS.map((platform) => (
                <option key={platform} value={platform}>
                  {platform}
                </option>
              ))}
            </select>
          </label>
          <label className="ev-field">
            <span>店铺</span>
            <input value={form.shop} onChange={(event) => setField("shop", event.target.value)} placeholder="例如：京东自营" />
          </label>
          <label className="ev-field">
            <span>成色</span>
            <select value={form.condition} onChange={(event) => setField("condition", event.target.value)}>
              <option value="">未注明</option>
              {CONDITIONS.map((condition) => (
                <option key={condition} value={condition}>
                  {condition}
                </option>
              ))}
            </select>
          </label>
          <label className="ev-field ev-wide">
            <span>证据链接（商品页/截图地址）</span>
            <input value={form.evidenceUrl} onChange={(event) => setField("evidenceUrl", event.target.value)} placeholder="https://…" />
          </label>
        </div>
        {formMessage && <p className="review-msg">{formMessage}</p>}
        <div className="review-bar">
          <button className="button secondary" onClick={() => void submitEvidence()} disabled={submitting}>
            {submitting ? "记录中…" : "记录这条证据"}
          </button>
        </div>
      </section>

      <section className="sec">
        <div className="hw-sec-head">
          <h2>台账</h2>
          <span className="hw-total">{filterCategory ? `类别：${CATEGORY_LABELS[filterCategory] ?? filterCategory}` : "全部类别"}</span>
        </div>
        <div className="ev-filter">
          <button
            className={`ev-filter-btn${filterCategory === "" ? " active" : ""}`}
            onClick={() => { setFilterCategory(""); void loadList(""); }}
          >
            全部
          </button>
          {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
            <button
              key={value}
              className={`ev-filter-btn${filterCategory === value ? " active" : ""}`}
              onClick={() => { setFilterCategory(value); void loadList(value); }}
            >
              {label}
            </button>
          ))}
        </div>
        {loadError && <p className="helper">台账加载失败，请确认开发服务器正在运行。</p>}
        {records && records.length === 0 && <p className="helper">还没有证据记录。</p>}
        {records && records.length > 0 && (
          <table className="hw-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>类别</th>
                <th>型号</th>
                <th className="num">价格</th>
                <th>口径 / 渠道 / 店铺</th>
                <th>成色</th>
                <th>证据</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.id}>
                  <td>{formatTime(record.capturedAt)}</td>
                  <td>{CATEGORY_LABELS[record.category] ?? record.category}</td>
                  <td>{record.productName}</td>
                  <td className="num">{formatYuan(record.priceCents)}</td>
                  <td>
                    {[record.priceBasis, record.platform, record.shop].filter(Boolean).join(" · ") || "—"}
                  </td>
                  <td>{record.condition ?? "—"}</td>
                  <td>
                    {record.evidenceUrl ? (
                      <a href={record.evidenceUrl} target="_blank" rel="noreferrer" className="pj-open">
                        链接
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

    </main>
  );
}
