# syntax=docker/dockerfile:1
# RigMate 生产镜像（M33）。
# 注意：本机未安装 Docker 时无法实测构建，此文件按标准 Next.js + better-sqlite3
# 形态编写；首次部署如遇原生模块编译问题，builder 阶段已含构建工具链。
# 运行时数据（SQLite）在 /app/data，请挂载持久卷：docker run -v rigmate-data:/app/data

FROM node:24-slim AS builder
WORKDIR /app
# better-sqlite3 无预编译产物时需要本地编译
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:24-slim AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV RIGMATE_DB_PATH=/app/data/rigmate.db
WORKDIR /app
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts
RUN mkdir -p /app/data
VOLUME ["/app/data"]
EXPOSE 3000
CMD ["npm", "run", "start"]
