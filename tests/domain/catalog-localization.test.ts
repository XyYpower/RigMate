import { describe, expect, it } from "vitest";
import {
  VENDOR_NAME_ZH,
  containsChinese,
  localizeCatalogEntry,
  localizeProductName,
  resolveDisplayNames,
} from "@/domain/catalog/localization";
import type { CatalogEntry } from "@/domain/catalog/seed";

/**
 * 用目录里真实存在的名字做回归，避免本地化表和实际目录脱节。
 * 样例名取自 data/rigmate.db 质量门内条目与 src/domain/catalog/seed.ts。
 */

describe("containsChinese", () => {
  it("识别中文", () => {
    expect(containsChinese("华硕 ROG STRIX B850-A 吹雪")).toBe(true);
    expect(containsChinese("ASUS ROG")).toBe(false);
    expect(containsChinese("RTX 5090")).toBe(false);
  });
});

describe("localizeProductName 厂商前缀", () => {
  it("双词厂商名优先于单词（Western Digital 不能被截成 Western）", () => {
    expect(localizeProductName("Western Digital SN850X 2TB").display).toBe(
      "西部数据 SN850X 2TB",
    );
  });

  it("大小写与空格写法都命中", () => {
    expect(localizeProductName("ASUS ROG STRIX B850-F GAMING WIFI").display).toBe(
      "华硕 ROG STRIX B850-F GAMING WIFI",
    );
    expect(localizeProductName("Asus TUF GAMING B850-PLUS WIFI").display).toBe(
      "华硕 TUF GAMING B850-PLUS WIFI",
    );
    expect(localizeProductName("GIGABYTE B760M AORUS ELITE AX").display).toBe(
      "技嘉 B760M AORUS ELITE AX",
    );
  });

  it("含感叹号的品牌名照常命中", () => {
    expect(localizeProductName("be quiet! Dark Rock 4").display).toBe("德商必酷 Dark Rock 4");
  });

  it("默认截掉尾部规格参数（型号本身保持英文原样，不改写字母）", () => {
    // BuildCores 的 name 是"营销名 + 参数堆叠"，默认裁掉参数段提升可读性；
    // 字母部分一个不动，完整原名仍保留在 displayNameOriginal。
    // 注意 Black 保留：XPG CYBERCORE II 有 Black/White 两个版本，颜色是变体标识不是噪音。
    const raw = "ADATA XPG CYBERCORE II Black 1300W Fully Modular 80+ Platinum Certified";
    const result = localizeProductName(raw);
    expect(result.display).toBe("威刚 XPG CYBERCORE II Black");
    expect(result.original).toBe(raw);
    expect(result.basis).toBe("vendor_zh");
    expect(result.display).toContain("XPG CYBERCORE II");
  });

  it("trim:false 时只换厂商前缀，不裁参数", () => {
    const raw = "ADATA XPG CYBERCORE II Black 1300W Fully Modular 80+ Platinum Certified";
    expect(localizeProductName(raw, null, { trim: false }).display).toBe(
      "威刚 XPG CYBERCORE II Black 1300W Fully Modular 80+ Platinum Certified",
    );
  });

  it("显卡与 CPU 目录真实样例", () => {
    expect(localizeProductName("NVIDIA GeForce RTX 4090").display).toBe("英伟达 GeForce RTX 4090");
    expect(localizeProductName("Intel Core i5-14600KF").display).toBe("英特尔 Core i5-14600KF");
    // AMD 中国大陆通用写法就是 AMD，不翻成"超威"
    expect(localizeProductName("AMD Ryzen 7 9800X3D").display).toBe("AMD Ryzen 7 9800X3D");
  });

  it("只有厂商名没有型号时不会留下多余空格", () => {
    expect(localizeProductName("Intel")).toEqual({
      display: "英特尔",
      original: "Intel",
      basis: "vendor_zh",
    });
  });
});

describe("localizeProductName 诚实降级", () => {
  it("认不出的品牌不硬套中文，只裁参数", () => {
    const raw = "1STPLAYER NGDP ATX 3.0 1000W Fully Modular 80+ Platinum Certified";
    const result = localizeProductName(raw);
    expect(result.display).toBe("1STPLAYER NGDP");
    expect(result.original).toBe(raw);
    expect(result.basis).toBe("en_only");
  });

  it("前缀相似但不构成边界的厂商不误命中", () => {
    // "Asus" 不能匹配到 "Asusa"
    const raw = "Asusa RK3399 Board";
    expect(localizeProductName(raw).basis).toBe("en_only");
  });

  it("中文原名保持不变", () => {
    const raw = "微星 MAG B650M MORTAR WIFI";
    expect(localizeProductName(raw)).toEqual({
      display: raw,
      original: raw,
      basis: "already_zh",
    });
  });

  it("空名不产生空白展示", () => {
    expect(localizeProductName("   ").display).toBe("");
  });
});

describe("参数截断不会砍掉型号名", () => {
  // 这三条都是实测踩到的真实裁坏案例，规则放宽后必须仍然安全
  it("Fan 是 PNY 的型号词（Dual Fan / Triple Fan），不能当噪音", () => {
    expect(localizeProductName("PNY Dual Fan GeForce RTX 5060 8GB GDDR7").display).toBe(
      "PNY Dual Fan GeForce RTX 5060",
    );
    expect(localizeProductName("PNY Triple Fan Plus OC GeForce RTX 5070 Ti 16GB GDDR7").display).toBe(
      "PNY Triple Fan Plus OC GeForce RTX 5070 Ti",
    );
  });

  it("Platinum / Gold 是型号词（SK hynix Platinum P41），不是 80+ 认证等级", () => {
    expect(localizeProductName("SK Hynix Platinum P41 500GB M.2 SSD PCIe 4.0 NVMe").display).toBe(
      "SK Hynix Platinum P41",
    );
  });

  it("功率/容量拼在型号代号后面时不截断（LEPA N500 → 不会变成 LEPA N）", () => {
    expect(localizeProductName("LEPA N ATX 500W Non-Modular").display).toBe(
      "LEPA N ATX 500W Non-Modular",
    );
    expect(localizeProductName("GameMax GM ATX 500W Semi-Modular 80+ Bronze Certified").display).toBe(
      "GameMax GM ATX 500W Semi-Modular 80+ Bronze Certified",
    );
  });

  it("代号里带数字的照常截断（BG4 / XLR8 / CS1030 都是完整型号）", () => {
    expect(localizeProductName("KIOXIA BG4 512GB SSD M.2-2230 PCIe 3.0 NVMe").display).toBe(
      "KIOXIA BG4",
    );
    expect(localizeProductName("PNY XLR8 120GB SSD 2.5\" SATA").display).toBe("PNY XLR8");
  });

  it("截断后清理悬空分隔符", () => {
    expect(localizeProductName("NZXT H210i - Mini-ITX PC Gaming Case - Front I/O USB").display).toBe(
      "NZXT H210i",
    );
  });

  it("只有两个 token 时不截断，但厂商中文名照常替换", () => {
    expect(localizeProductName("Intel 4090").display).toBe("英特尔 4090");
  });

  it("RGB 这类 3 字母变体后缀不算断码，仍然截断", () => {
    expect(localizeProductName("G.Skill Trident Z5 RGB 32GB DDR5-6000").display).toBe(
      "芝奇 Trident Z5 RGB",
    );
  });

  it("型号段已有足够信息时，两字母后缀（HS）不算断码", () => {
    // 守卫只看「型号段是否只剩 ≤2 个 token」：M480 带数字且后面还有 HS，
    // 说明型号信息充足，截断是安全的；否则 HS 会被误判成断掉的代号。
    expect(localizeProductName("MSI SPATIUM M480 HS 1TB SSD M.2-2280 PCIe 4.0 X4 NVMe").display).toBe(
      "微星 SPATIUM M480 HS",
    );
  });

  it("分写的数值单位（59.48 CFM）也算规格，会被截掉", () => {
    expect(
      localizeProductName("Jonsbo CR-3000 Standard 59.48 CFM Air 160mm Black / Silver").display,
    ).toBe("乔思伯 CR-3000 Standard");
  });
});

describe("localizeProductName 官网中文名优先", () => {
  it("nameZh 存在且确实是中文时压过厂商前缀", () => {
    const result = localizeProductName(
      "ROG STRIX B850-A GAMING WIFI7 S NEO",
      "ROG STRIX B850-A GAMING WIFI7 S NEO 吹雪",
    );
    expect(result.display).toBe("ROG STRIX B850-A GAMING WIFI7 S NEO 吹雪");
    expect(result.original).toBe("ROG STRIX B850-A GAMING WIFI7 S NEO");
    expect(result.basis).toBe("official_cn");
  });

  it("nameZh 不含中文时拒绝采用（不把英文当中文名）", () => {
    const raw = "ASUS Prime B760-PLUS";
    expect(localizeProductName(raw, "ASUS Prime B760-PLUS")).toEqual({
      display: raw,
      original: raw,
      basis: "en_only",
    });
  });

  it("nameZh 与原名相同且含中文时按 already_zh 记（大陆同步条目原名本身就带中文）", () => {
    const raw = "ROG STRIX B850-I GAMING WiFi7 W迷你吹雪";
    expect(localizeProductName(raw, raw)).toEqual({
      display: raw,
      original: raw,
      basis: "already_zh",
    });
  });

  it("nameZh 为空串等同缺省", () => {
    expect(localizeProductName("ASUS Prime B760-PLUS", "  ").display).toBe("华硕 Prime B760-PLUS");
  });
});

describe("localizeCatalogEntry", () => {
  const entry: CatalogEntry = {
    id: "mb-asus-b850a",
    category: "motherboard",
    name: "ROG STRIX B850-A GAMING WIFI7 S NEO",
    aliases: ["90MB1P40-M0CAY0"],
    spec: { socket: "AM5" },
    nameZh: "ROG STRIX B850-A GAMING WIFI7 S NEO 吹雪",
  };

  it("走条目上的 nameZh", () => {
    expect(localizeCatalogEntry(entry).display).toBe(
      "ROG STRIX B850-A GAMING WIFI7 S NEO 吹雪",
    );
  });

  it("条目无 nameZh 时回退厂商前缀推导", () => {
    expect(localizeCatalogEntry({ name: "ASRock B650M-HDV/M.2" }).display).toBe("华擎 B650M-HDV/M.2");
  });
});

describe("withDisplayNames", () => {
  it("给列表挂上展示字段且不改原数组", () => {
    const entries: CatalogEntry[] = [
      { id: "a", category: "cpu", name: "Intel Core i7-14700K", aliases: [], spec: {} },
      { id: "b", category: "ram", name: "G.Skill Trident Z5 RGB 32GB", aliases: [], spec: {} },
    ];
    const overlay = resolveDisplayNames(entries, (entry) => entry.category);
    expect(overlay[0].displayName).toBe("英特尔 Core i7-14700K");
    expect(overlay[1].displayName).toBe("芝奇 Trident Z5 RGB");
    expect(entries[0]).not.toHaveProperty("displayName");
  });

  it("同类别撞车时回退不截断，跨类别不回退", () => {
    const same = [
      { id: "1", category: "ram", name: "Kingston FURY Beast 6000MT/s 32GB (2x16GB)" },
      { id: "2", category: "ram", name: "Kingston FURY Beast 6000MT/s 16GB (1x16GB)" },
    ];
    const resolved = resolveDisplayNames(same, (e) => e.category);
    expect(resolved[0].displayName).not.toBe(resolved[1].displayName);
    expect(resolved.every((r) => r.displayNameUntrimmed)).toBe(true);
    expect(resolved[0].displayName).toContain("金士顿");

    // 默认分组键就是 category
    const crossCat = resolveDisplayNames([
      { id: "3", category: "ram", name: "ADATA XPG 6000MT/s 32GB" },
      { id: "4", category: "storage", name: "ADATA XPG 6000MT/s 32GB" },
    ]);
    expect(crossCat.every((r) => !r.displayNameUntrimmed)).toBe(true);
  });
});

describe("厂商表自身的一致性", () => {
  it("英文名全部小写且非空", () => {
    for (const rule of VENDOR_NAME_ZH) {
      expect(rule.en).toBe(rule.en.toLowerCase());
      expect(rule.en.length).toBeGreaterThan(0);
      expect(containsChinese(rule.zh)).toBe(true);
    }
  });

  it("英文名不重复", () => {
    const seen = new Set<string>();
    for (const rule of VENDOR_NAME_ZH) {
      expect(seen.has(rule.en)).toBe(false);
      seen.add(rule.en);
    }
  });

  it("不含空厂商项（空串会匹配所有名称）", () => {
    expect(VENDOR_NAME_ZH.some((rule) => rule.en.trim() === "")).toBe(false);
  });
});
