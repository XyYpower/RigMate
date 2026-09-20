import type { BuildItem, Finding } from "@/domain/build/types";
import { firstOf, makeFinding, unknownFinding } from "./helpers";

export function checkMotherboardCase(items: BuildItem[]): Finding | null {
  const motherboard = firstOf(items, "motherboard");
  const pcCase = firstOf(items, "case");
  if (!motherboard || !pcCase) return null;

  const itemIds = [motherboard.id, pcCase.id];
  const formFactor = motherboard.spec.formFactor;
  const supported = pcCase.spec.supportedFormFactors;

  if (!formFactor || !supported) {
    return unknownFinding("R-MB-CASE-001", itemIds, [
      ...(formFactor ? [] : ["主板板型"]),
      ...(supported ? [] : ["机箱支持板型列表"]),
    ]);
  }

  if (!supported.includes(formFactor)) {
    return makeFinding({
      ruleId: "R-MB-CASE-001",
      status: "block",
      itemIds,
      conclusion: `${formFactor} 主板不在机箱支持列表（${supported.join("、")}）内。`,
      evidence: [`主板记录板型为 ${formFactor}。`, `机箱记录支持 ${supported.join("、")}。`],
      suggestedAction: "更换机箱或选择与机箱匹配的主板板型。",
    });
  }

  return makeFinding({
    ruleId: "R-MB-CASE-001",
    status: "pass",
    itemIds,
    conclusion: `机箱支持 ${formFactor} 主板。`,
    evidence: [`机箱记录支持 ${supported.join("、")}。`],
    suggestedAction: "继续检查显卡长度与散热器高度。",
  });
}

export function checkGpuCaseLength(items: BuildItem[]): Finding | null {
  const gpu = firstOf(items, "gpu");
  const pcCase = firstOf(items, "case");
  if (!gpu || !pcCase) return null;

  const itemIds = [gpu.id, pcCase.id];
  const missingFields: string[] = [];
  if (gpu.spec.lengthMm === undefined) missingFields.push("显卡长度");
  if (pcCase.spec.maxGpuLengthMm === undefined) missingFields.push("机箱显卡限长");
  if (missingFields.length > 0) {
    return unknownFinding("R-GPU-CASE-001", itemIds, missingFields);
  }

  const length = gpu.spec.lengthMm ?? 0;
  const maxLength = pcCase.spec.maxGpuLengthMm ?? 0;

  if (length > maxLength) {
    return makeFinding({
      ruleId: "R-GPU-CASE-001",
      status: "block",
      itemIds,
      conclusion: `显卡长度 ${length}mm 超过机箱限长 ${maxLength}mm。`,
      evidence: [`显卡记录长度 ${length}mm。`, `机箱记录显卡限长 ${maxLength}mm。`],
      suggestedAction: "更换更短的显卡或空间更大的机箱。",
    });
  }

  return makeFinding({
    ruleId: "R-GPU-CASE-001",
    status: "pass",
    itemIds,
    conclusion: `显卡长度 ${length}mm 在机箱限长 ${maxLength}mm 内。`,
    evidence: [`显卡记录长度 ${length}mm。`, `机箱记录显卡限长 ${maxLength}mm。`],
    assumptions: length === maxLength
      ? ["长度等于限长按通过处理；实际安装可能受线缆和公差影响，建议留意。"]
      : [],
    suggestedAction: "继续检查供电接口。",
  });
}

export function checkCoolerCaseHeight(items: BuildItem[]): Finding | null {
  const cooler = firstOf(items, "cooler");
  const pcCase = firstOf(items, "case");
  if (!cooler || !pcCase) return null;

  const itemIds = [cooler.id, pcCase.id];
  const missingFields: string[] = [];
  if (cooler.spec.heightMm === undefined) missingFields.push("散热器高度");
  if (pcCase.spec.maxCoolerHeightMm === undefined) missingFields.push("机箱散热器限高");
  if (missingFields.length > 0) {
    return unknownFinding("R-COOLER-CASE-001", itemIds, missingFields);
  }

  const height = cooler.spec.heightMm ?? 0;
  const maxHeight = pcCase.spec.maxCoolerHeightMm ?? 0;

  if (height > maxHeight) {
    return makeFinding({
      ruleId: "R-COOLER-CASE-001",
      status: "block",
      itemIds,
      conclusion: `散热器高度 ${height}mm 超过机箱限高 ${maxHeight}mm。`,
      evidence: [`散热器记录高度 ${height}mm。`, `机箱记录散热器限高 ${maxHeight}mm。`],
      suggestedAction: "更换更矮的散热器或空间更大的机箱。",
    });
  }

  return makeFinding({
    ruleId: "R-COOLER-CASE-001",
    status: "pass",
    itemIds,
    conclusion: `散热器高度 ${height}mm 在机箱限高 ${maxHeight}mm 内。`,
    evidence: [`散热器记录高度 ${height}mm。`, `机箱记录散热器限高 ${maxHeight}mm。`],
    assumptions: height === maxHeight
      ? ["高度等于限高按通过处理；实际安装可能受公差影响，建议留意。"]
      : [],
    suggestedAction: "继续检查散热器与 CPU 插槽的匹配。",
  });
}
