"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

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
      <section className="home-intro">
        <p className="home-kicker">RIGMATE · PC 装机决策工作台</p>
        <h1>你想配置一台什么样的电脑？</h1>
        <p className="home-lede">说说预算、用途和偏好。RigMate 会先给出一套方案，再由你决定怎么调整。</p>
      </section>

      <form className="goal-composer" onSubmit={(event) => void startDesign(event)}>
        <label className="sr-only" htmlFor="design-goal">描述你的装机目标</label>
        <textarea
          id="design-goal"
          name="goal"
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
          onInput={(event) => setGoal(event.currentTarget.value)}
          rows={4}
          maxLength={4000}
          placeholder="例如：2 万预算，想要白色海景房，主要做视频剪辑和玩 3A 游戏……"
          disabled={busy}
        />
        <div className="goal-composer-footer">
          <label className="goal-budget">
            <span>预算</span>
            <input name="budget" aria-label="预算（元，可选）" inputMode="numeric" value={budget} onChange={(event) => setBudget(event.target.value)} onInput={(event) => setBudget(event.currentTarget.value)} placeholder="从描述中识别" disabled={busy} />
          </label>
          <button className="button primary goal-submit" type="submit" disabled={busy}>
            {busy ? "正在搭配…" : "生成装机方案"}<span aria-hidden>→</span>
          </button>
        </div>
        {message && <p className="form-feedback" role="status">{message}</p>}
      </form>

      <div className="home-shortcuts">
        <span>也可以</span>
        <Link href="/projects">从已有方案继续</Link>
        <span aria-hidden>·</span>
        <Link href="/projects?mode=review">粘贴配置单复核</Link>
        <span aria-hidden>·</span>
        <Link href="/diy">直接进入自由 DIY</Link>
      </div>

      {builds.length > 0 && (
        <section className="recent-designs" aria-labelledby="recent-title">
          <div className="home-section-heading">
            <h2 id="recent-title">最近的方案</h2>
            <Link href="/projects">全部方案 <span aria-hidden>→</span></Link>
          </div>
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
        </section>
      )}
    </main>
  );
}
