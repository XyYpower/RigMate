import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 是原生模块，不能被打包
  serverExternalPackages: ["better-sqlite3"],
  // E2E 用独立构建目录，避免与正在运行的 dev server 争用 .next 锁
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // 本机用 127.0.0.1 打开开发页时，Next 16 默认按跨域阻断 dev 资源（客户端 JS 不水合、
  // 页面只显示服务端渲染的空壳）。显式放行本机回环来源，别把开发环境锁死。
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
