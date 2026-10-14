import { describe, expect, it } from "vitest";
import { syncAsusMotherboards } from "@/infra/catalog-import/cn/sync";

const indexUrl = "https://rog.asus.com.cn/motherboards-group/allmodels/";
const productUrl = "https://rog.asus.com.cn/motherboards/rog-strix/rog-strix-b850-f-gaming-wifi/";
const productSpecUrl = `${productUrl}spec/`;
const indexHtml = `<a href="${productUrl}">主板</a><a href="https://rog.asus.com.cn/support">支持</a>`;
const productHtml = `<!doctype html>
<script type="application/ld+json">[{"@type":"Product","name":"ROG STRIX B850-F GAMING WIFI","sku":"90MB1J70-M0CAY0","brand":{"name":"ROG"}}]</script>
<h1>ROG STRIX B850-F GAMING WIFI</h1>
<p>AMD AM5 插槽</p><p>4 x 内存插槽 DDR5</p><p>1 x PCIe 5.0 x16 插槽</p>
<p>共支持 4个 M.2 插槽与 2 个 SATA 6Gb/s 接口</p><p>ATX 规格</p>`;

describe("华硕大陆来源同步", () => {
  it("发现索引链接并解析详情页，同时限制数量", async () => {
    const calls: string[] = [];
    const result = await syncAsusMotherboards({
      indexUrl,
      limit: 1,
      fetchImpl: async (input) => {
        const url = String(input);
        calls.push(url);
        return new Response(url === indexUrl ? indexHtml : productHtml, { status: 200 });
      },
    });

    expect(calls).toEqual([indexUrl, productSpecUrl]);
    expect(result.products).toHaveLength(1);
    expect(result.rejected).toEqual([]);
    expect(result.products[0]?.mpn).toBe("90MB1J70-M0CAY0");
  });

  it("详情页失败只进入 rejected，不中断其他产品", async () => {
    const secondUrl = "https://rog.asus.com.cn/motherboards/rog-strix/second/";
    const result = await syncAsusMotherboards({
      indexUrl,
      limit: 2,
      fetchImpl: async (input) => {
        const url = String(input);
        if (url === indexUrl) return new Response(`${indexHtml}<a href="${secondUrl}">第二块</a>`, { status: 200 });
        if (url === `${secondUrl}spec/`) return new Response("blocked", { status: 403 });
        return new Response(productHtml, { status: 200 });
      },
    });

    expect(result.products).toHaveLength(1);
    expect(result.rejected).toEqual([{ url: `${secondUrl}spec/`, reason: "HTTP 403" }]);
  });

  it("请求超时进入 rejected，并继续处理后续详情页", async () => {
    const secondUrl = "https://rog.asus.com.cn/motherboards/rog-strix/second-timeout/";
    const result = await syncAsusMotherboards({
      indexUrl,
      limit: 2,
      timeoutMs: 100,
      fetchImpl: async (input, init) => {
        const url = String(input);
        if (url === indexUrl) return new Response(`${indexHtml}<a href="${secondUrl}">超时</a>`, { status: 200 });
        if (url === `${secondUrl}spec/`) {
          await new Promise<void>((resolve, reject) => {
            const signal = init?.signal;
            if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
            signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
          });
        }
        return new Response(productHtml, { status: 200 });
      },
    });

    expect(result.products).toHaveLength(1);
    expect(result.rejected).toEqual([{ url: `${secondUrl}spec/`, reason: "请求超时" }]);
  });
});
