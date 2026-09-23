"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/", label: "装机配置", ready: true },
  { href: "/hardware", label: "硬件中心", ready: true },
  { href: "/projects", label: "方案库", ready: true },
  { href: "/evidence", label: "证据台账", ready: true },
] as const;

/** 全局导航壳（M22 系统布局第一步）：四区结构来自 docs/design/10-系统布局规划.md */
export function NavShell() {
  const pathname = usePathname();
  return (
    <nav className="nav-shell">
      <span className="nav-brand">RIGMATE</span>
      <div className="nav-links">
        {NAV_ITEMS.map((item) => {
          const active = item.ready && pathname === item.href;
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
