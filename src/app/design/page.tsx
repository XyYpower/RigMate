"use client";

import Link from "next/link";
import { SessionListSection } from "@/ui/session/session-list-section";

/**
 * /design 兼容路由：方案会话列表已归属「我的方案 → AI 会话」页签
 * （DESIGN.md v3，消除双入口）。此路由保留旧链接兼容，UI 与页签完全一致。
 */
export default function DesignSessionsPage() {
  return (
    <main className="session-page session-list-page">
      <header className="session-header">
        <div className="session-header-main">
          <h1>AI 会话</h1>
        </div>
        <div className="session-header-actions">
          <Link className="button primary" href="/">新建目标</Link>
        </div>
      </header>
      <SessionListSection />
    </main>
  );
}
