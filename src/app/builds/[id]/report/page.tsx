"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { Build, Finding } from "@/domain/build/types";
import { CATEGORY_META, type ItemSpec } from "@/ui/category-form";
import { STATUS_ORDER, toFindingCardModel } from "@/ui/finding-model";

type CheckPayload = {
  createdAt: string;
  stale: boolean;
  findings: Finding[];
} | null;

const STATUS_SECTION_LABEL: Record<string, string> = {
  block: "阻断",
  unknown: "待补充",
  warn: "警告",
  pass: "通过",
  not_applicable: "不适用",
};

function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatYuan(cents: number): string {
  return `¥${(cents / 100).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
}

/** 人话规格摘要（复用工作台 CATEGORY_META）；空规格返回空串 */
function specSummaryOf(category: string, spec: ItemSpec): string {
  const meta = (CATEGORY_META as Record<string, { summary: (s: ItemSpec) => string }>)[category];
  return meta ? meta.summary(spec) : "";
}

const TYPE_LABELS: Record<string, string> = {
  cpu: "CPU",
  motherboard: "主板",
  gpu: "显卡",
  ram: "内存",
  storage: "SSD/HDD",
  psu: "电源",
  cooler: "散热器",
  case: "机箱",
};

export default function ReportPage() {
  const params = useParams<{ id: string }>();
  const buildId = params.id;
  const [build, setBuild] = useState<Build | null>(null);
  const [check, setCheck] = useState<CheckPayload>(null);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [buildRes, checkRes] = await Promise.all([
          fetch(`/api/builds/${buildId}`),
          fetch(`/api/builds/${buildId}/check`),
        ]);
        if (buildRes.status === 404 || checkRes.status === 404) {
          if (!cancelled) setNotFound(true);
          return;
        }
        if (!buildRes.ok || !checkRes.ok) throw new Error("failed");
        const buildData = await buildRes.json();
        const checkData = await checkRes.json();
        if (!cancelled) {
          setBuild(buildData.build);
          setCheck(checkData.check ?? null);
        }
      } catch {
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [buildId]);

  if (notFound) {
    return (
      <main className="report-page">
        <p className="helper">找不到该项目，可能已被删除。</p>
        <p className="helper">
          <Link href="/projects">回方案库</Link>
        </p>
      </main>
    );
  }

  if (loadError) {
    return (
      <main className="report-page">
        <p className="helper">报告加载失败，请确认开发服务器正在运行。</p>
      </main>
    );
  }

  if (!build) {
    return (
      <main className="report-page">
        <p className="helper">报告生成中…</p>
      </main>
    );
  }

  const grouped = STATUS_ORDER.map((status) => ({
    status,
    label: STATUS_SECTION_LABEL[status] ?? status,
    findings: (check?.findings ?? []).filter((finding) => finding.status === status),
  })).filter((group) => group.findings.length > 0);

  const summary = build.budgetSummary;

  return (
    <main className="report-page">
      <div className="report-actions">
        <Link href="/diy">← 回高级 DIY</Link>
        <button className="button secondary" onClick={() => window.print()}>
          打印 / 导出 PDF
        </button>
      </div>

      {/* 图框标题栏：工程图纸语言 */}
      <div className="report-frame">
        <div className="report-brand">RIGMATE · 装机方案检查报告</div>
        <h1 className="report-title">{build.name}</h1>
        <div className="report-metagrid">
          <span>用途</span>
          <span>{build.useCase ?? "—"}</span>
          <span>检查时间</span>
          <span>{check ? formatTime(check.createdAt) : "尚未运行"}</span>
          <span>报告生成</span>
          <span>{formatTime(new Date().toISOString())}</span>
          <span>结论状态</span>
          <span>
            {check
              ? check.stale
                ? "清单在检查后有变动，以下结论可能过期"
                : "基于当前清单"
              : "尚未运行兼容性检查"}
          </span>
        </div>
      </div>

      {/* 摘要数据行 */}
      <div className="report-dateline">
        <span>
          <em>{build.items.length}</em> 配件
        </span>
        <span>
          已计价 <em>{summary ? formatYuan(summary.pricedTotalCents) : "—"}</em>
        </span>
        <span>
          未计价 <em>{summary ? summary.unpricedCount : "—"}</em> 件
        </span>
        <span>
          预算 <em>{build.budgetCents !== null ? formatYuan(build.budgetCents) : "未设置"}</em>
        </span>
        <span>
          余量 <em>{summary?.differenceCents != null ? formatYuan(summary.differenceCents) : "—"}</em>
        </span>
      </div>

      {/* 清单规格表 */}
      <section className="report-sec">
        <h2>装机清单</h2>
        <table className="report-table">
          <thead>
            <tr>
              <th>类型</th>
              <th>型号 / 关键规格</th>
              <th className="num">价格</th>
            </tr>
          </thead>
          <tbody>
            {build.items.map((item) => {
              const summary = specSummaryOf(item.category, item.spec);
              return (
                <tr key={item.id}>
                  <td>{TYPE_LABELS[item.category] ?? item.category}</td>
                  <td>
                    {item.label}
                    {summary ? (
                      <span className="report-item-spec"> · {summary}</span>
                    ) : (
                      <span className="report-item-spec"> · 规格待补充</span>
                    )}
                  </td>
                  <td className="num">
                    {item.priceCents != null ? formatYuan(item.priceCents) : "—"}
                  </td>
                </tr>
              );
            })}
            {build.items.length === 0 && (
              <tr>
                <td colSpan={3}>清单为空。</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {/* 兼容性诊断条款 */}
      <section className="report-sec">
        <h2>兼容性诊断</h2>
        {!check && (
          <p className="helper">
            回
            <Link href="/diy"> 高级 DIY </Link>
            重新检查后，报告会带上结论条款。
          </p>
        )}
        {check && grouped.length === 0 && <p className="helper">检查未产生条款。</p>}
        {grouped.map((group) => (
          <div key={group.status}>
            <h3 className="report-group">
              {group.label} · {group.findings.length}
            </h3>
            {group.findings.map((finding) => {
              const model = toFindingCardModel(finding);
              // 阻断/警告需要完整证据链；待补充/通过是"一行结论"——铺满卡片只会稀释重点
              if (model.status === "block" || model.status === "warn") {
                return (
                  <article className="report-finding" key={model.ruleId + model.conclusion}>
                    <div className="report-finding-head">
                      <span className={`report-status report-status-${model.status}`}>{model.statusLabel}</span>
                      <strong>{model.conclusion}</strong>
                      <code className="report-rule">{model.ruleId}</code>
                    </div>
                    {model.evidenceLines.length > 0 && (
                      <p className="report-line">
                        证据：{model.evidenceLines.join("；")}
                      </p>
                    )}
                    {model.missingFields.length > 0 && (
                      <p className="report-line">
                        待补充：{model.missingFields.join("、")}
                      </p>
                    )}
                    {model.assumptions.length > 0 && (
                      <p className="report-line">假设条件：{model.assumptions.join("；")}</p>
                    )}
                    {model.suggestedAction && <p className="report-line">下一步：{model.suggestedAction}</p>}
                  </article>
                );
              }
              const line =
                model.status === "unknown"
                  ? model.suggestedAction || `待补充：${model.missingFields.join("、")}`
                  : model.conclusion;
              return (
                <p className="report-mini" key={model.ruleId + model.conclusion}>
                  <code className="report-rule">{model.ruleId}</code>
                  <span>{line}</span>
                </p>
              );
            })}
          </div>
        ))}
      </section>

      {/* 数据来源与说明 */}
      <section className="report-sec report-notes">
        <h2>数据与说明</h2>
        <p className="report-line">
          · 结论由确定性规则引擎生成，每个结论可追溯到规则编号与已录入字段；缺失字段不会用常见值代替事实。
        </p>
        <p className="report-line">
          · 型号目录由人工种子目录与 BuildCores OpenDB（ODC-By 1.0）三层合并构成，署名随数据保留。
        </p>
        <p className="report-line">· 本报告不构成价格建议；价格判断需要带来源的价格证据（V1-B）。</p>
      </section>
    </main>
  );
}
