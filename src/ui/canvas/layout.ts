import type { BuildItemCategory } from "@/domain/build/types";

/**
 * 机器画布布局引擎（设计文档 §5.2）——纯函数，不读 DB / 网络 / 模型。
 *
 * 输入八类配件的 spec（毫米数字），输出比例正确的机箱剖视图坐标：
 * - 显卡长度 vs 机箱限长、散热器高度 vs 限高、板型 vs 机箱支持：超差即红色标注；
 * - 缺关键规格的部件渲染为虚线幽灵件（"待补充"的视觉身份，不猜默认值）；
 * - 坐标先在毫米空间计算，再按适配比例缩放到像素，组件直接渲染。
 * 这是示意图而非物理投影：散热器/限高用竖向标尺表达规则比较，便于一眼读出结论。
 */

export type CanvasItem = {
  category: BuildItemCategory;
  label: string;
  spec: Record<string, string | number | string[] | undefined>;
};

export type CanvasPart = {
  id: string;
  category: BuildItemCategory;
  label: string;
  sublabel?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  ghost: boolean;
  violated: boolean;
};

export type CanvasRuler = {
  id: string;
  kind: "gpu-length" | "cooler-height";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label: string;
  violated: boolean;
  ghost: boolean;
};

export type CaseLayout = {
  interior: { x: number; y: number; w: number; h: number };
  interiorGhost: boolean;
  parts: CanvasPart[];
  rulers: CanvasRuler[];
  notes: string[];
};

/** 常见板型的真实尺寸（高 mm × 宽 mm） */
const MOBO_SIZE: Record<string, { h: number; w: number }> = {
  "E-ATX": { h: 330, w: 305 },
  ATX: { h: 305, w: 244 },
  mATX: { h: 244, w: 244 },
  ITX: { h: 170, w: 170 },
};

const DEFAULT_MOBO = { h: 305, w: 244 };
const CANVAS_MAX_W = 680;
const CANVAS_MAX_H = 470;
const INTERIOR_X = 70;
const INTERIOR_Y = 16;
const GPU_HEIGHT_MM = 42;
const RAM_STICK_H_MM = 133;
const PSU_W_MM = 160;
const PSU_H_MM = 92;

function num(spec: CanvasItem["spec"], key: string): number | null {
  const value = spec[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(spec: CanvasItem["spec"], key: string): string | null {
  const value = spec[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function strList(spec: CanvasItem["spec"], key: string): string[] | null {
  const value = spec[key];
  return Array.isArray(value) && value.length > 0 ? value : null;
}

function firstByCategory(items: CanvasItem[], category: BuildItemCategory): CanvasItem | null {
  return items.find((item) => item.category === category) ?? null;
}

export function computeCaseLayout(items: CanvasItem[]): CaseLayout {
  const notes: string[] = [];

  const caseItem = firstByCategory(items, "case");
  const caseSpec = caseItem?.spec ?? {};
  const moboItem = firstByCategory(items, "motherboard");
  const gpuItem = firstByCategory(items, "gpu");
  const cpuItem = firstByCategory(items, "cpu");
  const ramItem = firstByCategory(items, "ram");
  const coolerItem = firstByCategory(items, "cooler");
  const psuItem = firstByCategory(items, "psu");
  const storageItems = items.filter((item) => item.category === "storage");

  const maxGpuLength = num(caseSpec, "maxGpuLengthMm");
  const maxCoolerHeight = num(caseSpec, "maxCoolerHeightMm");
  const gpuLength = gpuItem ? num(gpuItem.spec, "lengthMm") : null;
  const coolerHeight = coolerItem ? num(coolerItem.spec, "heightMm") : null;
  const moboForm = moboItem ? str(moboItem.spec, "formFactor") : null;
  const moboSize = (moboForm && MOBO_SIZE[moboForm]) || DEFAULT_MOBO;
  const moboGhost = !moboForm;

  // 内腔宽度由"机箱限长"驱动（装得下的边界）；没有就退回实际显卡长度
  const interiorW = Math.max(maxGpuLength ?? 0, gpuLength ?? 0, moboSize.w, 400) + 46;

  // 散热器从插槽线向上生长：限高/实际高度反推主板的纵向位置，保证不越出内腔
  const coolerNeed = Math.max(maxCoolerHeight ?? 0, coolerHeight ?? 0);
  const socketOffset = moboSize.h * 0.2;
  const boardTop = coolerNeed > 0 ? Math.max(16, coolerNeed - socketOffset) : 16;
  const interiorH =
    Math.max(boardTop + moboSize.h, coolerNeed + 30, moboSize.h + 30, 420) + 34;

  const interiorGhost = !caseItem || (maxGpuLength === null && maxCoolerHeight === null);

  const k = Math.min(
    (CANVAS_MAX_W - INTERIOR_X - 10) / interiorW,
    (CANVAS_MAX_H - INTERIOR_Y - 20) / interiorH,
  );
  const s = (v: number) => Math.round(v * k * 100) / 100;

  const interior = { x: INTERIOR_X, y: INTERIOR_Y, w: s(interiorW), h: s(interiorH) };
  const parts: CanvasPart[] = [];
  const rulers: CanvasRuler[] = [];

  // ---- 主板（右贴边，有配件才物化）----
  const boardX = interior.x + interior.w - s(moboSize.w) - 8;
  const boardY = interior.y + s(boardTop);
  const boardW = s(moboSize.w);
  const boardH = s(moboSize.h);

  let boardViolated = false;
  const supportedFormFactors = strList(caseSpec, "supportedFormFactors");
  if (moboForm && supportedFormFactors && !supportedFormFactors.includes(moboForm)) {
    boardViolated = true;
    notes.push(`主板板型 ${moboForm} 不在机箱支持列表（${supportedFormFactors.join(" / ")}）内`);
  }
  if (moboItem) {
    parts.push({
      id: "motherboard",
      category: "motherboard",
      label: moboForm ?? "主板",
      sublabel: moboItem.label,
      x: boardX,
      y: boardY,
      w: boardW,
      h: boardH,
      ghost: moboGhost,
      violated: boardViolated,
    });
  }

  // ---- CPU + 散热器 ----
  const cpuW = s(42);
  const cpuX = boardX + boardW * 0.38 - cpuW / 2;
  const cpuY = boardY + boardH * 0.2 - cpuW / 2;
  if (cpuItem) {
    parts.push({
      id: "cpu",
      category: "cpu",
      label: str(cpuItem.spec, "socket") ?? "CPU",
      sublabel: cpuItem.label,
      x: cpuX,
      y: cpuY,
      w: cpuW,
      h: cpuW,
      ghost: !str(cpuItem.spec, "socket"),
      violated: false,
    });
  }

  if (coolerItem) {
    const coolerH = coolerHeight ?? 158;
    const coolerW = s(118);
    const coolerX = cpuX + cpuW / 2 - coolerW / 2;
    const coolerBase = cpuY + cpuW / 2;
    const coolerY = coolerBase - s(coolerH);
    const coolerViolated =
      maxCoolerHeight !== null && coolerHeight !== null && coolerHeight > maxCoolerHeight;
    if (coolerViolated && coolerHeight !== null && maxCoolerHeight !== null) {
      notes.push(`散热器高度 ${coolerHeight}mm 超出机箱限高 ${maxCoolerHeight}mm`);
    }
    parts.push({
      id: "cooler",
      category: "cooler",
      label: coolerHeight !== null ? `${coolerHeight}mm` : "散热器",
      sublabel: coolerItem.label,
      x: coolerX,
      y: coolerY,
      w: coolerW,
      h: s(coolerH),
      ghost: coolerHeight === null,
      violated: coolerViolated,
    });
    rulers.push({
      id: "cooler-height",
      kind: "cooler-height",
      x1: coolerX + coolerW + 6,
      y1: coolerBase,
      x2: coolerX + coolerW + 6,
      y2: coolerY,
      label: coolerHeight !== null ? `${coolerHeight}mm` : "高度待补充",
      violated: coolerViolated,
      ghost: coolerHeight === null,
    });
    if (maxCoolerHeight !== null) {
      rulers.push({
        id: "cooler-limit",
        kind: "cooler-height",
        x1: coolerX - 6,
        y1: coolerBase - s(maxCoolerHeight),
        x2: coolerX + coolerW + 12,
        y2: coolerBase - s(maxCoolerHeight),
        label: `限高 ${maxCoolerHeight}`,
        violated: false,
        ghost: false,
      });
    }
  }

  // ---- 内存（贴主板右缘的竖条）----
  if (ramItem) {
    const sticks = num(ramItem.spec, "sticks");
    const stickCount = Math.min(sticks ?? 2, 4);
    const stickW = s(9);
    const stickH = s(RAM_STICK_H_MM);
    const baseX = boardX + boardW - s(30) - stickCount * (stickW + s(7));
    const stickY = boardY + s(14);
    for (let i = 0; i < stickCount; i += 1) {
      parts.push({
        id: `ram-${i}`,
        category: "ram",
        label: i === 0 ? (str(ramItem.spec, "ddrType") ?? "内存") : "",
        sublabel: i === 0 ? ramItem.label : undefined,
        x: baseX + i * (stickW + s(7)),
        y: stickY,
        w: stickW,
        h: stickH,
        ghost: sticks === null,
        violated: false,
      });
    }
  }

  // ---- 显卡（插入点在主板 PCIe 区，向左伸出真实长度；超差段由标尺标注）----
  if (gpuItem) {
    const gpuLen = gpuLength ?? 280;
    const gpuRight = boardX + boardW - s(18);
    const gpuX = gpuRight - s(gpuLen);
    const gpuY = boardY + boardH * 0.46;
    const gpuViolated = maxGpuLength !== null && gpuLength !== null && gpuLength > maxGpuLength;
    if (gpuViolated && gpuLength !== null && maxGpuLength !== null) {
      notes.push(`显卡长度 ${gpuLength}mm 超出机箱限长 ${maxGpuLength}mm`);
    }
    parts.push({
      id: "gpu",
      category: "gpu",
      label: gpuLength !== null ? `${gpuLength}mm` : "显卡",
      sublabel: gpuItem.label,
      x: gpuX,
      y: gpuY,
      w: s(gpuLen),
      h: s(GPU_HEIGHT_MM),
      ghost: gpuLength === null,
      violated: gpuViolated,
    });
    rulers.push({
      id: "gpu-length",
      kind: "gpu-length",
      x1: gpuX,
      y1: gpuY - s(14),
      x2: gpuX + s(gpuLen),
      y2: gpuY - s(14),
      label: gpuLength !== null ? `${gpuLength}mm` : "长度待补充",
      violated: gpuViolated,
      ghost: gpuLength === null,
    });
    if (maxGpuLength !== null) {
      const limitRight = gpuRight;
      rulers.push({
        id: "gpu-limit",
        kind: "gpu-length",
        x1: limitRight - s(maxGpuLength),
        y1: gpuY + s(GPU_HEIGHT_MM) + s(12),
        x2: limitRight,
        y2: gpuY + s(GPU_HEIGHT_MM) + s(12),
        label: `限长 ${maxGpuLength}`,
        violated: false,
        ghost: false,
      });
    }
  }

  // ---- 存储（主板下缘的小块）----
  storageItems.forEach((item, index) => {
    parts.push({
      id: `storage-${index}`,
      category: "storage",
      label: str(item.spec, "interface") === "sata" ? "SATA" : "M.2",
      sublabel: item.label,
      x: boardX + s(14),
      y: boardY + boardH - s(34) - index * s(26),
      w: s(64),
      h: s(18),
      ghost: !str(item.spec, "interface"),
      violated: false,
    });
  });

  // ---- 电源（左下角）----
  if (psuItem) {
    const ratedWatts = num(psuItem.spec, "ratedWatts");
    parts.push({
      id: "psu",
      category: "psu",
      label: ratedWatts !== null ? `${ratedWatts}W` : "电源",
      sublabel: psuItem.label,
      x: interior.x + s(10),
      y: interior.y + interior.h - s(PSU_H_MM) - s(12),
      w: s(PSU_W_MM),
      h: s(PSU_H_MM),
      ghost: ratedWatts === null,
      violated: false,
    });
  }

  return { interior, interiorGhost, parts, rulers, notes };
}
