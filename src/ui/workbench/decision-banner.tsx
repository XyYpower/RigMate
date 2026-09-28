import type { ReactNode } from "react";

/**
 * 决策条（参考图：浅橙底"现在需要你决定"）。
 * 内容来自真实的待确认项，动作由页面注入——不编造参考差异或价格。
 */
export function DecisionBanner({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions: ReactNode;
}) {
  return (
    <section className="decision-banner" aria-label="现在需要你决定">
      <div className="decision-banner-main">
        <span className="decision-banner-icon" aria-hidden>💡</span>
        <div>
          <span className="decision-banner-kicker">现在需要你决定</span>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
      </div>
      <div className="decision-banner-actions">{actions}</div>
    </section>
  );
}
