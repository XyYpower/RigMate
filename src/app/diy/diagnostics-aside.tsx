import { FindingCard } from "@/ui/components/finding-card";
import { StatusChip } from "@/ui/components/status-chip";
import { formatTime } from "./types";
import type { DiyWorkspace } from "./use-diy-projects";

/** 诊断右栏：状态计数 + 结论列表（渐进披露）+ 检查历史 */
export function DiagnosticsAside({ diy }: { diy: DiyWorkspace }) {
  const { findings, resultMeta, counts, problemFindings, passedFindings, collapsePasses, checkHistory } = diy;
  return (
    <aside className="diy-aside">
      <section className="sec">
        <div className="results-head">
          <h3 className="sec-title">兼容性诊断</h3>
          {findings.length > 0 && resultMeta && (
            <span className="result-time">结果时间：{resultMeta.time}</span>
          )}
        </div>
        {resultMeta?.stale && (
          <div className="stale-banner">清单在这次检查之后发生过变化，以下结论基于旧清单，请重新运行检查。</div>
        )}
        <div className="tally">
          <StatusChip status="block" count={counts.block} />
          <StatusChip status="unknown" count={counts.unknown} />
          <StatusChip status="warn" count={counts.warn} />
          <StatusChip status="pass" count={counts.pass} />
        </div>
        {findings.length ? (
          <div className="findings">
            {problemFindings.map((finding) => (
              <FindingCard key={finding.ruleId} finding={finding} />
            ))}
            {collapsePasses && (
              <details className="findings-passed">
                <summary>通过 {passedFindings.length} 项 · 无需处理的结论已折叠</summary>
                {passedFindings.map((finding) => (
                  <FindingCard key={finding.ruleId} finding={finding} />
                ))}
              </details>
            )}
            {!collapsePasses &&
              passedFindings.map((finding) => <FindingCard key={finding.ruleId} finding={finding} />)}
          </div>
        ) : (
          <p className="empty-line">
            尚无检查结果。录入配件后点右上角「重新检查」，结论会按阻断、待补充、警告、通过排列。
          </p>
        )}
        {checkHistory.length > 0 && (
          <details className="check-history">
            <summary>检查历史 · {checkHistory.length} 次</summary>
            <ul>
              {checkHistory.map((run) => (
                <li key={run.id}>
                  <time>{formatTime(run.createdAt)}</time>
                  <span>
                    阻断 {run.counts.block} · 待补充 {run.counts.unknown} · 警告 {run.counts.warn} · 通过{" "}
                    {run.counts.pass}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </aside>
  );
}
