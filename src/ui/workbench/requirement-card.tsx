import type { RequirementSummary } from "./types";

/** 你的需求摘要卡（参考图右栏下半）：从结构化意图映射的只读事实 */
export function RequirementCard({ items }: { items: RequirementSummary[] }) {
  return (
    <section className="wb-panel requirement-card" aria-labelledby="requirement-title">
      <div className="requirement-card-head">
        <h2 id="requirement-title">你的需求</h2>
      </div>
      <dl>
        {items.map((item) => (
          <div key={item.label}>
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
