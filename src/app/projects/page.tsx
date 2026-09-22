import Link from "next/link";

export const metadata = { title: "方案库 · 规划中 | RigMate" };

export default function ProjectsPage() {
  return (
    <main className="placeholder-page">
      <h1>方案库</h1>
      <p className="placeholder-line">
        规划中：历史项目列表、整机复核（粘贴配置单 → 解析 → 检查）、报告导出。
      </p>
      <p className="placeholder-line">
        结构见 <code>docs/design/10-系统布局规划.md</code> §1/§2；当前请使用
        <Link href="/"> 装机配置 </Link>工作台顶部的历史项目下拉。
      </p>
    </main>
  );
}
