import type { Metadata } from "next";
import { NavShell } from "@/ui/components/nav-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "RigMate · PC 装机决策工作台",
  description: "用自然语言描述目标，自动生成、校验并调整你的 PC 装机方案。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <NavShell />
        {children}
      </body>
    </html>
  );
}
