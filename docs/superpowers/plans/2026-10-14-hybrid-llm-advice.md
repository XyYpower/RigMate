# Hybrid LLM Advice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让 LLM 可以基于自身知识提出经验建议和数据库外产品线索，同时保证正式方案中的产品、规格、价格和兼容性仍由目录与规则确认。

**Architecture:** 在现有严格候选选择链路旁增加独立的 advice lane。LLM 的正式选件仍只能返回目录候选 ID；新增 advice 调用只输出带来源标签的经验建议或待核验产品提示，不参与方案落库、价格计算或兼容检查。建议作为方案的一部分持久化，并在会话卡片与完整工作台中单独展示。

**Tech Stack:** Next.js 16 Route Handlers、TypeScript、Zod、Drizzle/SQLite、Vitest。

---

### Task 1: 增加经验建议契约与数据库字段

**Files:**
- Modify: src/contracts/design.ts
- Modify: src/infra/db/client.ts
- Modify: src/infra/db/migrate.ts
- Modify: src/infra/db/repositories/design-repository.ts
- Test: tests/infra/migrate.test.ts
- Test: tests/application/design-advice.test.ts

- [ ] **Step 1: 写 schema 失败测试**

测试 experienceAdvice 能区分经验建议和数据库外产品提示，并拒绝价格、规格等未验证事实字段：

~~~ts
expect(designProposalSchema.parse({ ...proposal, experienceAdvice: [{ kind: "experience_advice", category: "gpu", title: "显存取舍", detail: "预算允许时优先更大显存", requiresVerification: false }] }).experienceAdvice).toHaveLength(1);
expect(() => experienceAdviceItemSchema.parse({ kind: "external_product_hint", category: "gpu", title: "建议型号", detail: "RTX 5090 24GB，约 ¥19999", requiresVerification: true })).toThrow();
~~~

- [ ] **Step 2: 运行测试确认失败**

运行 npx vitest run tests/application/design-advice.test.ts tests/infra/migrate.test.ts，预期因 schema 和字段不存在而失败。

- [ ] **Step 3: 实现契约和持久化**

在 src/contracts/design.ts 增加严格的 experienceAdviceItemSchema：

~~~ts
const experienceAdviceItemSchema = z.object({
  kind: z.enum(["experience_advice", "external_product_hint"]),
  category: buildItemCategorySchema,
  title: z.string().trim().min(1).max(120),
  detail: z.string().trim().min(1).max(500),
  productName: z.string().trim().min(1).max(160).optional(),
  requiresVerification: z.boolean(),
}).strict().superRefine((value, ctx) => {
  if (value.kind === "external_product_hint" && !value.productName) {
    ctx.addIssue({ code: "custom", path: ["productName"], message: "数据库外产品提示必须有产品名" });
  }
  if (value.kind === "experience_advice" && value.productName) {
    ctx.addIssue({ code: "custom", path: ["productName"], message: "经验建议不能携带未验证产品名" });
  }
});
~~~

给 DesignProposal 增加 experienceAdvice，默认空数组。给 design_proposals 增加 experience_advice JSON 列，schema 版本从 13 升到 14，迁移必须幂等；读写 repository 时通过 schema 解析。

- [ ] **Step 4: 运行测试确认通过**

运行同一组 Vitest，预期 schema、旧数据库迁移和新字段读写测试通过。

- [ ] **Step 5: 提交**

~~~bash
git add src/contracts/design.ts src/infra/db/client.ts src/infra/db/migrate.ts src/infra/db/repositories/design-repository.ts tests/infra/migrate.test.ts tests/application/design-advice.test.ts
git commit -m "feat: persist grounded model advice"
~~~

### Task 2: 实现独立的 advice LLM 调用与守卫

**Files:**
- Create: src/application/design/advice-llm.ts
- Modify: src/application/agent/prompts/registry.ts
- Create: src/application/agent/prompts/advice-v1.ts
- Test: tests/application/design-advice.test.ts

- [ ] **Step 1: 写失败测试**

覆盖四种情况：合法经验建议、合法数据库外产品提示、输出价格/规格时 schema 拒绝、输出不存在类别时拒绝；调用失败返回 ok=false，不影响正式方案。

- [ ] **Step 2: 实现严格输出 schema**

advice-llm.ts 只允许 suggestions 数组，每项只能包含 kind/category/title/detail/productName/requiresVerification。提示词明确：不能输出价格、尺寸、接口、功耗、兼容性结论；数据库外产品必须标记 requiresVerification: true；经验建议只能作为建议。

- [ ] **Step 3: 实现调用函数**

导出 generateExperienceAdvice({ intent, proposal, candidates, config, fetchImpl })，使用现有 completeJson，最多返回 4 条。输入只包含方案摘要、候选名称/质量状态/决策规格和兼容摘要，不传数据库行、密钥或原始网页。

- [ ] **Step 4: 运行测试确认通过**

运行 npx vitest run tests/application/design-advice.test.ts，预期全部通过。

- [ ] **Step 5: 提交**

~~~bash
git add src/application/design/advice-llm.ts src/application/agent/prompts/registry.ts src/application/agent/prompts/advice-v1.ts tests/application/design-advice.test.ts
git commit -m "feat: add guarded model advice lane"
~~~

### Task 3: 接入创建和修订流程，保持正式方案严格来源

**Files:**
- Modify: src/application/design/service.ts
- Modify: src/application/agent/orchestrator.ts
- Test: tests/application/design-service.test.ts
- Test: tests/application/agent-orchestrator.test.ts

- [ ] **Step 1: 写失败测试**

验证配置 LLM 时：正式 items 的 catalogId 仍来自候选池；experienceAdvice 可以包含 external_product_hint；模型 advice 超时或 schema 失败时方案仍成功生成且 advice 为空；修订流程同样保留建议。

- [ ] **Step 2: 接入 advice 调用**

在创建和修订的确定性 proposal 生成并完成兼容检查后调用 advice。建议调用失败只发 tool_call error/anomaly 事件并继续；成功发 tool_call done 事件。正式 proposal 生成、价格、规则检查和接受路径不读取 advice。

- [ ] **Step 3: 限制输入和输出**

传给 advice 的候选只取每类前 4 条，外部提示只能以文本建议存在；禁止将 advice 的产品名映射成 proposal.items，禁止把 advice 数值写入价格、规格或 unknowns。

- [ ] **Step 4: 运行测试确认通过**

运行 npx vitest run tests/application/design-service.test.ts tests/application/agent-orchestrator.test.ts，预期正式方案和回退测试全部通过。

- [ ] **Step 5: 提交**

~~~bash
git add src/application/design/service.ts src/application/agent/orchestrator.ts tests/application/design-service.test.ts tests/application/agent-orchestrator.test.ts
git commit -m "feat: expose model advice beside verified proposal"
~~~

### Task 4: 展示建议来源并完成质量验证

**Files:**
- Modify: src/ui/session/proposal-card.tsx
- Modify: src/ui/session/design-workbench.tsx
- Modify: src/ui/session/session.css
- Test: tests/ui/session-state.test.ts
- Test: tests/ui/workbench-views.test.ts

- [ ] **Step 1: 写失败测试**

验证建议标题“经验建议”和“待验证产品”能分别渲染，正式配置列表不出现数据库外产品名。

- [ ] **Step 2: 实现展示**

在方案卡和完整工作台增加独立的“模型建议”区域：experience_advice 显示“经验建议”，external_product_hint 显示“待验证产品”，并展示“不会参与当前兼容检查/价格计算”的说明。没有建议时不渲染空区域。

- [ ] **Step 3: 运行测试确认通过**

运行 npx vitest run tests/ui/session-state.test.ts tests/ui/workbench-views.test.ts。

- [ ] **Step 4: 提交**

~~~bash
git add src/ui/session/proposal-card.tsx src/ui/session/design-workbench.tsx src/ui/session/session.css tests/ui/session-state.test.ts tests/ui/workbench-views.test.ts
git commit -m "feat: label model advice in proposal views"
~~~

### Task 5: 运行完整质量门

**Files:**
- No source changes expected.

- [ ] **Step 1: 运行单元质量门**

运行 npm run lint && npm run typecheck && npm test，修复本次变更引起的类型、lint 或回归问题。

- [ ] **Step 2: 运行构建**

运行 npm run build，确认 Next.js 16 Route Handler 与服务端数据库迁移均可编译。

- [ ] **Step 3: 运行数据门禁**

运行 npx tsx scripts/data-release-gate.ts，确认 schema v14、目录质量和价格绑定检查通过。

- [ ] **Step 4: 更新协作文档并提交**

在 docs/AI_COLLABORATION.md 进度快照中记录 advice lane 的来源边界和验证结果，只提交 A 线文件与本次计划/规格，不包含 B 线已有未提交文件。
