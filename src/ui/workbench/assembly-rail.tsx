"use client";

import type { BuildItemCategory } from "@/domain/build/types";
import type { DesignProposal } from "@/contracts/design";
import type { AssemblySlot, AssemblySlotState } from "./types";

/**
 * 装配轨道（DESIGN.md §6 AssemblyRail）：八类硬件各一槽，桌面横排。
 * 只消费 AssemblySlot[]；缺失事实一律 null，空槽不填虚构硬件。
 */

export const ASSEMBLY_CATEGORIES = [
  "cpu",
  "motherboard",
  "gpu",
  "ram",
  "storage",
  "psu",
  "cooler",
  "case",
] as const satisfies readonly BuildItemCategory[];

export const ASSEMBLY_CATEGORY_LABELS: Record<BuildItemCategory, string> = {
  cpu: "处理器",
  motherboard: "主板",
  gpu: "显卡",
  ram: "内存",
  storage: "存储",
  psu: "电源",
  cooler: "散热器",
  case: "机箱",
};

/** 空槽位提示：说明该类由什么决定，不编造型号 */
const EMPTY_SLOT_HINTS: Record<BuildItemCategory, string> = {
  cpu: "用途与预算决定性能档位",
  motherboard: "跟随 CPU 平台选择",
  gpu: "用途和预算决定",
  ram: "容量与代际跟随平台",
  storage: "容量按游戏和素材库",
  psu: "功率跟随整机功耗",
  cooler: "按 CPU 功耗选择",
  case: "尺寸与外观偏好",
};

const STATE_LABEL: Record<AssemblySlotState, string> = {
  empty: "等待目标",
  retrieving: "检索中",
  ready: "已就绪",
  attention: "待确认",
  conflict: "有冲突",
  unknown: "资料不足",
};

/** 空白轨道：全部槽位处于 empty（或生成中的 retrieving） */
export function emptyAssemblySlots(state: AssemblySlotState = "empty"): AssemblySlot[] {
  return ASSEMBLY_CATEGORIES.map((category) => ({
    category,
    label: ASSEMBLY_CATEGORY_LABELS[category],
    model: null,
    state,
    detail: state === "empty" ? EMPTY_SLOT_HINTS[category] : null,
  }));
}

/** DesignProposal → 装配轨道：attention/unknown 如实保留，不升格为 ready */
export function assemblySlotsFromProposal(proposal: DesignProposal): AssemblySlot[] {
  return ASSEMBLY_CATEGORIES.map((category) => {
    const item = proposal.items.find((candidate) => candidate.category === category);
    if (!item) {
      return {
        category,
        label: ASSEMBLY_CATEGORY_LABELS[category],
        model: null,
        state: "empty" as const,
        detail: "本方案未含此件",
      };
    }
    const state: AssemblySlotState = item.confirmationRequired
      ? "attention"
      : item.sourceLevel === "unknown"
        ? "unknown"
        : "ready";
    const detail =
      item.confirmationRequired
        ? item.confirmationReason ?? "需要你确认后才能接受"
        : item.sourceLevel === "unknown"
          ? "资料不足，待补充"
          : item.sourceLevel === "user_input"
            ? "来自你的输入，未经目录核验"
            : item.sourceLevel === "model_experience"
              ? "经验推断，未经目录核验"
              : null;
    return {
      category,
      label: ASSEMBLY_CATEGORY_LABELS[category],
      model: item.label,
      state,
      detail,
    };
  });
}

function SlotBody({ slot }: { slot: AssemblySlot }) {
  return (
    <>
      <span className="assembly-slot-head">
        <span className="assembly-slot-label">{slot.label}</span>
        <span className={`assembly-slot-state state-${slot.state}`}>{STATE_LABEL[slot.state]}</span>
      </span>
      <span className="assembly-slot-model">
        {slot.model ?? <em>{slot.state === "retrieving" ? "正在检索…" : "待补充"}</em>}
      </span>
      {slot.detail && <span className="assembly-slot-detail">{slot.detail}</span>}
    </>
  );
}

export function AssemblyRail({
  slots,
  onSelect,
}: {
  slots: AssemblySlot[];
  onSelect?: (category: BuildItemCategory) => void;
}) {
  return (
    <div className="assembly-rail" role="group" aria-label="装配轨道">
      <ol className="assembly-rail-track">
        {slots.map((slot) => (
          <li className={`assembly-slot slot-${slot.state}`} key={slot.category} data-category={slot.category}>
            {onSelect ? (
              <button
                type="button"
                className="assembly-slot-body"
                aria-label={`${slot.label}：${STATE_LABEL[slot.state]}${slot.model ? `，${slot.model}` : ""}`}
                onClick={() => onSelect(slot.category)}
              >
                <SlotBody slot={slot} />
              </button>
            ) : (
              <div
                className="assembly-slot-body"
                role="group"
                aria-label={`${slot.label}：${STATE_LABEL[slot.state]}${slot.model ? `，${slot.model}` : ""}`}
              >
                <SlotBody slot={slot} />
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
