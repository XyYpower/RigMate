"use client";

import Link from "next/link";

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="route-loading">
      <h1>页面出错了</h1>
      <p>刷新重试通常可以解决；如果反复出现，请回首页继续。</p>
      <div className="route-actions">
        <button className="button primary" onClick={reset}>
          重试<span aria-hidden>↻</span>
        </button>
        <Link className="button secondary" href="/">
          回首页<span aria-hidden>→</span>
        </Link>
      </div>
    </main>
  );
}
