import { describe, expect, it } from "vitest";
import {
  cleanProductName,
  jsonLdProducts,
  preferSpecificName,
  productNameOf,
  visibleText,
} from "@/infra/catalog-import/cn/contract";
import {
  normalizeFormFactor,
  normalizeSocket,
  parseSpecByCategory,
} from "@/infra/catalog-import/cn/spec-parsers";
import { msiSpecPairs } from "@/infra/catalog-import/cn/msi";

/**
 * 大陆官网采集适配器测试。
 *
 * 这里的每个用例都对着**真实页面的真实结构**写的——因为这层解析一旦出错，
 * 产出的是"带着 S1 官方来源标记的错误字段"，会通过质量门去驱动兼容规则。
 * 所以除了解析能力本身，还要专门盯住"宁可不解析，也不要解析错"。
 */

describe("页面基础提取", () => {
  it("JSON-LD Product 提取 name/sku/brand", () => {
    const html = `<script type="application/ld+json">
      {"@type":"Product","name":"GeForce RTX 5090","sku":"SKU-1","brand":{"name":"MSI"}}
    </script>`;
    expect(jsonLdProducts(html)).toEqual([
      { name: "GeForce RTX 5090", sku: "SKU-1", brand: "MSI", price: null },
    ]);
  });

  it("损坏的 JSON-LD 块不拖垮其它数据", () => {
    const html = `<script type="application/ld+json">{坏掉的</script>
      <script type="application/ld+json">{"@type":"Product","name":"X","sku":"S"}</script>`;
    expect(jsonLdProducts(html)).toHaveLength(1);
  });

  it("非 Product 的 JSON-LD 被忽略", () => {
    expect(jsonLdProducts(`<script type="application/ld+json">{"@type":"Organization"}</script>`)).toEqual([]);
  });

  it("产品名多级兜底：JSON-LD → og:title → title → 页面标题元素 → slug", () => {
    expect(productNameOf(`<script type="application/ld+json">{"@type":"Product","name":"JSON-LD 名"}</script>`)).toBe(
      "JSON-LD 名",
    );
    expect(productNameOf(`<meta property="og:title" content="OG 名">`)).toBe("OG 名");
    expect(productNameOf(`<title>页面标题 | 微星科技</title>`)).toBe("页面标题");
    expect(productNameOf("", "a520m-pro")).toBe("a520m pro");
  });

  it("title/og:title 为空时，回退到页面标题元素（微星新页面形态）", () => {
    // 回归：JS 渲染的新页面 <title> 与 og:title 都是空的，型号只在 <h3> 里
    const html = `<title></title><meta property="og:title" content="">
      <h3>{{productLine}}</h3>
      <h3>B560M-A PRO</h3>`;
    expect(productNameOf(html)).toBe("B560M-A PRO");
  });

  it("跳过前端模板占位符（{{xxx}}）", () => {
    expect(productNameOf(`<h3>{{productName}}</h3>`)).toBe("");
    expect(cleanProductName("{{ productLine }}")).toBe("");
  });

  it("剥掉标题里的 SEO 尾巴", () => {
    expect(
      cleanProductName("MAG B850M GAMING PRO MAX WIFI | Gaming Motherboards｜Best Motherboard for AI PC｜MSI"),
    ).toBe("MAG B850M GAMING PRO MAX WIFI");
    expect(cleanProductName("B860M GAMING PLUS WIFI | Gaming Motherboards｜MSI")).toBe(
      "B860M GAMING PLUS WIFI",
    );
  });

  it("系列页名（B550）要让位给 URL slug 里的具体型号", () => {
    // 回归：微星 B460/B550/H510 是芯片组系列页，多个型号共用一个路径，
    // 照抄标题会让几十条产品都叫 "B550"
    expect(preferSpecificName("B550", "B550-A-PRO")).toBe("B550 A PRO");
    expect(preferSpecificName("B550", "MAG-B550M-BAZOOKA")).toBe("MAG B550M BAZOOKA");
    // slug 没更具体时保留页面名（页面名更完整的情况）
    expect(preferSpecificName("MSI MEG Z790 ACE, E-ATX", "MEG-Z790-ACE")).toBe("MSI MEG Z790 ACE, E-ATX");
    expect(preferSpecificName("A520M PRO", undefined)).toBe("A520M PRO");
  });

  it("清洗掉 Overview 前缀与站点后缀", () => {
    expect(cleanProductName("Overview A520M PRO | 微星科技")).toBe("A520M PRO");
    expect(cleanProductName("Overview - A520M PRO")).toBe("A520M PRO");
    expect(cleanProductName("规格：B450 TOMAHAWK MAX")).toBe("B450 TOMAHAWK MAX");
    expect(cleanProductName("A520M PRO")).toBe("A520M PRO");
  });

  it("visibleText 去掉脚本内容，避免把 JS 变量当成规格值", () => {
    const html = `<script>var x = "M.2 接口 99";</script><div>CPU 插槽</div><div>AM4</div>`;
    const text = visibleText(html);
    expect(text).toContain("CPU 插槽");
    expect(text).not.toContain("99");
  });
});

describe("归一化", () => {
  it("插槽代号要在整串里搜索（AMD Socket AM4）", () => {
    expect(normalizeSocket("AMD Socket AM4")).toBe("AM4");
    expect(normalizeSocket("Socket AM5")).toBe("AM5");
    expect(normalizeSocket("LGA 1700")).toBe("LGA1700");
    expect(normalizeSocket("LGA1851")).toBe("LGA1851");
    expect(normalizeSocket("未知")).toBeUndefined();
  });

  it("板型归一化", () => {
    expect(normalizeFormFactor("M-ATX")).toBe("mATX");
    expect(normalizeFormFactor("Micro ATX")).toBe("mATX");
    expect(normalizeFormFactor("E-ATX")).toBe("E-ATX");
    expect(normalizeFormFactor("Mini-ITX")).toBe("ITX");
    expect(normalizeFormFactor("ATX")).toBe("ATX");
  });
});

describe("MSI 双栏规格结构", () => {
  // 真实页面的结构片段：左栏 ul#itembox 是标签，右栏 #pdtb .tr 是同序的值
  const PAGE = `
    <ul class="itembox" id="itembox">
      <li> CPU (最高支持)</li>
      <li> CPU 插槽</li>
      <li> DDR4 内存</li>
      <li> 内存插槽数</li>
      <li> M.2 接口</li>
      <li> SATAIII 接口</li>
      <li> PCI-E X16</li>
      <li> 尺寸规格</li>
    </ul>
    <div class="pdtb" id="pdtb">
      <div class="tr"><div class="td"><ul class="hidden-lg"><li class="specName"> CPU (最高支持)</li></ul>
        Support 3rd Gen AMD Ryzen&trade; Desktop Processors</div></div>
      <div class="tr"><div class="td"><ul class="hidden-lg"><li class="specName"> CPU 插槽</li></ul>
        AMD Socket AM4</div></div>
      <div class="tr"><div class="td"><ul class="hidden-lg"><li class="specName"> DDR4 内存</li></ul>
        Supports DDR4 1866/ 2133/ 2400/ 2667</div></div>
      <div class="tr"><div class="td"><ul class="hidden-lg"><li class="specName"> 内存插槽数</li></ul>
        2</div></div>
      <div class="tr"><div class="td"><ul class="hidden-lg"><li class="specName"> M.2 接口</li></ul>
        1</div></div>
      <div class="tr"><div class="td"><ul class="hidden-lg"><li class="specName"> SATAIII 接口</li></ul>
        4</div></div>
      <div class="tr"><div class="td"><ul class="hidden-lg"><li class="specName"> PCI-E X16</li></ul>
        1</div></div>
      <div class="tr"><div class="td"><ul class="hidden-lg"><li class="specName"> 尺寸规格</li></ul>
        M-ATX</div></div>
    </div>`;

  it("按索引配对标签与值，不靠文本邻近", () => {
    const pairs = msiSpecPairs(PAGE);
    expect(pairs).toHaveLength(8);
    expect(pairs.find((p) => p.label.includes("CPU 插槽"))?.value).toBe("AMD Socket AM4");
    expect(pairs.find((p) => p.label.includes("内存插槽数"))?.value).toBe("2");
  });

  it("值里剥掉只在窄屏显示的 specName 标签", () => {
    const pair = msiSpecPairs(PAGE).find((p) => p.label.includes("PCI-E X16"));
    expect(pair?.value).toBe("1");
    expect(pair?.value).not.toContain("specName");
  });

  it("解析出完整的主板必填字段", () => {
    const pairs = msiSpecPairs(PAGE);
    const { spec } = parseSpecByCategory("motherboard", "", PAGE, pairs);
    expect(spec).toMatchObject({
      socket: "AM4",
      ramType: "DDR4",
      formFactor: "mATX",
      ramSlots: 2,
      m2Slots: 1,
      sataPorts: 4,
      pcieX16Slots: 1,
    });
  });

  it("每个填上的字段都带原文摘录（证据链要求）", () => {
    const pairs = msiSpecPairs(PAGE);
    const { evidence } = parseSpecByCategory("motherboard", "", PAGE, pairs);
    expect(evidence.length).toBeGreaterThanOrEqual(7);
    for (const item of evidence) {
      expect(item.fieldPath).toMatch(/^spec\./);
      expect(item.excerpt.length).toBeGreaterThan(0);
    }
  });

  it("没有双栏结构时退回文本启发式，不抛错", () => {
    expect(msiSpecPairs("<div>没有结构</div>")).toEqual([]);
    const { spec } = parseSpecByCategory("motherboard", "CPU 插槽\nAM4", "<p>CPU 插槽</p>");
    expect(spec.socket).toBe("AM4");
  });
});

describe("宁可不解析，也不要解析错", () => {
  const pair = (label: string, value: string) => [{ label, value }];

  it("显卡长度越界就丢弃（43mm 不是显卡长度）", () => {
    const { spec } = parseSpecByCategory("gpu", "", "", pair("显卡尺寸", "43 x 112 x 20 mm"));
    expect(spec.lengthMm).toBeUndefined();
  });

  it("合法的显卡长度照常解析", () => {
    const { spec } = parseSpecByCategory("gpu", "", "", pair("显卡尺寸", "267 x 111 x 40 mm"));
    expect(spec.lengthMm).toBe(267);
  });

  it("值里没有 pin 字样就不猜供电接口数量（0 与未知不同义）", () => {
    const { spec } = parseSpecByCategory("gpu", "", "", pair("供电接口", "无外接供电"));
    expect(spec.pcie8pin).toBeUndefined();
    expect(spec.twelveVhpwr).toBeUndefined();
  });

  it("明确写了 8pin 才计数", () => {
    const { spec } = parseSpecByCategory("gpu", "", "", pair("供电接口", "1 x 8pin + 2 x 8pin"));
    expect(spec.pcie8pin).toBe(3);
    expect(spec.twelveVhpwr).toBeUndefined();
  });

  it("12VHPWR 被识别", () => {
    const { spec } = parseSpecByCategory("psu", "", "", pair("接口", "1 x 12VHPWR, 4 x 8pin"));
    expect(spec.twelveVhpwr).toBe(1);
    expect(spec.pcie8pin).toBe(4);
  });

  it("M.2 版本号不会被当成插槽数量", () => {
    const { spec } = parseSpecByCategory(
      "motherboard",
      "",
      "",
      [...pair("M.2 接口", "1"), ...pair("PCIe 版本", "3.2")],
    );
    expect(spec.m2Slots).toBe(1);
  });

  it("插槽数量越界就丢弃", () => {
    const { spec } = parseSpecByCategory("motherboard", "", "", pair("内存插槽数", "16"));
    expect(spec.ramSlots).toBeUndefined();
  });

  it("内存条数识别 2x16GB", () => {
    const { spec } = parseSpecByCategory("ram", "", "", pair("规格", "32GB (2 x 16GB) DDR5"));
    expect(spec.ddrType).toBe("DDR5");
    expect(spec.sticks).toBe(2);
  });
});

describe("对着真实官网结构核验过的规则", () => {
  // 以下用例的标签与取值全部来自 msi.cn 真实规格页

  it("机箱：英文标签也能取到限长与板型", () => {
    const pairs = [
      { label: "主板规格支持", value: "ATX / mATX / Mini-ITX" },
      { label: "Maximum GPU Length", value: "330 mm" },
      { label: "Maximum CPU Cooler Length", value: "160 mm" },
    ];
    const { spec } = parseSpecByCategory("case", "", "", pairs);
    expect(spec).toMatchObject({
      supportedFormFactors: ["ATX", "mATX", "ITX"],
      maxGpuLengthMm: 330,
      maxCoolerHeightMm: 160,
    });
  });

  it("机箱：毫米在前英寸在后时取毫米", () => {
    const { spec } = parseSpecByCategory(
      "case",
      "",
      "",
      [{ label: "Maximum GPU Length", value: "390 mm / 15.35 inches" }],
    );
    expect(spec.maxGpuLengthMm).toBe(390);
  });

  it("散热器：插槽分散在 Intel/AMD 两行，必须合并", () => {
    const pairs = [
      { label: "Intel Socket", value: "LGA 1700 / 1851" },
      { label: "AMD Socket", value: "AM5/AM4" },
    ];
    const { spec } = parseSpecByCategory("cooler", "", "", pairs);
    // 少一个插槽号看着无害，但会让"支持插槽"悄悄少一半
    expect(spec.supportedSockets).toEqual(["LGA1700", "LGA1851", "AM5", "AM4"]);
  });

  it("散热器：裸数字承接上一段的 LGA 前缀", () => {
    const { spec } = parseSpecByCategory(
      "cooler",
      "",
      "",
      [{ label: "Intel Socket", value: "LGA 1700 / 1851" }],
    );
    expect(spec.supportedSockets).toContain("LGA1851");
  });

  it("显卡：官网只有建议电源，没有 TDP 时不填 tdpWatts", () => {
    // MSI 规格页无 TDP；"建议电源 600 W" 是推荐电源功率，绝不能当显卡功耗
    const pairs = [
      { label: "显卡尺寸", value: "230 x 115 x 43 mm" },
      { label: "建议电源 (W)", value: "600 W" },
      { label: "供电接口", value: "8-pin x 1" },
    ];
    const { spec } = parseSpecByCategory("gpu", "", "", pairs);
    expect(spec.lengthMm).toBe(230);
    expect(spec.pcie8pin).toBe(1);
    expect(spec.tdpWatts).toBeUndefined();
  });
});
