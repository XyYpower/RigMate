import type { Metadata } from "next";
import "./globals.css";
import { AmbientBackground } from "@/ui/ambient-background";

export const metadata: Metadata = {
  title: "RigMate · DIY 装机工作台",
  description: "基于确定性规则的 PC DIY 装机清单检查工具。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <AmbientBackground />
        {children}
      </body>
    </html>
  );
}
