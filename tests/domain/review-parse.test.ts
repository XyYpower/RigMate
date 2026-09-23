import { describe, expect, it } from "vitest";
import { modelTokenOf, parseReviewText } from "@/domain/review/parse";

describe("整机复核配置单解析器（真实样本行回归）", () => {
  it("样本1 直播单：类别识别、行尾价格提取、赠品行跳过", () => {
    const lines = parseReviewText(`
配置单（比价格 对方18399）
CPU    i7 14700KF 盒装 20核心28线程 三年全国联保        2689
散热   利民MV360 ARGB雷神之锤 3.5寸液晶屏 黑            599
主板   华硕ROG STRIX Z790-H GAMING WIFI D5              2699
内存   宏碁 掠夺者炫光星舰6800 32G(16*2) A-Die/C34 黑    850
显卡   七彩虹 RTX4080 SUPER 16G 火神OC                  9399
固态   宏碁 掠夺者GM7 1TB NVME4.0 读7200写6300           569
机箱   航嘉S980龙卷风 全景无立柱 黑                      280
电源   航嘉MVP K850 850W 金牌全模ATX3.1 黑               650
显示器
风扇   棱镜 四代PRO ARGB 5V神光同步 黑 7                 196
其他
总价 19186
`);

    const parsed = lines.filter((l) => !l.skipped);
    expect(parsed.map((p) => p.category)).toEqual([
      "cpu",
      "cooler",
      "motherboard",
      "ram",
      "gpu",
      "storage",
      "case",
      "psu",
    ]);
    expect(parsed[0]).toMatchObject({ name: "i7 14700KF 盒装 20核心28线程 三年全国联保", priceCents: 268900 });
    expect(parsed[1]).toMatchObject({ name: "利民MV360 ARGB雷神之锤 3.5寸液晶屏 黑", priceCents: 59900 });
    expect(parsed[3]).toMatchObject({ name: "宏碁 掠夺者炫光星舰6800 32G(16*2) A-Die/C34 黑", priceCents: 85000 });
    // 名字里的 850W/6300/6800 不会被误当价格
    expect(parsed[7]?.name).toBe("航嘉MVP K850 850W 金牌全模ATX3.1 黑");
    expect(parsed[7]?.priceCents).toBe(65000);

    // 跳过行：标题/显示器/风扇/其他/总价
    const skipped = lines.filter((l) => l.skipped);
    expect(skipped.length).toBeGreaterThanOrEqual(5);
    expect(skipped.some((l) => /总价/.test(l.raw))).toBe(true);
    expect(skipped.some((l) => /显示器/.test(l.raw))).toBe(true);
    expect(skipped.some((l) => /风扇/.test(l.raw))).toBe(true);
  });

  it("样本6 店铺B：无价格行、类别冒号写法、mATX 板型行", () => {
    const lines = parseReviewText(`
CPU：AMD 锐龙5 9600X 6核12线程 散片
主板：华硕 PRIME B650EM-A WIFI6 8+2+1相供电
内存：金泰克 朱砂痣 16G 6000MHz C36
显卡：华硕 DUAL GeForce RTX 5070 O12G 雪豹
散热：酷里奥A60 镀镍六热管直触 双塔 ARGB 黑
`);
    const parsed = lines.filter((l) => !l.skipped);
    expect(parsed).toHaveLength(5);
    expect(parsed[0]).toMatchObject({ category: "cpu", name: "AMD 锐龙5 9600X 6核12线程 散片", priceCents: null });
    expect(parsed[1]).toMatchObject({ category: "motherboard", name: "华硕 PRIME B650EM-A WIFI6 8+2+1相供电" });
    // "C36" 带字母不是价格
    expect(parsed[2]?.priceCents).toBeNull();
    expect(parsed[2]?.category).toBe("ram");
  });

  it("样本7/10：14千分位价格、起字尾、升级注释不丢行", () => {
    const lines = parseReviewText(`
电源    机械大师 FX850 850W金牌全模组 全日系电容
电源    航嘉 WD750Evo炫金战神 750W 金牌 ATX3.1
CPU     AMD 锐龙7 9800X3D 8核16线程 散片 +499升级9850X3D
硬盘    雷克沙 NQ790 1T 7000MB/S SLC动态缓存
`);
    const parsed = lines.filter((l) => !l.skipped);
    expect(parsed).toHaveLength(4);
    // "+499升级" 不是行尾数字：整行保留为名字，价格不猜
    expect(parsed[2]?.name).toContain("9850X3D");
    expect(parsed[2]?.priceCents).toBeNull();
    expect(parsed[3]?.category).toBe("storage");
  });

  it("千分位与 ¥ 前缀价格", () => {
    const lines = parseReviewText(`
显卡  某卡 12,999
电源  某电源 ¥1,299.5
`);
    const parsed = lines.filter((l) => !l.skipped);
    expect(parsed[0]?.priceCents).toBe(1299900);
    expect(parsed[1]?.priceCents).toBe(129950);
  });

  it("未识别类别不猜：给用户手动归类", () => {
    const lines = parseReviewText(`
棱镜 四代PRO ARGB 5V神光同步
`);
    const skipped = lines.filter((l) => l.skipped);
    expect(skipped[0]?.skipReason).toContain("未识别类别");
  });

  it("modelTokenOf：取最长型号 token 作为目录检索关键词", () => {
    expect(modelTokenOf("利民 MV360 ARGB 雷神之锤 360 水冷 黑")).toBe("MV360");
    expect(modelTokenOf("金泰克 速虎TP5000 1T PCIE4.0")).toBe("TP5000");
    expect(modelTokenOf("华硕 DUAL GeForce RTX 5070 O12G 雪豹")).toBe("GeForce");
    expect(modelTokenOf("纯中文名字")).toBe("");
  });
});
