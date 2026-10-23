"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  ClipboardList,
  Cpu,
  FolderOpen,
  MessageSquarePlus,
  MessagesSquare,
  Wrench,
  type LucideIcon,
} from "lucide-react";

type NavEntry = {
  href: string;
  label: string;
  icon: LucideIcon;
  match: (path: string) => boolean;
};

/** 四个主入口（DESIGN.md §6 BrandSidebar）：/design 为会话列表，/design/[id] 归属"方案会话" */
const NAV_ITEMS: NavEntry[] = [
  { href: "/", label: "开始配置", icon: MessageSquarePlus, match: (p) => p === "/" },
  { href: "/design", label: "方案会话", icon: MessagesSquare, match: (p) => p === "/design" || p.startsWith("/design/") },
  { href: "/projects", label: "我的方案", icon: FolderOpen, match: (p) => p === "/projects" },
  { href: "/hardware", label: "硬件资料", icon: Cpu, match: (p) => p.startsWith("/hardware") },
];

/** 场景入口：高级流程与数据台账，从任何页面都可到达 */
const SCENE_ITEMS: NavEntry[] = [
  { href: "/diy", label: "高级 DIY", icon: Wrench, match: (p) => p.startsWith("/diy") || p.startsWith("/builds/") },
  { href: "/evidence", label: "证据台账", icon: ClipboardList, match: (p) => p.startsWith("/evidence") },
  { href: "/diagnostics", label: "运行诊断", icon: Activity, match: (p) => p.startsWith("/diagnostics") },
];

function NavLink({ item, pathname }: { item: NavEntry; pathname: string }) {
  const active = item.match(pathname);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={`brand-nav-item${active ? " active" : ""}`}
      aria-current={active ? "page" : undefined}
    >
      <Icon size={16} strokeWidth={1.75} aria-hidden />
      <span>{item.label}</span>
    </Link>
  );
}

/** 左侧品牌导航（DESIGN.md §6）：三个主入口 + 场景入口分组；当前项浅橙底 + 橙图标 + 右短竖线 */
export function BrandSidebar() {
  const pathname = usePathname();
  return (
    <aside className="brand-sidebar">
      <div className="brand-block">
        <span className="brand-logo" aria-hidden>
          R
        </span>
        <span className="brand-copy">
          <strong>RigMate</strong>
          <small>PC 装机决策工作台</small>
        </span>
      </div>
      <nav className="brand-nav" aria-label="主导航">
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.label} item={item} pathname={pathname} />
        ))}
      </nav>
      <nav className="brand-nav brand-nav-scene" aria-label="场景入口">
        <p className="brand-nav-caption">场景入口</p>
        {SCENE_ITEMS.map((item) => (
          <NavLink key={item.label} item={item} pathname={pathname} />
        ))}
      </nav>
      <p className="brand-footnote">说清预算和用途，得到可核验的装机方案</p>
    </aside>
  );
}
