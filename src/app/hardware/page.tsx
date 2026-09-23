"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CATEGORY_META, type ItemSpec } from "@/ui/category-form";

type SourceInfo = {
  key: string;
  label: string;
  count: number;
  importedAt: string | null;
  note: string | null;
  attribution: { upstreamCommit: string; upstreamUrl: string; license: string; licenseUrl: string } | null;
};

type CategoryCoverage = {
  category: string;
  total: number;
  withSpec: number;
  bySource: { seed: number; manual: number; buildcores: number };
};

type Overview = {
  sources: SourceInfo[];
  categories: CategoryCoverage[];
  totalEntries: number;
};

type ImportRun = {
  id: string;
  upstreamCommit: string;
  license: string;
  sourcePath: string;
  importedAt: string;
  importedCount: number;
  skippedCount: number;
  errorCount: number;
};

type CatalogHit = {
  id: string;
  category: string;
  name: string;
  spec: ItemSpec;
  source: string;
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

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** 人话规格摘要；未知类别回退 JSON */
function specSummary(category: string, spec: ItemSpec): string {
  const meta = (CATEGORY_META as Record<string, typeof CATEGORY_META[keyof typeof CATEGORY_META]>)[category];
  if (!meta) return JSON.stringify(spec);
  return meta.summary(spec) || "—";
}

export default function HardwarePage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [imports, setImports] = useState<ImportRun[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [searchCategory, setSearchCategory] = useState("cpu");
  const [searchQuery, setSearchQuery] = useState("");
  const [hits, setHits] = useState<CatalogHit[] | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/catalog/overview");
        if (!response.ok) throw new Error("overview failed");
        const data = await response.json();
        if (!cancelled) {
          setOverview(data.overview ?? null);
          setImports(data.imports ?? []);
        }
      } catch {
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function runSearch() {
    setSearching(true);
    try {
      const params = new URLSearchParams({ category: searchCategory });
      if (searchQuery.trim()) params.set("q", searchQuery.trim());
      const response = await fetch(`/api/catalog?${params.toString()}`);
      const data = await response.json();
      setHits(data.entries ?? []);
    } catch {
      setHits([]);
    } finally {
      setSearching(false);
    }
  }

  return (
    <main className="hw-page">
      <header className="hw-head">
        <h1>硬件中心</h1>
        <p className="hw-sub">
          三层目录与导入审计。选件检索在
          <Link href="/"> 装机配置 </Link>工作台。
        </p>
      </header>

      {loadError && <p className="helper">目录总览加载失败，请确认开发服务器正在运行。</p>}

      {overview && (
        <section className="sec">
          <div className="hw-sec-head">
            <h2>目录来源</h2>
            <span className="hw-total">共 {overview.totalEntries.toLocaleString("zh-CN")} 条</span>
          </div>
          <div className="hw-stats">
            {overview.sources.map((source) => (
              <div className="hw-stat" key={source.key}>
                <span className="hw-stat-num">{source.count.toLocaleString("zh-CN")}</span>
                <span className="hw-stat-label">{source.label}</span>
                <span className="hw-stat-meta">
                  {source.key === "buildcores" && source.attribution ? (
                    <>
                      <a href={source.attribution.upstreamUrl} target="_blank" rel="noreferrer">
                        {source.attribution.license}
                      </a>
                      {" · "}
                      {source.attribution.upstreamCommit.slice(0, 7)} · {formatTime(source.importedAt)}
                    </>
                  ) : source.key === "manual" ? (
                    `导入于 ${formatTime(source.importedAt)}`
                  ) : (
                    "随代码维护"
                  )}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {overview && (
        <section className="sec">
          <div className="hw-sec-head">
            <h2>类别覆盖</h2>
            <span className="hw-total">来源构成 = 种子 / 人工 / BuildCores</span>
          </div>
          <table className="hw-table">
            <thead>
              <tr>
                <th>类别</th>
                <th className="num">条目</th>
                <th>规格覆盖</th>
                <th className="num">种子 / 人工 / BuildCores</th>
              </tr>
            </thead>
            <tbody>
              {overview.categories.map((row) => {
                const pct = row.total > 0 ? Math.round((row.withSpec / row.total) * 100) : 0;
                return (
                  <tr key={row.category}>
                    <td>{CATEGORY_LABELS[row.category] ?? row.category}</td>
                    <td className="num">{row.total.toLocaleString("zh-CN")}</td>
                    <td>
                      <span className="cov">
                        <span className="cov-track" aria-hidden="true">
                          <span className="cov-fill" style={{ width: `${pct}%` }} />
                        </span>
                        <span className="cov-pct">{pct}%</span>
                      </span>
                    </td>
                    <td className="num hw-mix">
                      {row.bySource.seed} · {row.bySource.manual} · {row.bySource.buildcores.toLocaleString("zh-CN")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      <section className="sec">
        <div className="hw-sec-head">
          <h2>检索</h2>
        </div>
        <div className="hw-searchbar">
          <select
            value={searchCategory}
            onChange={(event) => setSearchCategory(event.target.value)}
            aria-label="检索类别"
          >
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void runSearch();
            }}
            placeholder="型号关键词，例如 5070 / 速虎 / B650M"
            aria-label="目录关键词"
          />
          <button className="button secondary" onClick={() => void runSearch()} disabled={searching}>
            检索
          </button>
        </div>
        {hits && (
          <table className="hw-table">
            <thead>
              <tr>
                <th>型号</th>
                <th>来源</th>
                <th>规格</th>
              </tr>
            </thead>
            <tbody>
              {hits.map((hit) => (
                <tr key={hit.id}>
                  <td>{hit.name}</td>
                  <td>{SOURCE_SHORT[hit.source] ?? hit.source}</td>
                  <td className="hw-spec">{specSummary(hit.category, hit.spec)}</td>
                </tr>
              ))}
              {hits.length === 0 && (
                <tr>
                  <td colSpan={3}>无命中</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </section>

      <details className="hw-audit">
        <summary>导入审计 · {imports.length} 条</summary>
        <table className="hw-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>来源</th>
              <th>版本</th>
              <th className="num">结果</th>
            </tr>
          </thead>
          <tbody>
            {imports.map((run) => (
              <tr key={run.id}>
                <td>{formatTime(run.importedAt)}</td>
                <td className="hw-spec">{run.sourcePath.split(/[\\/]/).pop()}</td>
                <td className="hw-spec">
                  {run.upstreamCommit === "manual" ? "人工整理" : run.upstreamCommit.slice(0, 7)}
                </td>
                <td className="num">
                  导入 {run.importedCount.toLocaleString("zh-CN")}
                  {run.errorCount > 0 ? ` · 错 ${run.errorCount}` : ""}
                </td>
              </tr>
            ))}
            {imports.length === 0 && (
              <tr>
                <td colSpan={4}>暂无导入记录。</td>
              </tr>
            )}
          </tbody>
        </table>
      </details>
    </main>
  );
}
