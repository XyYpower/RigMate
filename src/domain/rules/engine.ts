import type { BuildItem, Finding, FindingStatus } from "@/domain/build/types";
import { checkCpuMotherboardSocket } from "./cpu-motherboard";
import {
  checkMotherboardGpuSlot,
  checkMotherboardRamType,
  checkRamStickCount,
  checkStorageInterface,
  checkStoragePortCount,
} from "./motherboard";
import { checkCoolerCaseHeight, checkGpuCaseLength, checkMotherboardCase } from "./case";
import { checkPsuCapacity, checkPsuConnectors } from "./power";
import { checkCoolerSocket } from "./cooler";

type Rule = {
  id: string;
  run: (items: BuildItem[]) => Finding | null;
};

const RULES: Rule[] = [
  { id: "R-CPU-MB-001", run: checkCpuMotherboardSocket },
  { id: "R-MB-GPU-001", run: checkMotherboardGpuSlot },
  { id: "R-MB-RAM-001", run: checkMotherboardRamType },
  { id: "R-RAM-001", run: checkRamStickCount },
  { id: "R-MB-CASE-001", run: checkMotherboardCase },
  { id: "R-GPU-CASE-001", run: checkGpuCaseLength },
  { id: "R-PSU-001", run: checkPsuCapacity },
  { id: "R-PSU-002", run: checkPsuConnectors },
  { id: "R-COOLER-001", run: checkCoolerSocket },
  { id: "R-COOLER-CASE-001", run: checkCoolerCaseHeight },
  { id: "R-STORAGE-001", run: checkStorageInterface },
  { id: "R-STORAGE-002", run: checkStoragePortCount },
];

const STATUS_RANK: Record<FindingStatus, number> = {
  block: 0,
  unknown: 1,
  warn: 2,
  pass: 3,
  not_applicable: 4,
};

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status]);
}

export function runBuildChecks(items: BuildItem[]): Finding[] {
  return sortFindings(
    RULES.map((rule) => rule.run(items)).filter((finding): finding is Finding => finding !== null),
  );
}

export const compatibilityRuleIds = RULES.map((rule) => rule.id);
