import type { Finding } from "@/domain/build/types";
import type { BuildItemCategory } from "@/domain/build/types";
import type { CandidateSummary } from "@/domain/catalog/ranking";
import type { StructuredIntent } from "@/contracts/design";
import type { FieldQualityStatus } from "@/domain/catalog/quality";

/**
 * Agent 只读工具契约（v2 Phase 0 spike / §8 Tool Registry）。
 *
 * 类型级封闭：AgentToolRegistry 是恰好三个键的 Record，没有索引签名——
 * 任何"写工具 / 通用工具"想注册进来都是编译错误，不靠运行时拦截。
 * 模型永远不直接触碰 repository / SQL / 数据库连接；工具实现在 Phase 5
 * 的 tools/*.ts 中由 application service 装配（传入只读领域函数）。
 */

/** 只读：按类别 + 关键词检索质量门候选摘要 */
export type SearchCatalogTool = (input: {
  category: BuildItemCategory;
  query?: string;
  intent?: StructuredIntent;
  limit?: number;
}) => readonly CandidateSummary[];

/** 只读：读取某产品的字段证据状态与来源引用 */
export type SearchEvidenceTool = (input: { canonicalProductId: string }) => ReadonlyArray<{
  fieldPath: string;
  status: FieldQualityStatus;
  sourceIds: string[];
}>;

/** 只读：对给定组合跑确定性兼容规则，返回发现（不落库） */
export type RunCompatibilityCheckTool = (input: {
  items: ReadonlyArray<{
    category: BuildItemCategory;
    label: string;
    spec: Record<string, unknown>;
    fieldQuality?: Record<string, FieldQualityStatus>;
  }>;
}) => readonly Finding[];

/** 封闭三元组：模型可用的全部工具。新增能力必须先改这里并过评审 */
export type AgentToolRegistry = {
  searchCatalog: SearchCatalogTool;
  searchEvidence: SearchEvidenceTool;
  runCompatibilityCheck: RunCompatibilityCheckTool;
};

export const AGENT_TOOL_NAMES = ["searchCatalog", "searchEvidence", "runCompatibilityCheck"] as const satisfies readonly (keyof AgentToolRegistry)[];

export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];
