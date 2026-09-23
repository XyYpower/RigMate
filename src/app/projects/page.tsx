"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Build = {
  id: string;
  name: string;
  useCase: string | null;
  updatedAt: string;
  budgetCents: number | null;
  budgetSummary?: { pricedTotalCents: number };
  items: unknown[];
};

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

export default function ProjectsPage() {
  const [builds, setBuilds] = useState<Build[] | null>(null);
  const [loadError, setLoadError] = useState(false);

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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="sec">
        <div className="hw-sec-head">
          <h2>整机复核</h2>
          <span className="hw-total">V1-B 规划中</span>
        </div>
        <p className="helper">
          粘贴主播/电商的整机配置单 → 自动解析 → 跑兼容性检查（"查坑"场景）。后端与解析流程按
          docs/design/10-系统布局规划.md §1 排期。
        </p>
      </section>
    </main>
  );
}
