"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

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
  spec: Record<string, string | number | string[] | undefined>;
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

const SOURCE_LABELS: Record<string, string> = {
  seed: "种子",
  manual: "人工",
  buildcores: "BuildCores",
};

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
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
          目录数据的三层结构与导入审计。检索与点选请回
          <Link href="/"> 装机配置 </Link>工作台；本页是数据运营视图。
        </p>
      </header>

      {loadError && <p className="helper">目录总览加载失败，请确认开发服务器正在运行。</p>}

      {overview && (
        <>
          <section className="sec">
            <div className="hw-sec-head">
              <h2>目录来源</h2>
              <span className="hw-total">共 {overview.totalEntries.toLocaleString("zh-CN")} 条</span>
            </div>
            <div className="src-table" role="table" aria-label="目录来源">
              {overview.sources.map((source) => (
                <div className="src-row" key={source.key}>
                  <span className="src-label">{source.label}</span>
                  <span className="src-count">{source.count.toLocaleString("zh-CN")} 条</span>
                  <span className="src-meta">
                    {source.importedAt ? `导入于 ${formatTime(source.importedAt)}` : "随代码维护"}
                    {source.note ? ` · ${source.note}` : ""}
                  </span>
                  {source.attribution && (
                    <span className="src-attr">
                      <a href={source.attribution.upstreamUrl} target="_blank" rel="noreferrer">
                        {source.attribution.license}
                      </a>{" "}
                      @ commit {source.attribution.upstreamCommit.slice(0, 7)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section className="sec">
            <div className="hw-sec-head">
              <h2>类别覆盖</h2>
              <span className="hw-hint">「有规格」= 至少带出一个可用于规则的字段；空规格条目仅提供型号名</span>
            </div>
            <table className="hw-table">
              <thead>
                <tr>
                  <th>类别</th>
                  <th>条目</th>
                  <th>有规格</th>
                  <th>种子</th>
                  <th>人工</th>
                  <th>BuildCores</th>
                </tr>
              </thead>
              <tbody>
                {overview.categories.map((row) => (
                  <tr key={row.category}>
                    <td>{CATEGORY_LABELS[row.category] ?? row.category}</td>
                    <td className="num">{row.total.toLocaleString("zh-CN")}</td>
                    <td className="num">{row.withSpec.toLocaleString("zh-CN")}</td>
                    <td className="num">{row.bySource.seed}</td>
                    <td className="num">{row.bySource.manual}</td>
                    <td className="num">{row.bySource.buildcores.toLocaleString("zh-CN")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}

      <section className="sec">
        <div className="hw-sec-head">
          <h2>目录检索</h2>
          <span className="hw-hint">与工作台共用同一检索（上限 30 条）</span>
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
                  <td>{SOURCE_LABELS[hit.source] ?? hit.source}</td>
                  <td className="hw-spec">{JSON.stringify(hit.spec)}</td>
                </tr>
              ))}
              {hits.length === 0 && (
                <tr>
                  <td colSpan={3}>无命中——这样的检索就是「待录清单」的输入（V1-B 自动统计）。</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </section>

      <section className="sec">
        <div className="hw-sec-head">
          <h2>导入审计</h2>
          <span className="hw-hint">catalog_import_runs 表，新 → 旧，最多 20 条</span>
        </div>
        <table className="hw-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>来源</th>
              <th>commit / 类型</th>
              <th>导入</th>
              <th>跳过</th>
              <th>错误</th>
              <th>许可证</th>
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
                <td className="num">{run.importedCount.toLocaleString("zh-CN")}</td>
                <td className="num">{run.skippedCount}</td>
                <td className="num">{run.errorCount}</td>
                <td>{run.license}</td>
              </tr>
            ))}
            {imports.length === 0 && (
              <tr>
                <td colSpan={7}>暂无导入记录。</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}
