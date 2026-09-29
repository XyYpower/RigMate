import type { ItemSpec } from "@/ui/category-form";

/** 页面本地 item 的最小结构（与领域 BuildItem 的决策字段兼容） */
type SizeItem = {
  category: string;
  label: string;
  spec: ItemSpec;
};

/**
 * 尺寸核对（参考图"机箱 & 显卡 侧视图"的轻量实现）：
 * 显卡长度 vs 机箱限长、散热器高度 vs 机箱限高。
 * 诚实边界——两边都有已核数据才画条；缺任何一边就不显示该行，绝不猜。
 */
export function SizeCompare({ items }: { items: SizeItem[] }) {
  const gpu = items.find((item) => item.category === "gpu");
  const cooler = items.find((item) => item.category === "cooler");
  const chassis = items.find((item) => item.category === "case");

  const gpuLength = gpu?.spec.lengthMm as number | undefined;
  const coolerHeight = cooler?.spec.heightMm as number | undefined;
  const maxGpuLength = chassis?.spec.maxGpuLengthMm as number | undefined;
  const maxCoolerHeight = chassis?.spec.maxCoolerHeightMm as number | undefined;

  const rows: Array<{
    id: string;
    title: string;
    partLabel: string;
    partValue: number;
    limitLabel: string;
    limitValue: number;
    unit: string;
  }> = [];

  if (typeof gpuLength === "number" && typeof maxGpuLength === "number") {
    rows.push({
      id: "gpu",
      title: "显卡长度 vs 机箱限长",
      partLabel: gpu?.label ?? "显卡",
      partValue: gpuLength,
      limitLabel: chassis?.label ?? "机箱",
      limitValue: maxGpuLength,
      unit: "mm",
    });
  }
  if (typeof coolerHeight === "number" && typeof maxCoolerHeight === "number") {
    rows.push({
      id: "cooler",
      title: "散热器高度 vs 机箱限高",
      partLabel: cooler?.label ?? "散热器",
      partValue: coolerHeight,
      limitLabel: chassis?.label ?? "机箱",
      limitValue: maxCoolerHeight,
      unit: "mm",
    });
  }

  if (rows.length === 0) {
    return (
      <section className="wb-panel size-compare" aria-label="尺寸核对">
        <div className="build-parts-section-head">
          <h2>尺寸核对</h2>
          <span>显卡长度、散热器高度与机箱限值都已核实时显示</span>
        </div>
        <p className="size-compare-empty">
          还缺关键尺寸：显卡/散热器或机箱的尺寸补齐后，这里会出现对比标尺。
        </p>
      </section>
    );
  }

  return (
    <section className="wb-panel size-compare" aria-label="尺寸核对">
      <div className="build-parts-section-head">
        <h2>尺寸核对</h2>
        <span>已核数据 · 超出限值会标红</span>
      </div>
      <div className="size-compare-rows">
        {rows.map((row) => {
          const scale = Math.max(row.partValue, row.limitValue);
          const overflow = row.partValue > row.limitValue;
          return (
            <div className={`size-row ${overflow ? "overflow" : ""}`} key={row.id}>
              <p className="size-row-title">
                {row.title}
                {overflow && <em className="size-row-over">超出 {row.partValue - row.limitValue}{row.unit}</em>}
              </p>
              <div className="size-bar-line">
                <span className="size-bar-label">{row.partLabel}</span>
                <div className="size-bar-track">
                  <div className="size-bar size-bar-part" style={{ width: `${(row.partValue / scale) * 100}%` }} />
                </div>
                <span className="size-bar-value">{row.partValue}{row.unit}</span>
              </div>
              <div className="size-bar-line">
                <span className="size-bar-label">{row.limitLabel}</span>
                <div className="size-bar-track">
                  <div className="size-bar size-bar-limit" style={{ width: `${(row.limitValue / scale) * 100}%` }} />
                </div>
                <span className="size-bar-value">限 {row.limitValue}{row.unit}</span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
