"use client";

import { useState } from "react";
import type { ExperienceAdviceItem } from "@/contracts/design";
import { ASSEMBLY_CATEGORY_LABELS } from "@/ui/workbench/assembly-rail";
import { externalHintQueuePayload } from "@/ui/session/advice-queue";

/**
 * 模型建议分区（hybrid-llm-advice Task 4 + M4 队列入口）：经验建议与待验证产品独立展示。
 * 信任边界：这是唯一渲染 proposal.experienceAdvice 的区域——正式配置、价格与兼容
 * 摘要不读取建议内容；没有建议时不渲染空区域。
 * 库外产品提示带「加入待审核队列」动作（蓝图 §7.3）：只写 pending_catalog_queue，
 * 不自动建产品、不影响正式方案与接受路径。
 */

export const EXPERIENCE_ADVICE_LABELS = {
  experience: "经验建议",
  external: "待验证产品",
} as const;

export type ExperienceAdviceView = {
  experience: Array<{ heading: string; detail: string }>;
  external: Array<{ heading: string; detail: string }>;
};

export function experienceAdviceViewFrom(
  proposal: Pick<{ experienceAdvice: ExperienceAdviceItem[] }, "experienceAdvice">,
): ExperienceAdviceView {
  const experience: ExperienceAdviceView["experience"] = [];
  const external: ExperienceAdviceView["external"] = [];
  for (const item of proposal.experienceAdvice) {
    const categoryLabel = ASSEMBLY_CATEGORY_LABELS[item.category];
    // 经验建议组绝不携带产品名（schema 已拒；这里再保证展示层不串组）
    if (item.kind === "experience_advice") {
      experience.push({ heading: `${categoryLabel} · ${item.title}`, detail: item.detail });
    } else {
      external.push({
        heading: `${categoryLabel} · ${item.productName ?? item.title}`,
        detail: item.detail,
      });
    }
  }
  return { experience, external };
}

function ExternalHintActions({ advice, sourceNote }: { advice: ExperienceAdviceItem; sourceNote: string }) {
  const [state, setState] = useState<"idle" | "submitting" | "done">("idle");
  const [error, setError] = useState("");
  const payload = externalHintQueuePayload(advice, sourceNote);
  if (!payload) return null;
  async function queueHint() {
    if (state !== "idle") return;
    setState("submitting");
    setError("");
    try {
      const response = await fetch("/api/catalog/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? "进队失败，请重试。");
      }
      setState("done");
    } catch (cause) {
      setState("idle");
      setError(cause instanceof Error ? cause.message : "进队失败，请重试。");
    }
  }
  if (state === "done") {
    return <span className="experience-advice-queued">已进审核队列</span>;
  }
  return (
    <span className="experience-advice-queue">
      <button
        type="button"
        className="experience-advice-queue-button"
        onClick={() => void queueHint()}
        disabled={state === "submitting"}
      >
        {state === "submitting" ? "提交中…" : "加入待审核队列"}
      </button>
      {error && <span className="experience-advice-queue-error">{error}</span>}
    </span>
  );
}

export function ExperienceAdviceSection({
  advice,
  sourceNote = "",
}: {
  advice: ExperienceAdviceItem[];
  sourceNote?: string;
}) {
  if (advice.length === 0) return null;
  const view = experienceAdviceViewFrom({ experienceAdvice: advice });
  const externalItems = advice.filter((item) => item.kind === "external_product_hint");
  return (
    <section className="experience-advice" aria-label="模型建议">
      <h2>模型建议</h2>
      <p className="experience-advice-note">
        以下内容由大模型按经验给出，仅供参考：不会参与当前兼容检查，也不计入价格合计。
      </p>
      {view.experience.length > 0 && (
        <ul className="experience-advice-list" aria-label={EXPERIENCE_ADVICE_LABELS.experience}>
          {view.experience.map((item) => (
            <li key={item.heading}>
              <span className="experience-advice-tag">{EXPERIENCE_ADVICE_LABELS.experience}</span>
              <strong>{item.heading}</strong>
              <span>{item.detail}</span>
            </li>
          ))}
        </ul>
      )}
      {view.external.length > 0 && (
        <ul className="experience-advice-list" aria-label={EXPERIENCE_ADVICE_LABELS.external}>
          {view.external.map((item, index) => (
            <li key={item.heading}>
              <span className="experience-advice-tag external">{EXPERIENCE_ADVICE_LABELS.external}</span>
              <strong>{item.heading}</strong>
              <span>{item.detail}</span>
              <ExternalHintActions advice={externalItems[index]!} sourceNote={sourceNote} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
