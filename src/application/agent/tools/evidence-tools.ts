import { computeEvidenceBackedFieldStatuses } from "@/application/catalog-review/service";
import type { FieldQualityStatus } from "@/domain/catalog/quality";

/** 证据检索工具（只读）：字段证据状态 + 来源引用；无证据链返回空数组 */
export function createSearchEvidenceTool(): (query: { canonicalProductId: string }) => Array<{
  fieldPath: string;
  status: FieldQualityStatus;
  sourceIds: string[];
}> {
  return ({ canonicalProductId }) => {
    try {
      const statuses = computeEvidenceBackedFieldStatuses(canonicalProductId);
      return Object.entries(statuses.fieldQuality).map(([field, status]) => ({
        fieldPath: `spec.${field}`,
        status,
        sourceIds: statuses.evidenceSourceIds,
      }));
    } catch {
      // 产品不存在等：只读工具不抛给模型路径，按无证据处理
      return [];
    }
  };
}
