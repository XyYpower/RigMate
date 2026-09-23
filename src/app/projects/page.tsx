"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { parseReviewText } from "@/domain/review/parse";

type Build = {
  id: string;
  name: string;
  useCase: string | null;
  updatedAt: string;
  budgetCents: number | null;
  budgetSummary?: { pricedTotalCents: number };
  items: unknown[];
};

type CatalogHit = {
  id: string;
  name: string;
  spec: Record<string, unknown>;
};

type ReviewRow = {
  key: string;
  category: string; // "" = 忽略该行
  name: string;
  priceInput: string;
  candidates: CatalogHit[];
  candidateId: string; // "" = 不带目录规格
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

const SOURCE_SHORT: Record<string, string> = { seed: "种子", manual: "人工", buildcores: "BC" };

function latestFirst(builds: Build[]): Build[] {
  return [...builds].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function formatYuan(cents: number): string {
  return `¥${(cents / 100).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function parsePriceInput(raw: string): number | undefined {
  const text = raw.trim();
  if (!text) return undefined;
  const yuan = Number(text.replace(/[¥,]/g, ""));
  if (!Number.isFinite(yuan) || yuan <= 0) return undefined;
  return Math.round(yuan * 100);
}

export default function ProjectsPage() {
  const [builds, setBuilds] = useState<Build[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  // 整机复核流程状态
  const [pasteText, setPasteText] = useState("");
  const [reviewName, setReviewName] = useState("整机复核清单");
  const [reviewRows, setReviewRows] = useState<ReviewRow[] | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewMessage, setReviewMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/builds");
        if (!response.ok) throw new Error("failed");
        const data = await response.json();
        if (!cancelled) setBuilds(latestFirst(data.builds ?? []));
      } catch {
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function parsePasted() {
    const { parseReviewText, modelTokenOf } = await import("@/domain/review/parse");
    const parsed = parseReviewText(pasteText);
    const rows: ReviewRow[] = [];
    for (const line of parsed) {
      if (line.skipped) continue;
      const token = modelTokenOf(line.name);
      let candidates: CatalogHit[] = [];
      if (line.category && token) {
        try {
          const params = new URLSearchParams({ category: line.category, q: token });
          const response = await fetch(`/api/catalog?${params.toString()}`);
          if (response.ok) {
            const data = await response.json();
            candidates = (data.entries ?? []).slice(0, 5);
          }
        } catch {
          candidates = [];
        }
      }
      rows.push({
        key: `${line.lineNumber}-${line.name}`,
        category: line.category ?? "",
        name: line.name,
        priceInput: line.priceCents !== null ? String(line.priceCents / 100) : "",
        candidates,
        candidateId: "",
      });
    }
    setReviewRows(rows);
    const skippedCount = parsed.filter((line) => line.skipped).length;
    setReviewMessage(
      rows.length === 0
        ? "没有解析出配置行。请检查粘贴内容。"
        : `解析出 ${rows.length} 行${skippedCount > 0 ? `（另跳过 ${skippedCount} 行赠品/服务/标题）` : ""}。逐行确认类别与目录候选后，点「创建项目并运行检查」。`,
    );
  }

  async function createAndCheck() {
    if (!reviewRows) return;
    const usable = reviewRows.filter((row) => row.category !== "" && row.name.trim());
    if (usable.length === 0) {
      setReviewMessage("没有可用的配置行：至少确认一行的类别与型号。");
      return;
    }
    setReviewBusy(true);
    setReviewMessage("");
    try {
      const buildRes = await fetch("/api/builds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: reviewName.trim() || "整机复核清单" }),
      });
      const buildData = await buildRes.json();
      if (!buildRes.ok) throw new Error(buildData.error ?? "创建项目失败");
      const build: Build = buildData.build;

      for (const row of usable) {
        const candidate = row.candidates.find((c) => c.id === row.candidateId);
        const response = await fetch(`/api/builds/${build.id}/items`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            category: row.category,
            label: row.name.trim(),
            spec: candidate ? candidate.spec : {},
            priceCents: parsePriceInput(row.priceInput),
            source: candidate ? `catalog:${candidate.id}` : undefined,
          }),
        });
        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error ?? `添加 ${row.name} 失败`);
        }
      }

      await fetch(`/api/builds/${build.id}/check`, { method: "POST" });
      window.location.href = `/builds/${build.id}/report`;
    } catch (error) {
      setReviewMessage(error instanceof Error ? error.message : "复核失败，请重试。");
      setReviewBusy(false);
    }
  }

  function updateRow(key: string, patch: Partial<ReviewRow>) {
    setReviewRows((prev) =>
      prev?.map((row) => (row.key === key ? { ...row, ...patch } : row)) ?? null,
    );
  }

  return (
    <main className="hw-page">
      <header className="hw-head">
        <h1>方案库</h1>
        <p className="hw-sub">
          历史项目一览，点「打开」回到
          <Link href="/"> 装机配置 </Link>工作台继续编辑。
        </p>
      </header>

      <section className="sec">
        <div className="hw-sec-head">
          <h2>整机复核</h2>
          <span className="hw-total">粘贴主播/电商配置单 → 确认 → 查坑</span>
        </div>
        <textarea
          className="review-paste"
          value={pasteText}
          onChange={(event) => setPasteText(event.target.value)}
          rows={5}
          aria-label="复核配置单"
          placeholder={"粘贴配置单，每行一件，例如：\nCPU    i7 14700KF 盒装        2689\n主板   微星 B650M 迫击炮      1099\n显卡   七彩虹 RTX4080S 火神   9399"}
        />
        <div className="review-bar">
          <input
            className="review-name"
            value={reviewName}
            onChange={(event) => setReviewName(event.target.value)}
            placeholder="复核项目名称"
            aria-label="复核项目名称"
          />
          <button className="button secondary" onClick={() => void parsePasted()} disabled={!pasteText.trim()}>
            解析配置单
          </button>
        </div>
        {reviewMessage && <p className="review-msg">{reviewMessage}</p>}

        {reviewRows && reviewRows.length > 0 && (
          <>
            <table className="hw-table review-table">
              <thead>
                <tr>
                  <th>类别</th>
                  <th>型号（可改）</th>
                  <th>目录候选</th>
                  <th className="num">价格（元）</th>
                </tr>
              </thead>
              <tbody>
                {reviewRows.map((row) => (
                  <tr key={row.key} className={row.category === "" ? "row-ignored" : undefined}>
                    <td>
                      <select
                        value={row.category}
                        onChange={(event) => updateRow(row.key, { category: event.target.value, candidateId: "", candidates: [] })}
                        aria-label="行类别"
                      >
                        <option value="">忽略此行</option>
                        {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        value={row.name}
                        onChange={(event) => updateRow(row.key, { name: event.target.value })}
                        aria-label="行型号"
                      />
                    </td>
                    <td>
                      <select
                        value={row.candidateId}
                        onChange={(event) => updateRow(row.key, { candidateId: event.target.value })}
                        aria-label="目录候选"
                        disabled={row.category === ""}
                      >
                        <option value="">不带目录规格</option>
                        {row.candidates.map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {candidate.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="num">
                      <input
                        className="review-price"
                        value={row.priceInput}
                        onChange={(event) => updateRow(row.key, { priceInput: event.target.value })}
                        placeholder="—"
                        aria-label="行价格"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="review-bar">
              <span className="helper">
                「目录候选」选中后自动带出规格并标记来源；不带候选的行规格留空，检查时按待补充处理。
              </span>
              <button className="button secondary" onClick={() => void createAndCheck()} disabled={reviewBusy}>
                {reviewBusy ? "创建中…" : "创建项目并运行检查"}
              </button>
            </div>
          </>
        )}
      </section>

      <section className="sec">
        <div className="hw-sec-head">
          <h2>项目</h2>
          <Link href="/" className="pj-new">
            ＋ 新建项目
          </Link>
        </div>
        {loadError && <p className="helper">项目列表加载失败，请确认开发服务器正在运行。</p>}
        {builds && builds.length === 0 && (
          <p className="helper">
            还没有项目。去<Link href="/"> 装机配置 </Link>工作台创建第一个。
          </p>
        )}
        {builds && builds.length > 0 && (
          <table className="hw-table">
            <thead>
              <tr>
                <th>项目</th>
                <th>用途</th>
                <th className="num">配件</th>
                <th className="num">预算</th>
                <th className="num">已计价</th>
                <th>更新</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {builds.map((build) => (
                <tr key={build.id}>
                  <td>{build.name}</td>
                  <td>{build.useCase ?? "—"}</td>
                  <td className="num">{build.items.length}</td>
                  <td className="num">{build.budgetCents !== null ? formatYuan(build.budgetCents) : "—"}</td>
                  <td className="num">
                    {build.budgetSummary ? formatYuan(build.budgetSummary.pricedTotalCents) : "—"}
                  </td>
                  <td>{formatTime(build.updatedAt)}</td>
                  <td>
                    <Link className="pj-open" href={`/?project=${build.id}`}>
                      打开
                    </Link>
                    <span className="pj-sep">·</span>
                    <Link className="pj-open" href={`/builds/${build.id}/report`}>
                      报告
                    </Link>
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
