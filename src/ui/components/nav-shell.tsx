"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/", label: "开始配置", ready: true },
  { href: "/projects", label: "我的方案", ready: true },
  { href: "/diy", label: "高级 DIY", ready: true },
  { href: "/hardware", label: "硬件资料", ready: true },
  { href: "/evidence", label: "价格证据", ready: true },
] as const;

/** 全局导航壳（M22 系统布局第一步）：四区结构来自 docs/design/10-系统布局规划.md */
export function NavShell() {
  const pathname = usePathname();
  return (
    <nav className="nav-shell">
      <span className="nav-brand">RIGMATE</span>
      <div className="nav-links">
        {NAV_ITEMS.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`nav-link${active ? " active" : ""}${item.ready ? "" : " planned"}`}
              title={item.ready ? undefined : "规划中（docs/design/10-系统布局规划.md）"}
            >
              {item.label}
              {!item.ready && <span className="nav-planned-mark">规划中</span>}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
