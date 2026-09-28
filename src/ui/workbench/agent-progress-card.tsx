import type { AgentEvent } from "@/contracts/design";
import type { AgentTimelineStep } from "./types";

/** AgentEvent → 时间线步骤：waiting/question = 等待节点，其余按状态映射 */
export function toTimelineSteps(events: AgentEvent[]): AgentTimelineStep[] {
  return events.map((event) => ({
    id: event.id,
    title: event.message,
    description: "",
    at: event.createdAt,
    state:
      event.status === "waiting"
        ? "waiting"
        : event.status === "started"
          ? "active"
          : "done",
  }));
}

/** Agent 处理进度（参考图右栏上半）：垂直时间线 + 真实时间戳，不伪造进行中动画 */
export function AgentProgressCard({ steps }: { steps: AgentTimelineStep[] }) {
  return (
    <section className="wb-panel agent-progress-card" aria-labelledby="agent-progress-title">
      <div className="agent-progress-card-head">
        <h2 id="agent-progress-title">Agent 处理进度</h2>
        <span className="agent-progress-card-state">
          {steps.some((step) => step.state === "waiting") ? "等待你确认" : "已完成"}
        </span>
      </div>
      <ol className="agent-timeline">
        {steps.map((step) => (
          <li key={step.id} className={`agent-timeline-step ${step.state}`}>
            <span className="agent-timeline-mark" aria-hidden />
            <div>
              <p>{step.title}</p>
              {step.at && <time>{new Date(step.at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</time>}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
