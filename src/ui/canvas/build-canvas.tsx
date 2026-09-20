"use client";

import { computeCaseLayout, type CanvasItem } from "@/ui/canvas/layout";

/**
 * 机器画布：机箱剖视示意图（设计文档 §5.2）。
 * 红色 = 尺寸超差；虚线幽灵 = 规格待补充；标尺 = 规则比较的直接可视化。
 */
export function BuildCanvas({ items }: { items: CanvasItem[] }) {
  const layout = computeCaseLayout(items);
  const viewW = layout.interior.x + layout.interior.w + 12;
  const viewH = layout.interior.y + layout.interior.h + 16;

  return (
    <div className="canvas-wrap">
      <svg
        viewBox={`0 0 ${viewW} ${viewH}`}
        className="canvas-svg"
        role="img"
        aria-label="机箱内部比例示意图"
      >
        {/* 内腔 */}
        <rect
          x={layout.interior.x}
          y={layout.interior.y}
          width={layout.interior.w}
          height={layout.interior.h}
          fill="rgba(53, 201, 163, 0.03)"
          stroke={layout.interiorGhost ? "var(--rm-unknown)" : "var(--rm-line)"}
          strokeWidth={1.5}
          strokeDasharray={layout.interiorGhost ? "6 5" : undefined}
          rx={3}
        />
        <text
          x={layout.interior.x + 8}
          y={layout.interior.y + 16}
          fontSize={10}
          fill="var(--rm-ink-faint)"
        >
          {layout.interiorGhost ? "机箱 · 规格待补充" : "机箱内腔"}
        </text>

        {layout.parts.map((part) => {
          const stroke = part.violated
            ? "var(--rm-block)"
            : part.ghost
              ? "var(--rm-unknown)"
              : part.category === "motherboard"
                ? "var(--rm-accent)"
                : "var(--rm-line)";
          return (
            <g key={part.id}>
              <title>{part.sublabel ? `${part.label} · ${part.sublabel}` : part.label}</title>
              <rect
                x={part.x}
                y={part.y}
                width={part.w}
                height={part.h}
                fill={part.violated ? "var(--rm-block-soft)" : part.ghost ? "transparent" : "rgba(232, 236, 233, 0.05)"}
                stroke={stroke}
                strokeWidth={part.violated ? 1.8 : 1.2}
                strokeDasharray={part.ghost ? "5 4" : undefined}
                rx={2}
              />
              {part.w > 42 && part.label && (
                <text
                  x={part.x + part.w / 2}
                  y={part.y + part.h / 2 + 4}
                  fontSize={11}
                  textAnchor="middle"
                  fontWeight={700}
                  fill={part.violated ? "var(--rm-block)" : part.ghost ? "var(--rm-unknown)" : "var(--rm-ink-muted)"}
                >
                  {part.label}
                </text>
              )}
            </g>
          );
        })}

        {layout.rulers.map((ruler) => {
          const color = ruler.violated
            ? "var(--rm-block)"
            : ruler.ghost
              ? "var(--rm-unknown)"
              : "var(--rm-accent)";
          const horizontal = ruler.y1 === ruler.y2;
          const midX = (ruler.x1 + ruler.x2) / 2;
          const midY = (ruler.y1 + ruler.y2) / 2;
          return (
            <g key={ruler.id}>
              <line
                x1={ruler.x1}
                y1={ruler.y1}
                x2={ruler.x2}
                y2={ruler.y2}
                stroke={color}
                strokeWidth={1.4}
              />
              <line x1={ruler.x1} y1={ruler.y1 - 4} x2={ruler.x1} y2={ruler.y1 + 4} stroke={color} strokeWidth={1.4} />
              <line x1={ruler.x2} y1={ruler.y2 - 4} x2={ruler.x2} y2={ruler.y2 + 4} stroke={color} strokeWidth={1.4} />
              <text
                x={horizontal ? midX : midX + 12}
                y={horizontal ? ruler.y1 - 6 : midY + 4}
                fontSize={10.5}
                fontWeight={700}
                textAnchor={horizontal ? "middle" : "start"}
                fill={color}
              >
                {ruler.label}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="canvas-legend">
        <span><i className="legend-swatch legend-normal" /> 已确认</span>
        <span><i className="legend-swatch legend-ghost" /> 待补充（幽灵件）</span>
        <span><i className="legend-swatch legend-violated" />&gt; 限值（超差）</span>
      </div>

      {layout.notes.length > 0 && (
        <ul className="canvas-notes" aria-live="polite">
          {layout.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
