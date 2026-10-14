import { describe, expect, it } from "vitest";
import { discoverAsusProductLinks, parseAsusProductPage } from "@/infra/catalog-import/cn/asus";

const PRODUCT_HTML = `<!doctype html>
<html lang="zh-cn">
  <head>
    <title>ROG STRIX B850-F GAMING WIFI | ROG ASUS中国</title>
    <script type="application/ld+json">
      [{"@context":"http://schema.org","@type":"Product","name":"ROG STRIX B850-F GAMING WIFI","sku":"90MB1J70-M0CAY0","brand":{"@type":"Brand","name":"ROG"},"offers":{"priceCurrency":"CNY","price":"2499","url":"https://www.asus.com.cn/store/goods/detail?productId=42243237029308"}}]
    </script>
  </head>
  <body>
    <h1>ROG STRIX B850-F GAMING WIFI</h1>
    <section>AMD AM5 插槽</section>
    <section>4 x 内存插槽，可支持至 256GB DDR5</section>
    <section>1 x PCIe 5.0 x16 插槽</section>
    <section>1 x PCIe 5.0 x16 插槽</section>
    <section>共支持 4个 M.2 插槽与 2 个 SATA 6Gb/s 接口</section>
    <section>ATX 规格</section>
  </body>
</html>`;

describe("华硕中国大陆来源适配器", () => {
  it("从公开详情页提取国行身份、价格和主板决策规格", () => {
    const result = parseAsusProductPage(
      "https://rog.asus.com.cn/motherboards/rog-strix/rog-strix-b850-f-gaming-wifi/spec/",
      PRODUCT_HTML,
    );

    expect(result).toMatchObject({
      category: "motherboard",
      name: "ROG STRIX B850-F GAMING WIFI",
      mpn: "90MB1J70-M0CAY0",
      manufacturer: "ROG",
      spec: {
        socket: "AM5",
        ramType: "DDR5",
        formFactor: "ATX",
        ramSlots: 4,
        m2Slots: 4,
        sataPorts: 2,
        pcieX16Slots: 1,
      },
      priceCny: 2499,
    });
    expect(result.id).toBe("cn-asus-90mb1j70-m0cay0");
    expect(result.evidence.some((item) => item.fieldPath === "spec.m2Slots")).toBe(true);
  });

  it("从大陆厂商索引页提取产品详情链接并过滤站外链接", () => {
    const html = `
      <a href="https://rog.asus.com.cn/motherboards/rog-strix/a/">A</a>
      <a href="https://rog.asus.com.cn/motherboards/rog-crosshair/b/">B</a>
      <a href="https://www.asus.com/motherboards/rog-strix/c/">站外地区</a>
      <a href="https://rog.asus.com.cn/support">支持</a>
    `;

    expect(discoverAsusProductLinks(html)).toEqual([
      "https://rog.asus.com.cn/motherboards/rog-crosshair/b/",
      "https://rog.asus.com.cn/motherboards/rog-strix/a/",
    ]);
  });

  it("没有产品 JSON-LD 或型号时拒绝写入", () => {
    expect(() => parseAsusProductPage("https://rog.asus.com.cn/motherboards/rog-strix/empty/", "<html></html>")).toThrow(
      "无法确定产品身份",
    );
  });

  it("不把只有物理 x16、但电气为 x4 的槽位计入独显 x16 槽", () => {
    const html = PRODUCT_HTML.replace(
      "<section>1 x PCIe 5.0 x16 插槽</section>\n    <section>1 x PCIe 5.0 x16 插槽</section>",
      "<section>1 x PCIe 5.0 x16 插槽</section>\n    <section>1 x PCIe 4.0 x16（支持 x4 模式）插槽</section>",
    );

    expect(parseAsusProductPage("https://rog.asus.com.cn/motherboards/rog-strix/electrical/spec/", html).spec.pcieX16Slots).toBe(1);
  });

  it("解析华硕规格页实际使用的英文规格行", () => {
    const html = `<!doctype html>
      <script type="application/ld+json">[{"@type":"Product","name":"ROG CROSSHAIR X870E DARK HERO","sku":"90MB1NT0-M0CAY0","brand":{"name":"ROG"}}]</script>
      <p>AMD AM5 Socket</p>
      <p>4 x DIMM slots, max. 256GB, DDR5</p>
      <p>Supports 5 x M.2 slots and 4 x SATA 6Gb/s ports</p>
      <p>ATX Form Factor</p>
      <p>2 x PCIe 5.0 x16 slots (supports x16 or x8/x8 modes)</p>`;

    expect(parseAsusProductPage("https://rog.asus.com.cn/motherboards/rog-crosshair/rog-crosshair-x870e-dark-hero/spec/", html)).toMatchObject({
      spec: {
        socket: "AM5",
        ramType: "DDR5",
        formFactor: "ATX",
        ramSlots: 4,
        m2Slots: 5,
        sataPorts: 4,
        pcieX16Slots: 2,
      },
    });
  });

  it("忽略网页拼接造成的 x1 16 假 x16 槽位", () => {
    const html = `<!doctype html>
      <script type="application/ld+json">[{"@type":"Product","name":"ROG B850-F","sku":"90B850F-M0CAY0","brand":{"name":"ROG"}}]</script>
      <p>1 x PCIe 5.0 x16 slot；1 x PCIe 4.0 x16 slots；1 x PCIe 4.0 x1 16 slot</p>`;

    expect(parseAsusProductPage("https://rog.asus.com.cn/motherboards/rog-strix/b850-f/spec/", html).spec.pcieX16Slots).toBe(2);
  });

  it("不把仅支持 x8 电气模式的物理 x16 槽计入 x16 槽位", () => {
    const html = `<!doctype html>
      <script type="application/ld+json">[{"@type":"Product","name":"ROG B850-F","sku":"90B850F-X8-M0CAY0","brand":{"name":"ROG"}}]</script>
      <p>1 x PCIe 5.0 x16 slot (supports x16 mode)</p>
      <p>1 x PCIe 4.0 x16 slots (supports x8 mode)</p>
      <p>1 x PCIe 4.0 x16 slot (supports x4 mode)</p>`;

    expect(parseAsusProductPage("https://rog.asus.com.cn/motherboards/rog-strix/b850-f-x8/spec/", html).spec.pcieX16Slots).toBe(1);
  });

  it("忽略包含 PCIe 版本前缀的 x8/x4 电气模式", () => {
    const html = `<!doctype html>
      <script type="application/ld+json">[{"@type":"Product","name":"ROG B850-A","sku":"90B850A-M0CAY0","brand":{"name":"ROG"}}]</script>
      <p>1 x PCIe 5.0 x16 slot (supports x16 mode)</p>
      <p>1 x PCIe 5.0 x16 slot (supports PCIe 4.0 x8 mode)</p>
      <p>1 x PCIe 5.0 x16 slot (supports PCIe 4.0 x4 mode)</p>
      <p>1 x PCIe 4.0 x16 slot (supports x4/x2 mode)</p>`;

    expect(parseAsusProductPage("https://rog.asus.com.cn/motherboards/rog-strix/b850-a/spec/", html).spec.pcieX16Slots).toBe(1);
  });

  it("把 X870E 规格中的 x8/x4 槽排除，只保留真正 x16 模式", () => {
    const html = `<!doctype html>
      <script type="application/ld+json">[{"@type":"Product","name":"ROG X870E-A","sku":"90X870EA-M0CAY0","brand":{"name":"ROG"}}]</script>
      <p>1 x PCIe 5.0 x16 slot (supports x16 mode)</p>
      <p>1 x PCIe 4.0 x16 slots (supports x8 mode)</p>
      <p>1 x PCIe 4.0 x16 slots (supports x4 mode)</p>
      <p>1 x PCIe 4.0 x16 slot (supports x4 mode)</p>`;

    expect(parseAsusProductPage("https://rog.asus.com.cn/motherboards/rog-strix/x870e-a/spec/", html).spec.pcieX16Slots).toBe(1);
  });

  it("处理嵌套括号中的 only supports x4，并保留 DARK HERO 的两条 x16 槽", () => {
    const html = `<!doctype html>
      <script type="application/ld+json">[{"@type":"Product","name":"ROG DARK HERO","sku":"90DARK-M0CAY0","brand":{"name":"ROG"}}]</script>
      <p>2 x PCIe 5.0 x16 slots (supports x16 or x8/x8 modes)</p>
      <p>2 x PCIe 4.0 x16 slots (only supports PCIEx16(G5)_1 &amp; total bandwidth for x8, PCIEx16(G5)_2 will run at PCIe 3.0 x4)</p>`;

    expect(parseAsusProductPage("https://rog.asus.com.cn/motherboards/rog-crosshair/dark/spec/", html).spec.pcieX16Slots).toBe(2);
  });

  it("不把同一物理槽在不同 CPU 下的 PCIe 5.0/4.0 规格重复相加", () => {
    const html = `<!doctype html>
      <script type="application/ld+json">[{"@type":"Product","name":"ROG B850-I","sku":"90B850I-M0CAY0","brand":{"name":"ROG"}}]</script>
      <p>AMD Ryzen™ 9000 &amp; 7000 Series Desktop Processors 1 x PCIe 5.0 x16 slot with Q-Release Slim</p>
      <p>AMD Ryzen™ 8000 Series Desktop Processors 1 x PCIe 4.0 x16 slot with Q-Release Slim</p>`;

    expect(parseAsusProductPage("https://rog.asus.com.cn/motherboards/rog-strix/b850-i/spec/", html).spec.pcieX16Slots).toBe(1);
  });
});
