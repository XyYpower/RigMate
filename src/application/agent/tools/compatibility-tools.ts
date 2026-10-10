import type { BuildItemCategory, Finding } from "@/domain/build/types";
import type { FieldQualityStatus } from "@/domain/catalog/quality";
import { runBuildChecks } from "@/domain/rules/engine";

/** 兼容检查工具（只读）：瞬态配件上跑确定性规则，不落任何库。
 *  条目 id 保留调用方原值（findings.itemIds 由此可回溯到调用方的类别映射）。 */
export function createRunCompatibilityCheckTool(): (query: {
  items: ReadonlyArray<{
    id?: string;
    category: BuildItemCategory;
    label: string;
    spec: Record<string, unknown>;
    fieldQuality?: Record<string, FieldQualityStatus>;
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
        id: item.id ?? `agent-check-${index}`,
        buildId: "agent-readonly",
        createdAt: new Date().toISOString(),
      })),
    );
}
