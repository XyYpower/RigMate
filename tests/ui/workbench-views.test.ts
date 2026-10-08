import { describe, expect, it } from "vitest";
import {
  ASSEMBLY_CATEGORIES,
  assemblySlotsFromProposal,
  emptyAssemblySlots,
} from "@/ui/workbench/assembly-rail";
import { budgetRulerFrom, emptyBudgetRulerView } from "@/ui/workbench/budget-ruler";
import {
  stageTrackFromEvents,
  verificationItemsFrom,
} from "@/ui/workbench/verification-desk";
import type { AgentEvent, DesignProposal, ProposalItem } from "@/contracts/design";

function makeItem(overrides: Partial<ProposalItem> = {}): ProposalItem {
  return {
    category: "gpu",
    label: "RTX 4070 SUPER",
    spec: {},
    sourceLevel: "verified_catalog",
    priceEstimateLowCents: 4_500_00,
    priceEstimateHighCents: 5_200_00,
    priceBasis: "experience_estimate",
    rationale: "2K 游戏主流选择",
    confirmationRequired: false,
    ...overrides,
  };
}

function makeProposal(overrides: Partial<DesignProposal> = {}): DesignProposal {
  return {
    id: "p-1",
    requestId: "r-1",
    version: 1,
    status: "ready",
    title: "2 万白色海景房",
    summary: "按预算与用途搭配",
    budgetCents: 2_000_000,
    estimatedLowCents: 1_800_000,
    estimatedHighCents: 1_950_000,
    items: [makeItem()],
    fitNotes: [],
    tradeoffs: [],
    unknowns: [],
    compatibility: {
      status: "ok",
      message: "兼容性检查全部通过",
      blockCount: 0,
      warnCount: 0,
      unknownCount: 0,
      passCount: 6,
    },
    createdAt: "2026-10-08T00:00:00.000Z",
    updatedAt: "2026-10-08T00:00:00.000Z",
    ...overrides,
  };
}

function makeEvent(overrides: Partial<AgentEvent> = {}): AgentEvent {
  return {
    id: "e-1",
    runId: "run-1",
    type: "understanding",
    status: "completed",
    message: "已理解目标",
    createdAt: "2026-10-08T00:00:00.000Z",
    ...overrides,
  };
}

describe("装配轨道视图映射", () => {
  it("空目标生成 8 个 empty 槽位，按八类固定顺序", () => {
    const slots = emptyAssemblySlots();
    expect(slots).toHaveLength(8);
    expect(slots.map((slot) => slot.category)).toEqual(ASSEMBLY_CATEGORIES);
    for (const slot of slots) {
      expect(slot.state).toBe("empty");
      expect(slot.model).toBeNull();
    }
  });

  it("方案项映射为对应类别和型号", () => {
    const proposal = makeProposal({
      items: [
        makeItem({ category: "cpu", label: "AMD 锐龙7 9800X3D" }),
        makeItem({ category: "gpu", label: "RTX 4070 SUPER" }),
      ],
    });
    const slots = assemblySlotsFromProposal(proposal);
    const cpu = slots.find((slot) => slot.category === "cpu")!;
    const gpu = slots.find((slot) => slot.category === "gpu")!;
    expect(cpu.model).toBe("AMD 锐龙7 9800X3D");
    expect(cpu.state).toBe("ready");
    expect(gpu.model).toBe("RTX 4070 SUPER");
    expect(slots.filter((slot) => slot.state === "empty")).toHaveLength(6);
  });

  it("attention（待确认）不被映射成 ready", () => {
    const proposal = makeProposal({
      items: [makeItem({ confirmationRequired: true, confirmationReason: "货源波动，请确认型号" })],
    });
    const slots = assemblySlotsFromProposal(proposal);
    expect(slots.find((slot) => slot.category === "gpu")!.state).toBe("attention");
  });

  it("unknown（资料不足）不被映射成 ready", () => {
    const proposal = makeProposal({
      items: [makeItem({ sourceLevel: "unknown", priceEstimateLowCents: null, priceEstimateHighCents: null })],
    });
    const slots = assemblySlotsFromProposal(proposal);
    expect(slots.find((slot) => slot.category === "gpu")!.state).toBe("unknown");
  });

  it("检索中状态生成 8 个 retrieving 槽位", () => {
    const slots = emptyAssemblySlots("retrieving");
    for (const slot of slots) {
      expect(slot.state).toBe("retrieving");
    }
  });
});

describe("预算标尺视图映射", () => {
  it("预算无值显示 unknown", () => {
    const view = budgetRulerFrom(makeProposal({ budgetCents: null }));
    expect(view.state).toBe("unknown");
    expect(view.budgetCents).toBeNull();
  });

  it("估算区间跨预算线显示 crossing", () => {
    const view = budgetRulerFrom(makeProposal({
      budgetCents: 1_900_000,
      estimatedLowCents: 1_800_000,
      estimatedHighCents: 1_950_000,
    }));
    expect(view.state).toBe("crossing");
  });

  it("估算下限高于预算显示 over", () => {
    const view = budgetRulerFrom(makeProposal({
      budgetCents: 1_500_000,
      estimatedLowCents: 1_800_000,
      estimatedHighCents: 1_950_000,
    }));
    expect(view.state).toBe("over");
  });

  it("估算上限不超预算显示 within，中值为区间中点", () => {
    const view = budgetRulerFrom(makeProposal({
      budgetCents: 2_000_000,
      estimatedLowCents: 1_800_000,
      estimatedHighCents: 1_950_000,
    }));
    expect(view.state).toBe("within");
    expect(view.midpointCents).toBe(1_875_000);
  });

  it("有预算但估算缺失时为 unknown；空视图全部为 null", () => {
    const view = budgetRulerFrom(makeProposal({ estimatedLowCents: null, estimatedHighCents: null }));
    expect(view.state).toBe("unknown");
    const empty = emptyBudgetRulerView();
    expect(empty.budgetCents).toBeNull();
    expect(empty.lowCents).toBeNull();
    expect(empty.state).toBe("unknown");
  });
});

describe("核验台视图映射", () => {
  it("conflict 状态生成 conflict 条目且排在最前，不映射为 pass", () => {
    const items = verificationItemsFrom(makeProposal({
      compatibility: {
        status: "conflict",
        message: "CPU 与主板插槽不匹配",
        blockCount: 1,
        warnCount: 0,
        unknownCount: 0,
        passCount: 5,
      },
    }));
    expect(items[0]!.state).toBe("conflict");
    expect(items.some((item) => item.state === "pass")).toBe(false);
  });

  it("待确认项与 unknowns 映射为 attention / unknown 条目", () => {
    const items = verificationItemsFrom(makeProposal({
      items: [makeItem({ confirmationRequired: true, confirmationReason: "电源货源波动" })],
      unknowns: ["机箱显卡限长未核实"],
      compatibility: {
        status: "attention",
        message: "有配置项需要确认",
        blockCount: 0,
        warnCount: 1,
        unknownCount: 1,
        passCount: 5,
      },
    }));
    expect(items.filter((item) => item.state === "attention").length).toBeGreaterThanOrEqual(1);
    expect(items.some((item) => item.title === "机箱显卡限长未核实")).toBe(true);
    const ranks = { conflict: 0, attention: 1, unknown: 2, pass: 3 } as const;
    const ranksInOrder = items.map((item) => ranks[item.state]);
    expect([...ranksInOrder].sort((a, b) => a - b)).toEqual(ranksInOrder);
  });

  it("全通过时生成 pass 条目", () => {
    const items = verificationItemsFrom(makeProposal());
    expect(items).toHaveLength(1);
    expect(items[0]!.state).toBe("pass");
  });
});

describe("四阶段轨道映射", () => {
  it("无事件时全部 waiting，有完成事件时对应阶段 done", () => {
    expect(stageTrackFromEvents([]).every((step) => step.state === "waiting")).toBe(true);

    const steps = stageTrackFromEvents([
      makeEvent({ type: "understanding", status: "completed" }),
      makeEvent({ type: "retrieving", status: "completed", id: "e-2" }),
      makeEvent({ type: "composing", status: "started", id: "e-3" }),
    ]);
    expect(steps.find((step) => step.id === "understanding")!.state).toBe("done");
    expect(steps.find((step) => step.id === "retrieving")!.state).toBe("done");
    expect(steps.find((step) => step.id === "composing")!.state).toBe("active");
    expect(steps.find((step) => step.id === "validating")!.state).toBe("waiting");
  });
});
