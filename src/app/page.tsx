"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { AssemblyRail, emptyAssemblySlots } from "@/ui/workbench/assembly-rail";
import { BudgetRuler, emptyBudgetRulerView } from "@/ui/workbench/budget-ruler";

type BuildSummary = {
  id: string;
  name: string;
  updatedAt: string;
  items: unknown[];
  budgetCents: number | null;
};

function formatTime(value: string): string {
  return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** 示例：展示短标签，点击填入完整目标——展示与数据分离，消除重复长句 */
const GOAL_SUGGESTIONS = [
  { tag: "白色海景房 · 2 万", full: "2 万预算，白色海景房，主要做视频剪辑和玩 3A 游戏" },
  { tag: "2K 游戏 · 安静 · 8 千", full: "8 千预算，主要玩 2K 游戏，想要安静一点" },
  { tag: "代码虚拟机 · 1.5 万", full: "1 万 5 预算，写代码加虚拟机多开，不要灯效" },
];

const BUDGET_PRESETS = [8000, 12000, 16000, 20000];

/** 三项真实能力：不承诺做不到的事 */
const HOME_CAPABILITIES = [
  { title: "资料核验", detail: "型号规格来自已核目录，来源可查" },
  { title: "兼容检查", detail: "插槽、功耗、尺寸逐项规则检查" },
  { title: "可编辑方案", detail: "改一句重新校验，或进 DIY 换件" },
];

export default function Home() {
  const router = useRouter();
  const [goal, setGoal] = useState("");
  const [budget, setBudget] = useState("");
  const [builds, setBuilds] = useState<BuildSummary[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/builds").then(async (response) => {
      if (!response.ok) return;
      const data = await response.json();
      if (!cancelled) setBuilds((data.builds ?? []).slice(0, 4));
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  async function startDesign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const goalValue = String(formData.get("goal") ?? "").trim();
    const budgetValue = String(formData.get("budget") ?? "").trim();
    if (!goalValue) return;
    const amount = budgetValue ? Number(budgetValue.replace(/[¥,]/g, "")) : undefined;
    if (amount !== undefined && (!Number.isFinite(amount) || amount <= 0)) {
      setMessage("预算请输入大于 0 的金额，或留空让助手从描述中识别。");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/design", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawInput: goalValue, budgetCents: amount ? Math.round(amount * 100) : undefined }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "暂时无法生成方案。");
      router.push(`/design/${data.result.request.id}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "暂时无法生成方案，请重试。");
      setBusy(false);
    }
  }

  return (
    <main className="home-page">
      <div className="page-grid">
        <div className="page-main">
          <section className="home-intro">
            <h1>
              你想配一台
              <br />
              什么样的电脑？
              <span className="home-dot" aria-hidden />
            </h1>
          </section>

          <section className="home-rail" aria-label="整机装配轨道">
            <AssemblyRail slots={emptyAssemblySlots(busy ? "retrieving" : "empty")} />
          </section>

          <form className="goal-composer wb-panel" onSubmit={(event) => void startDesign(event)}>
            <label className="sr-only" htmlFor="design-goal">描述你的装机目标</label>
            <textarea
              id="design-goal"
              name="goal"
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              onInput={(event) => setGoal(event.currentTarget.value)}
              rows={3}
              maxLength={4000}
              placeholder="说说预算、用途、外观偏好，一句话就够……"
              disabled={busy}
            />
            <div className="goal-toolbar">
              <div className="goal-budget-group">
                <input
                  name="budget"
                  className="goal-budget-input"
                  aria-label="预算（元，可选）"
                  inputMode="numeric"
                  value={budget}
                  onChange={(event) => setBudget(event.target.value)}
                  onInput={(event) => setBudget(event.currentTarget.value)}
                  placeholder="预算"
                  disabled={busy}
                />
                <div className="goal-budget-seg" role="group" aria-label="预算快捷档">
                  {BUDGET_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      className={`goal-budget-seg-btn${budget === String(preset) ? " active" : ""}`}
                      onClick={() => setBudget(String(preset))}
                      disabled={busy}
                    >
                      {preset >= 10000 && preset % 10000 === 0 ? `${preset / 10000} 万` : `${preset}`}
                    </button>
                  ))}
                </div>
              </div>
              <button className="button primary goal-submit" type="submit" disabled={busy}>
                {busy ? "正在搭配…" : "开始搭配"}<span aria-hidden>→</span>
              </button>
            </div>
            {busy ? (
              <p className="agent-progress" role="status" aria-label="方案生成中">
                正在按你的目标检索目录并搭配方案，通常几秒内完成。
              </p>
            ) : (
              <div className="goal-suggestions" aria-label="示例目标">
                {GOAL_SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion.tag}
                    type="button"
                    className="goal-suggestion"
                    onClick={() => setGoal(suggestion.full)}
                    disabled={busy}
                  >
                    <span aria-hidden>›</span>
                    {suggestion.tag}
                  </button>
                ))}
              </div>
            )}
            {message && <p className="form-feedback" role="status">{message}</p>}
          </form>

          <section className="home-ruler-row" aria-label="预算与能力">
            <BudgetRuler view={emptyBudgetRulerView()} />
            <ul className="home-caps wb-panel">
              {HOME_CAPABILITIES.map((capability) => (
                <li key={capability.title}>
                  <strong>{capability.title}</strong>
                  <p>{capability.detail}</p>
                </li>
              ))}
            </ul>
          </section>

          <div className="home-entry-cards">
            <Link href="/projects?mode=review" className="home-entry">
              <strong>已有配置单？</strong>
              <span>粘贴整单，逐行查坑</span>
            </Link>
            <Link href="/diy" className="home-entry">
              <strong>很懂硬件？</strong>
              <span>直接进入高级 DIY</span>
            </Link>
          </div>
        </div>

        <aside className="workbench-aside page-level" aria-label="最近方案">
          <section className="wb-panel recent-designs" aria-labelledby="recent-title">
            <div className="home-section-heading">
              <h2 id="recent-title">最近的方案</h2>
              {builds.length > 0 && <Link href="/projects">全部 <span aria-hidden>→</span></Link>}
            </div>
            {builds.length > 0 ? (
              <ul>
                {builds.map((build) => (
                  <li key={build.id}>
                    <Link href={`/diy?project=${build.id}`}>
                      <span>{build.name}</span>
                      <span className="recent-meta">{build.items.length} 个配件 · {formatTime(build.updatedAt)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="recent-empty">还没有方案。描述一个目标，生成的方案会出现在这里。</p>
            )}
          </section>
        </aside>
      </div>
    </main>
  );
}
