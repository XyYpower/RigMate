"use client";

import { useCallback, useEffect, useState } from "react";

type PendingItem = {
  evidenceId: string;
  fieldPath: string;
  value: unknown;
  excerpt: string;
  identityMatch: string;
  createdAt: string;
  sourceId: string;
  sourceTitle: string;
  sourceUrl: string;
  sourceTier: string;
  sourceStatus: string;
  productId: string;
  productName: string;
  productCategory: string;
};

type ProductGroup = {
  productId: string;
  productName: string;
  productCategory: string;
  evidence: PendingItem[];
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

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(" / ");
  if (typeof value === "string") return value;
  return String(value);
}

export default function ReviewDeskPage() {
  const [products, setProducts] = useState<ProductGroup[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const [reviewer, setReviewer] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const loadList = useCallback(async () => {
    const saved = window.localStorage.getItem("rigmate-reviewer");
    if (saved) setReviewer((prev) => prev || saved);
    const response = await fetch("/api/catalog/review");
    if (!response.ok) throw new Error("failed");
    const data = await response.json();
    setProducts(data.products ?? []);
    setTotal(data.total ?? 0);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        await loadList();
      } catch {
        setLoadError(true);
      }
    })();
  }, [loadList]);

  function saveReviewer(name: string) {
    setReviewer(name);
    window.localStorage.setItem("rigmate-reviewer", name);
  }

  async function act(body: Record<string, unknown>, done: string) {
    const name = reviewer.trim();
    if (!name) {
      setMessage("请先填写复核人署名（右上方输入框）。");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/catalog/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, reviewer: name }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "操作失败");
      setMessage(done);
      await loadList();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="hw-page">
      <header className="hw-head">
        <h1>审核台</h1>
        <p className="hw-sub">
          人工复核字段证据：核对来源页面与摘录一致后盖章，字段状态 supported → verified。所有操作记录复核人署名。
        </p>
      </header>

      <section className="sec">
        <div className="hw-sec-head">
          <div>
            <h2>待复核证据</h2>
            <p className="hw-section-note">{total > 0 ? `共 ${total} 条，按产品分组。` : "全部处理完毕。"}</p>
          </div>
          <span className="hw-total">
            复核人：
            <input
              value={reviewer}
              onChange={(event) => saveReviewer(event.target.value)}
              placeholder="署名"
              aria-label="复核人署名"
              style={{ width: 120, marginLeft: 8 }}
            />
          </span>
        </div>
        {loadError && <p className="helper">加载失败，请确认开发服务器正在运行。</p>}
        {message && <p className="review-msg">{message}</p>}
        {products !== null && products.length === 0 && !loadError && (
          <p className="helper">没有待复核的证据。新查证数据录入后会出现在这里。</p>
        )}
        {products?.map((group) => (
          <section key={group.productId} aria-label={group.productName} style={{ marginTop: 24 }}>
            <div className="hw-sec-head">
              <h2>
                {group.productName}
                <span className="hw-total"> {CATEGORY_LABELS[group.productCategory] ?? group.productCategory}</span>
              </h2>
              <span className="hw-total">{group.evidence.length} 条</span>
            </div>
            <table className="hw-table">
              <thead>
                <tr>
                  <th>字段</th>
                  <th className="num">值</th>
                  <th>摘录</th>
                  <th>来源</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {group.evidence.map((item) => (
                  <tr key={item.evidenceId}>
                    <td>{item.fieldPath.replace("spec.", "")}</td>
                    <td className="num">{formatValue(item.value)}</td>
                    <td>{item.excerpt}</td>
                    <td>
                      [{item.sourceTier}]{" "}
                      <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="pj-open">
                        来源页
                      </a>
                    </td>
                    <td>
                      <button
                        className="button secondary"
                        disabled={busy}
                        onClick={() =>
                          void act(
                            { action: "verify_evidence", evidenceId: item.evidenceId },
                            `已盖章：${group.productName} · ${item.fieldPath.replace("spec.", "")}`,
                          )
                        }
                      >
                        盖章通过
                      </button>
                      <button
                        className="button secondary"
                        disabled={busy}
                        style={{ marginLeft: 8 }}
                        onClick={() => {
                          const note = window.prompt(`驳回该来源（会影响来源下全部证据）：${item.sourceTitle}`);
                          if (note !== null) {
                            void act(
                              { action: "review_source", sourceId: item.sourceId, status: "rejected", note: note || "审核台驳回" },
                              `已驳回来源：${item.sourceTitle}`,
                            );
                          }
                        }}
                      >
                        驳回
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </section>
    </main>
  );
}
