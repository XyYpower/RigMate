# 内部 Alpha 准备实施计划（launch-readiness Phase 6 前置 / blueprint M7）

**Goal:** 打通"给真实用户用"之前的最后一公里：数据库备份/恢复可脚本化并实测演练、Docker 镜像构建运行实测（M33 遗留"未实测"标记）、日志脱敏边界成文、发布说明落档。

**Architecture:** 备份用 SQLite 原生 WAL checkpoint + 文件拷贝（不引依赖）；恢复演练 = 把备份还原到临时路径，用迁移读取器验证 schema 版本与关键行数；Docker 实测按 Dockerfile 现有形态构建运行，暴露问题就地修。

---

### Task 1: 备份/恢复脚本化 + 演练

**Files:**
- Create: scripts/backup-db.ts（WAL checkpoint → 时间戳文件拷贝 → 打印路径；`npm run db:backup`）
- Create: scripts/restore-verify.ts（把指定备份还原到临时路径 → 打开库 → 断言 schema 版本一致 + 关键表行数一致；`npm run db:restore-verify -- <backupFile>`）
- Modify: package.json（两个脚本入口）

- [ ] 实测：对真实库备份 → 恢复演练通过（版本 v14、行数一致）。
- [ ] 提交 `feat: database backup and restore-verify scripts`。

### Task 2: Docker 构建运行实测（M33 遗留）

- [ ] Docker Desktop 启动 → `docker build -t rigmate:alpha .` → `docker run`（临时卷+端口）→ curl 健康路径（首页 200 + 全新库自动迁移）→ 清理。
- [ ] 遇到的问题就地修 Dockerfile；把实测结果写回文件头注释（去掉"未实测"标记）。
- [ ] 提交 `feat: docker image verified for alpha`（如有 Dockerfile 改动）。

### Task 3: 日志脱敏审查 + 发布说明

**Files:**
- Create: docs/DEPLOYMENT.md（环境变量清单 / 数据库初始化·迁移·备份恢复 / 日志与脱敏边界 / LLM 故障降级说明 / Docker 部署步骤 / Alpha 检查清单）
- 审查结论（成文）：服务端 console 仅两处（orchestrator 工具故障、迁移日志），面向操作者可含内部细节；用户可见错误已测不含密钥；agent_event_log 存用户原文（会话功能所需），诊断页为管理员入口——边界全部写入 DEPLOYMENT.md。

- [ ] 提交 `docs: deployment guide for internal alpha`。

### Task 4: 门禁 + 文档 v4.35 + 推送

### 明确不做

- feature flag 灰度、claim 离线评测（Phase 5 余量，等 Alpha 反馈排期）；
- 多用户/鉴权体系：Alpha 是受控小范围，明确写入 DEPLOYMENT.md 的边界。
