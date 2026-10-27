"use client";

/**
 * 统一加载失败反馈（DESIGN.md v3 自解释原则 2）：
 * 短句 + 就近重试动作，禁止向用户暴露部署细节
 * （此前 6 处「加载失败，请确认开发服务器正在运行。」把 dev server 概念漏给了用户）。
 */
export function LoadError({ label = "暂时没有加载出来", onRetry }: { label?: string; onRetry: () => void }) {
  return (
    <p className="load-error" role="status">
      {label}。<button type="button" className="load-error-retry" onClick={onRetry}>重试</button>
    </p>
  );
}
