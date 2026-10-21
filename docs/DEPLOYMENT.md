# RigMate 部署与运维说明（内部 Alpha）

> 适用版本：schema v14 ｜ 最后更新：2026-10-15
> 受众：部署与运维本系统的开发/审核人员。内部 Alpha 为**受控小范围**使用——单实例、无多用户鉴权，不暴露公网。

## 1. 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `RIGMATE_DB_PATH` | 否 | SQLite 路径，默认 `./data/rigmate.db`；目录不存在自动创建，schema 自动迁移 |
| `RIGMATE_LLM_API_KEY` | 否 | **总开关**：不配 = 纯规则模式（全部功能可用，质量基线见下"降级"节） |
| `RIGMATE_LLM_BASE_URL` | 否 | OpenAI 兼容端点（`/chat/completions`），默认 openai 官方 |
| `RIGMATE_LLM_MODEL` | 否 | 模型名；当前产线为 GLM 编码套餐 glm-5.3-flash |
| `RIGMATE_LLM_TIMEOUT_MS` | 否 | 单次请求超时（默认 12000） |
| `RIGMATE_LLM_THINKING` | 否 | `disabled` = 全局关思考（当前五类调用已全部按评测数据关思考，此变量仅作应急开关） |
| `RIGMATE_LLM_ATTEMPT_DEADLINE_MS` | 否 | 创建整轮截止预算（默认 20000，超时回退规则） |
| `RIGMATE_BUILDCORES_CATALOG_PATH` | 否 | 目录导入产物路径（默认 `./data/catalog/buildcores.json`） |

配置模板见 `.env.example`。**key 不落盘、不打印、不出现在用户可见错误里（有测试钉死）**。

## 2. 数据库：初始化 / 迁移 / 备份 / 恢复

- **初始化与迁移**：首次启动自动建表并按版本化迁移到最新 schema（`[rigmate-db]` 前缀日志）；启动即迁移，无需手工步骤。数据库版本高于代码时**拒绝迁移**（防旧代码写坏新库）。
- **备份**：`npm run db:backup` —— WAL checkpoint 后拷贝到 `data/backups/rigmate-<时间戳>.db`。
- **恢复演练**：`npm run db:restore-verify -- data/backups/<文件>` —— 还原到临时路径，断言 schema 版本一致 + 关键表行数一致（design_requests / design_proposals / agent_event_log / canonical_products / builds）。
- **手工恢复**：停进程 → 用备份文件覆盖 `RIGMATE_DB_PATH` → 启动（迁移自动补齐差额版本）。
- **演练记录（2026-10-15）**：v14 + 五表行数一致，通过。

## 3. 日志与脱敏边界

- **服务端 console 仅两处**：迁移进度（`[rigmate-db]`）与编排器工具故障（`[agent-orchestrator]`）——面向操作者，可含内部细节，不进用户界面。
- **用户可见错误**：LLM 客户端错误信息不含密钥（有单测钉死）；业务错误用稳定错误码（`PROPOSAL_NOT_FOUND` 等）。
- **`agent_event_log` 存用户原文**（目标描述、修订指令、意图快照、回答）——这是会话回放与审计的功能所需，不是日志泄漏。诊断页 `/diagnostics` 会展示目标原文，属**管理员入口**，部署时不应暴露给普通用户。
- **不采集**：无第三方统计、无 cookie 追踪、无遥测（Next telemetry 已禁用）。

## 4. 模型故障降级（故障切换）

模型不可用（未配 key / 超时 / schema 不合格 / 候选池外 ID）时，**每一步都有规则兜底**，主流程不中断：

| 环节 | 模型路径 | 降级路径 |
|---|---|---|
| 意图解析 | LLM 结构化解析（含追问建议） | 本地规则解析 + 固定追问文案（质量基线：预算 93.3%/F1 97.1%） |
| 候选选择 | LLM 在质量门候选内挑选 | 同一候选集规则排序 |
| 换件 | LLM 提案（冲突消除才采纳） | 保留原组合 |
| 建议 | 独立通道，失败仅空建议 | 无建议，方案不受影响 |

降级全部以事件留痕（`anomaly` + fallback 字段），用户看到真实模式标注，不冒充"AI 智能"。**五类调用均关思考（评测数据驱动）**，LLM 开启时整轮创建 P50 约 60-90 秒；关闭时秒级。

## 5. Docker 部署

```bash
docker build -t rigmate:alpha .
docker run -d --name rigmate -p 3000:3000 -v rigmate-data:/app/data rigmate:alpha
# 首次启动自动建库并迁移到最新 schema；数据持久在 rigmate-data 卷
```

实测记录见 Dockerfile 头注释。

## 6. 内部 Alpha 检查清单

- [x] 备份脚本跑通 + 恢复演练通过（2026-10-16，v14 + 五表行数一致）
- [x] Docker 构建/运行/自动迁移验证（2026-10-16 实测，见 Dockerfile 头注释）
- [x] `.env.local` 就位（GLM key，容器经 `--env-file` 注入）
- [x] Alpha 实例已启动（2026-10-16）：`docker run -d --name rigmate-alpha --restart unless-stopped -p 3000:3000 --env-file .env.local -e RIGMATE_DB_PATH=/app/data/rigmate.db -v "D:/XyyWork/RigMate/data:/app/data" rigmate:alpha`，挂真实数据卷；冒烟通过（30s 出全方案 + 4 条建议）
- [x] 真实库备份（data/backups/；**建议定期离机拷贝一份**）
- [x] 定位收口：**自测模式**（2026-10-16 定）——仅本机 localhost:3000 使用，无需防火墙放行、不邀请外部用户；后续如需给他人访问再放行 TCP 3000
- [ ] 自测约定：价格均为证据价或经验估算（非实时成交价）；建议区内容不参与兼容检查——遇到与预期不符时记下会话页 URL 与当时的目标描述即可

### 自测速查

- 访问：`http://localhost:3000`（容器开机自启；不想常驻就 `docker stop rigmate-alpha`，要用再 `docker start rigmate-alpha`）
- 更新代码后：`docker build -t rigmate:alpha . && docker rm -f rigmate-alpha` 再按第 6 节命令重启（数据卷不变）
- 出问题先看：`docker logs rigmate-alpha --tail 50`；数据异常先 `npm run db:backup` 再排查

> **2026-10-16 补充**：Docker Desktop 关闭再启动时，`--restart unless-stopped` 的容器会被 daemon 自动拉起（无需手动）——但**镜像不会自动更新**：提交新代码后仍需 `docker build` + `docker rm -f` + 按第 6 节重启。
> **Git Bash 注意**：`docker run` 的 `-e RIGMATE_DB_PATH=/app/...` 必须加 `MSYS_NO_PATHCONV=1`，否则 MSYS 会把路径改写成宿主 Git 安装路径（2026-10-16 实踩：应用在容器内错误路径自建空库，好在数据卷未被污染）。
> **停止/更新**：`docker stop rigmate-alpha`；更新代码后 `docker build -t rigmate:alpha . && docker rm -f rigmate-alpha` 再按上面命令重启（数据卷不变）。
