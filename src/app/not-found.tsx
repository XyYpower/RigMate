import Link from "next/link";

export default function NotFound() {
  return (
    <main className="route-loading">
      <h1>页面不存在</h1>
      <p>它可能已被移动或删除。</p>
      <div className="route-actions">
        <Link className="button secondary" href="/">
          回首页<span aria-hidden>→</span>
        </Link>
      </div>
    </main>
  );
}
