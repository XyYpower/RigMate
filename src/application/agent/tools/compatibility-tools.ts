import type { Finding } from "@/domain/build/types";
import { runBuildChecks } from "@/domain/rules/engine";

/** 兼容检查工具（只读）：瞬态配件上跑确定性规则，不落任何库 */
export function createRunCompatibilityCheckTool(): (query: {
  items: ReadonlyArray<{
    category: import("@/domain/build/types").BuildItemCategory;
    label: string;
    spec: Record<string, unknown>;
    fieldQuality?: Record<string, import("@/domain/catalog/quality").FieldQualityStatus>;
  }>;
}) => Finding[] {
  return ({ items }) =>
    runBuildChecks(
      items.map((item, index) => ({
        category: item.category,
        label: item.label,
        spec: item.spec,
        fieldQuality: item.fieldQuality,
        source: undefined,
        id: `agent-check-${index}`,
        buildId: "agent-readonly",
        createdAt: new Date().toISOString(),
      })),
    );
}
