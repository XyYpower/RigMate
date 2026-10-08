"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** 导航项内联线性图标（16px，stroke 1.6，零依赖） */
function NavIcon({ kind }: { kind: string }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (kind) {
    case "start":
      return (
        <svg {...common}>
          <path d="M8 2.5 13.5 7v6.5h-4V9.5h-3v4h-4V7L8 2.5Z" />
        </svg>
      );
    case "plan":
      return (
        <svg {...common}>
          <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
          <path d="M5.5 6h5M5.5 8.5h5M5.5 11h3" />
        </svg>
      );
    case "hardware":
      return (
        <svg {...common}>
          <rect x="4" y="4" width="8" height="8" rx="1.5" />
          <path d="M6.5 1.5v2.5M9.5 1.5v2.5M6.5 12v2.5M9.5 12v2.5M1.5 6.5H4M1.5 9.5H4M12 6.5h2.5M12 9.5h2.5" />
        </svg>
      );
    case "diy":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="2.5" />
          <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <path d="M4 2h6l2.5 2.5V14H4V2Z" />
          <path d="M6 7.5h4M6 10h4M6 4.5h1.5" />
        </svg>
      );
  }
}

type NavEntry = {
  href: string;
  label: string;
  icon: string;
  match: (path: string) => boolean;
};

/** 三个主入口（DESIGN.md §6 BrandSidebar）：方案页 /design/[id] 归属"我的方案" */
const NAV_ITEMS: NavEntry[] = [
  { href: "/", label: "开始配置", icon: "start", match: (p) => p === "/" },
  { href: "/projects", label: "我的方案", icon: "plan", match: (p) => p === "/projects" || p.startsWith("/design/") },
  { href: "/hardware", label: "硬件资料", icon: "hardware", match: (p) => p.startsWith("/hardware") },
];

/** 场景入口：高级流程与数据台账，从任何页面都可到达 */
const SCENE_ITEMS: NavEntry[] = [
  { href: "/diy", label: "高级 DIY", icon: "diy", match: (p) => p.startsWith("/diy") || p.startsWith("/builds/") },
  { href: "/evidence", label: "证据台账", icon: "evidence", match: (p) => p.startsWith("/evidence") },
];

function NavLink({ item, pathname }: { item: NavEntry; pathname: string }) {
  const active = item.match(pathname);
  return (
    <Link
      href={item.href}
      className={`brand-nav-item${active ? " active" : ""}`}
      aria-current={active ? "page" : undefined}
    >
      <NavIcon kind={item.icon} />
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
          <small>装机决策台</small>
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
