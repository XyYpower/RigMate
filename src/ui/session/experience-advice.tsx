import type { ExperienceAdviceItem } from "@/contracts/design";
import { ASSEMBLY_CATEGORY_LABELS } from "@/ui/workbench/assembly-rail";

/**
 * 模型建议分区（hybrid-llm-advice 计划 Task 4）：经验建议与待验证产品独立展示。
 * 信任边界：这是唯一渲染 proposal.experienceAdvice 的区域——正式配置、价格与兼容
 * 摘要不读取建议内容；没有建议时不渲染空区域。
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

export function ExperienceAdviceSection({ advice }: { advice: ExperienceAdviceItem[] }) {
  if (advice.length === 0) return null;
  const view = experienceAdviceViewFrom({ experienceAdvice: advice });
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
          {view.external.map((item) => (
            <li key={item.heading}>
              <span className="experience-advice-tag external">{EXPERIENCE_ADVICE_LABELS.external}</span>
              <strong>{item.heading}</strong>
              <span>{item.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
