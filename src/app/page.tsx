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

/** 示例：展示短标签，点击填入完整目标——展示与数据分离，消除重复长句 */
const GOAL_SUGGESTIONS = [
  { tag: "白色海景房 · 2 万", full: "2 万预算，白色海景房，主要做视频剪辑和玩 3A 游戏" },
  { tag: "2K 游戏 · 安静 · 8 千", full: "8 千预算，主要玩 2K 游戏，想要安静一点" },
  { tag: "代码虚拟机 · 1.5 万", full: "1 万 5 预算，写代码加虚拟机多开，不要灯效" },
];

/**
 * 首页 = 会话起点（agent-ui，对齐 ZCode 空会话页模式）：
 * 一个输入框，一句话进来；缺什么 agent 在会话里追问（用途 → 外观 → 预算），
 * 不用表单把用户拦在门外。提交即进会话页看生成全程（异步）。
 */
export default function Home() {
  const router = useRouter();
  const [goal, setGoal] = useState("");
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
    if (!goalValue) return;
    setBusy(true);
    setMessage("");
    try {
      // 异步模式：请求落库即跳会话页，agent 生成全程在时间线上点亮；
      // 预算/外观缺什么由 agent 在会话里追问，不在表单里拦人
      const response = await fetch("/api/design", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawInput: goalValue, async: true }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "暂时无法生成方案。");
      router.push(`/design/${data.requestId}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "暂时无法生成方案，请重试。");
      setBusy(false);
    }
  }

  return (
    <main className="home-page">
      <div className="home-entry">
        <span className="home-brandmark" aria-hidden>R</span>
        <h1>你想配一台什么样的电脑？</h1>
        <p className="home-tagline">
          一句话说说用途和偏好就行，缺什么我会问你——然后从已核目录里检索候选、跑兼容规则，给出可核验的方案。
        </p>

        <form className="home-composer" onSubmit={(event) => void startDesign(event)}>
          <label className="sr-only" htmlFor="design-goal">描述你的装机目标</label>
          <textarea
            id="design-goal"
            name="goal"
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            onInput={(event) => setGoal(event.currentTarget.value)}
            rows={3}
            maxLength={4000}
            placeholder="比如：主要玩 3A 游戏，偶尔剪视频，想要白色的……"
            disabled={busy}
            autoFocus
          />
          <div className="home-composer-toolbar">
            <span className="home-composer-hint">回车或点击开始，缺的信息我会追问</span>
            <button className="button primary home-submit" type="submit" disabled={busy || goal.trim().length < 3}>
              {busy ? "正在开始…" : "开始搭配"}<span aria-hidden>→</span>
            </button>
          </div>
          {message && <p className="form-feedback" role="status">{message}</p>}
        </form>

        {!busy && (
          <div className="home-suggestions" aria-label="示例目标">
            {GOAL_SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion.tag}
                type="button"
                className="home-suggestion"
                onClick={() => setGoal(suggestion.full)}
                disabled={busy}
              >
                <span aria-hidden>›</span>
                {suggestion.tag}
              </button>
            ))}
          </div>
        )}

        <p className="home-footer-links">
          已有配置单？<Link href="/projects?mode=review">粘贴整单逐行查坑</Link>
          <span aria-hidden> · </span>
          很懂硬件？<Link href="/diy">直接进高级 DIY</Link>
        </p>

        {builds.length > 0 && (
          <section className="home-recent" aria-labelledby="recent-title">
            <h2 id="recent-title">最近的方案</h2>
            <ul>
              {builds.map((build) => (
                <li key={build.id}>
                  <Link href={`/diy?project=${build.id}`}>
                    <span>{build.name}</span>
                    <span className="home-recent-meta">{build.items.length} 件 · {formatTime(build.updatedAt)}</span>
                  </Link>
                </li>
              ))}
              <li className="home-recent-more">
                <Link href="/design">全部方案会话 <span aria-hidden>→</span></Link>
              </li>
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
