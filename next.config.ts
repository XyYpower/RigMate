import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 是原生模块，不能被打包
  serverExternalPackages: ["better-sqlite3"],
  // E2E 用独立构建目录，避免与正在运行的 dev server 争用 .next 锁
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
};

export default nextConfig;
