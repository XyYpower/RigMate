import type { BuildItem, Finding } from "@/domain/build/types";
import { firstOf, itemsOf, makeFinding, unknownFinding } from "./helpers";

const STORAGE_INTERFACE_LABELS = {
  m2_nvme: "M.2 NVMe",
  sata: "SATA",
} as const;

export function checkMotherboardGpuSlot(items: BuildItem[]): Finding | null {
  const motherboard = firstOf(items, "motherboard");
  const gpus = itemsOf(items, "gpu");
  if (!motherboard || gpus.length === 0) return null;

  const slots = motherboard.spec.pcieX16Slots;
  if (slots === undefined) {
    return unknownFinding("R-MB-GPU-001", [motherboard.id, ...gpus.map((g) => g.id)], [
      "主板 PCIe x16 插槽数量",
    ]);
  }

  if (slots < 1) {
    return makeFinding({
      ruleId: "R-MB-GPU-001",
      status: "block",
      itemIds: [motherboard.id, ...gpus.map((g) => g.id)],
      conclusion: "主板没有可用的 PCIe x16 插槽，无法安装独立显卡。",
      evidence: [`主板记录 PCIe x16 插槽数量为 ${slots}。`],
      suggestedAction: "更换为带 PCIe x16 插槽的主板，或改用核显方案。",
    });
  }

  return makeFinding({
    ruleId: "R-MB-GPU-001",
    status: "pass",
    itemIds: [motherboard.id, ...gpus.map((g) => g.id)],
    conclusion: `主板提供 ${slots} 条 PCIe x16 插槽，可安装独立显卡。`,
    evidence: [`主板记录 PCIe x16 插槽数量为 ${slots}。`],
    suggestedAction: "继续检查显卡尺寸与供电。",
  });
}

export function checkMotherboardRamType(items: BuildItem[]): Finding | null {
  const motherboard = firstOf(items, "motherboard");
  const rams = itemsOf(items, "ram");
  if (!motherboard || rams.length === 0) return null;

  const motherboardType = motherboard.spec.ramType;
  const itemIds = [motherboard.id, ...rams.map((r) => r.id)];

  const missingFields: string[] = [];
  if (!motherboardType) missingFields.push("主板内存代际");
  for (const ram of rams) {
    if (!ram.spec.ddrType) missingFields.push(`内存（${ram.label}）代际`);
  }
  if (missingFields.length > 0) {
    return unknownFinding("R-MB-RAM-001", itemIds, missingFields);
  }

  const mismatched = rams.filter((ram) => ram.spec.ddrType !== motherboardType);
  if (mismatched.length > 0) {
    return makeFinding({
      ruleId: "R-MB-RAM-001",
      status: "block",
      itemIds,
      conclusion: `内存代际 ${mismatched[0]?.spec.ddrType} 与主板支持的 ${motherboardType} 不匹配。`,
      evidence: [
        `主板内存代际记录为 ${motherboardType}。`,
        ...mismatched.map((ram) => `${ram.label} 记录为 ${ram.spec.ddrType}。`),
      ],
      suggestedAction: "更换为与主板代际一致的内存，或更换支持该内存的主板。",
    });
  }

  return makeFinding({
    ruleId: "R-MB-RAM-001",
    status: "pass",
    itemIds,
    conclusion: `内存代际与主板支持的 ${motherboardType} 一致。`,
    evidence: rams.map((ram) => `${ram.label} 记录为 ${ram.spec.ddrType}。`),
    suggestedAction: "继续检查内存条数与主板插槽的数量关系。",
  });
}

export function checkRamStickCount(items: BuildItem[]): Finding | null {
  const motherboard = firstOf(items, "motherboard");
  const rams = itemsOf(items, "ram");
  if (!motherboard || rams.length === 0) return null;

  const itemIds = [motherboard.id, ...rams.map((r) => r.id)];
  const slots = motherboard.spec.ramSlots;
  const kitsWithoutSticks = rams.filter((ram) => ram.spec.sticks === undefined);

  if (slots === undefined || kitsWithoutSticks.length > 0) {
    return unknownFinding("R-RAM-001", itemIds, [
      ...(slots === undefined ? ["主板内存插槽数量"] : []),
      ...kitsWithoutSticks.map((ram) => `内存（${ram.label}）条数`),
    ]);
  }

  const totalSticks = rams.reduce((sum, ram) => sum + (ram.spec.sticks ?? 0), 0);
  if (totalSticks > slots) {
    return makeFinding({
      ruleId: "R-RAM-001",
      status: "block",
      itemIds,
      conclusion: `内存总条数 ${totalSticks} 超过主板插槽数量 ${slots}。`,
      evidence: [`主板记录内存插槽数量为 ${slots}。`],
      suggestedAction: "减少内存条数，或更换插槽更多的主板。",
    });
  }

  return makeFinding({
    ruleId: "R-RAM-001",
    status: "pass",
    itemIds,
    conclusion: `内存总条数 ${totalSticks} 在主板 ${slots} 条插槽范围内。`,
    evidence: [`主板记录内存插槽数量为 ${slots}。`],
    assumptions: ["单条内存不算兼容性问题；是否组双通道属于性能取舍，不在本规则内判断。"],
    suggestedAction: "继续检查其他兼容性条件。",
  });
}

export function checkStorageInterface(items: BuildItem[]): Finding | null {
  const motherboard = firstOf(items, "motherboard");
  const storages = itemsOf(items, "storage");
  if (!motherboard || storages.length === 0) return null;

  const itemIds = [motherboard.id, ...storages.map((s) => s.id)];
  const missingFields: string[] = [];
  const unsupported: string[] = [];

  for (const storage of storages) {
    const iface = storage.spec.interface;
    if (!iface) {
      missingFields.push(`存储（${storage.label}）接口`);
      continue;
    }
    if (iface === "m2_nvme") {
      if (motherboard.spec.m2Slots === undefined) {
        missingFields.push("主板 M.2 插槽数量");
      } else if (motherboard.spec.m2Slots < 1) {
        unsupported.push(`${storage.label} 需要 M.2 插槽，主板记录的 M.2 插槽数量为 0。`);
      }
    } else {
      if (motherboard.spec.sataPorts === undefined) {
        missingFields.push("主板 SATA 接口数量");
      } else if (motherboard.spec.sataPorts < 1) {
        unsupported.push(`${storage.label} 需要 SATA 接口，主板记录的 SATA 接口数量为 0。`);
      }
    }
  }

  if (unsupported.length > 0) {
    return makeFinding({
      ruleId: "R-STORAGE-001",
      status: "block",
      itemIds,
      conclusion: "存在主板不支持的存储接口。",
      evidence: unsupported,
      suggestedAction: "更换存储接口类型，或更换带对应接口的主板。",
    });
  }

  if (missingFields.length > 0) {
    return unknownFinding("R-STORAGE-001", itemIds, missingFields);
  }

  return makeFinding({
    ruleId: "R-STORAGE-001",
    status: "pass",
    itemIds,
    conclusion: `存储接口（${storages
      .map((s) => STORAGE_INTERFACE_LABELS[s.spec.interface ?? "sata"])
      .join("、")}）与主板支持一致。`,
    evidence: storages.map((s) => `${s.label} 记录接口为 ${STORAGE_INTERFACE_LABELS[s.spec.interface ?? "sata"]}。`),
    suggestedAction: "继续检查存储数量与接口总数的关系。",
  });
}

export function checkStoragePortCount(items: BuildItem[]): Finding | null {
  const motherboard = firstOf(items, "motherboard");
  const storages = itemsOf(items, "storage");
  if (!motherboard || storages.length === 0) return null;

  const itemIds = [motherboard.id, ...storages.map((s) => s.id)];
  const m2Drives = storages.filter((s) => s.spec.interface === "m2_nvme");
  const sataDrives = storages.filter((s) => s.spec.interface === "sata");

  const missingFields: string[] = [];
  for (const storage of storages) {
    if (!storage.spec.interface) missingFields.push(`存储（${storage.label}）接口`);
  }
  if (m2Drives.length > 0 && motherboard.spec.m2Slots === undefined) {
    missingFields.push("主板 M.2 插槽数量");
  }
  if (sataDrives.length > 0 && motherboard.spec.sataPorts === undefined) {
    missingFields.push("主板 SATA 接口数量");
  }
  if (missingFields.length > 0) {
    return unknownFinding("R-STORAGE-002", itemIds, missingFields);
  }

  const m2Over = m2Drives.length > (motherboard.spec.m2Slots ?? 0);
  const sataOver = sataDrives.length > (motherboard.spec.sataPorts ?? 0);
  if (m2Over || sataOver) {
    return makeFinding({
      ruleId: "R-STORAGE-002",
      status: "block",
      itemIds,
      conclusion: "存储设备数量超过主板可用接口数量。",
      evidence: [
        `M.2 设备 ${m2Drives.length} 个 / 主板 M.2 插槽 ${motherboard.spec.m2Slots ?? 0} 个。`,
        `SATA 设备 ${sataDrives.length} 个 / 主板 SATA 接口 ${motherboard.spec.sataPorts ?? 0} 个。`,
      ],
      suggestedAction: "减少存储设备数量，或更换接口更多的主板。",
    });
  }

  return makeFinding({
    ruleId: "R-STORAGE-002",
    status: "pass",
    itemIds,
    conclusion: "存储设备数量在主板可用接口范围内。",
    evidence: [
      `M.2 设备 ${m2Drives.length} 个 / 主板 M.2 插槽 ${motherboard.spec.m2Slots ?? 0} 个。`,
      `SATA 设备 ${sataDrives.length} 个 / 主板 SATA 接口 ${motherboard.spec.sataPorts ?? 0} 个。`,
    ],
    suggestedAction: "继续检查其他兼容性条件。",
  });
}
