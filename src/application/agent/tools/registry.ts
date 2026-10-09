import type { AgentToolRegistry } from "@/application/agent/tool-contracts";
import { createSearchCatalogTool } from "./catalog-tools";
import { createSearchEvidenceTool } from "./evidence-tools";
import { createRunCompatibilityCheckTool } from "./compatibility-tools";
import type { RankedCandidate, VerifiedPriceFact } from "@/domain/catalog/ranking";

/**
 * 只读工具注册表装配（v2 Phase 5 §8 Tool Registry）。
 *
 * 返回类型就是封闭三元组 AgentToolRegistry——没有索引签名，
 * 任何写/通用工具想加入都是编译错误；模型没有写权限由类型保证。
 */
export function createAgentTools(input: {
  entries: readonly RankedCandidate[];
  priceByCanonicalId: Map<string, VerifiedPriceFact>;
}): AgentToolRegistry {
  return {
    searchCatalog: createSearchCatalogTool({ entries: input.entries, priceByCanonicalId: input.priceByCanonicalId }),
    searchEvidence: createSearchEvidenceTool(),
    runCompatibilityCheck: createRunCompatibilityCheckTool(),
  };
}
