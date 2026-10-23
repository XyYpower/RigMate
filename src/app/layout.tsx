import type { Metadata, Viewport } from "next";
import { WorkbenchShell } from "@/ui/workbench/workbench-shell";
import "./globals.css";

const BRAND_TITLE = "RigMate · PC 装机决策工作台";
const BRAND_DESCRIPTION = "一句话描述装机目标，自动检索已核目录、跑兼容规则，给出可核验的装机方案。";

export const metadata: Metadata = {
  title: BRAND_TITLE,
  description: BRAND_DESCRIPTION,
  applicationName: "RigMate",
  openGraph: {
    title: BRAND_TITLE,
    description: BRAND_DESCRIPTION,
    type: "website",
    locale: "zh_CN",
    siteName: "RigMate",
  },
  twitter: {
    card: "summary",
    title: BRAND_TITLE,
    description: BRAND_DESCRIPTION,
  },
};

export const viewport: Viewport = {
  themeColor: "#f4f5f6",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <WorkbenchShell>{children}</WorkbenchShell>
      </body>
    </html>
  );
}
