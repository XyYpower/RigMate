import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const tempDir = mkdtempSync(join(tmpdir(), "rigmate-build-service-"));
process.env.RIGMATE_DB_PATH = join(tempDir, "builds.db");

const service = await import("@/application/builds/service");
const { closeDatabase } = await import("@/infra/db/client");

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("装机项目服务（SQLite 持久化）", () => {
  it("创建项目后可以再次读取", () => {
    const build = service.createBuild({ name: "测试主机", useCase: "游戏" });
    const loaded = service.getBuild(build.id);
    expect(loaded?.name).toBe("测试主机");
    expect(loaded?.status).toBe("draft");
  });

  it("添加配件写入数据库并更新状态", () => {
    const build = service.createBuild({ name: "配件主机" });
    service.addBuildItem(build.id, {
      category: "cpu",
      label: "Ryzen 7 7800X3D",
      spec: { socket: "AM5", tdpWatts: 120 },
    });
    const loaded = service.getBuild(build.id);
    expect(loaded?.items).toHaveLength(1);
    expect(loaded?.items[0]?.spec).toEqual({ socket: "AM5", tdpWatts: 120 });
    expect(loaded?.status).toBe("needs_confirmation");
  });

  it("规格缺省时按空对象保存", () => {
    const build = service.createBuild({ name: "缺省规格主机" });
    service.addBuildItem(build.id, { category: "ram", label: "金士顿 16G" });
    const loaded = service.getBuild(build.id);
    expect(loaded?.items[0]?.spec).toEqual({});
  });

  it("非法规格会直接报错", () => {
    const build = service.createBuild({ name: "非法规格主机" });
    expect(() =>
      service.addBuildItem(build.id, {
        category: "ram",
        label: "坏数据",
        spec: { sticks: -1 },
      }),
    ).toThrow();
  });

  it("检查结果落库且项目状态变为已检查", () => {
    const build = service.createBuild({ name: "检查主机" });
    service.addBuildItem(build.id, {
      category: "cpu",
      label: "测试 CPU",
      spec: { socket: "AM5" },
    });
    service.addBuildItem(build.id, {
      category: "motherboard",
      label: "测试主板",
      spec: { socket: "AM5" },
    });
    const { findings } = service.checkBuild(build.id);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.status).toBe("pass");
    expect(service.getBuild(build.id)?.status).toBe("reviewed");
  });

  it("找不到项目时保持原有错误语义", () => {
    expect(() => service.checkBuild("00000000-0000-4000-8000-000000000000")).toThrow(
      "BUILD_NOT_FOUND",
    );
  });

  it("关闭连接后重新打开，数据仍然存在", () => {
    const build = service.createBuild({ name: "重启存活项目" });
    service.addBuildItem(build.id, {
      category: "cooler",
      label: "风冷散热器",
      spec: { supportedSockets: ["AM5", "LGA1700"], heightMm: 158 },
    });

    closeDatabase();

    const reloaded = service.getBuild(build.id);
    expect(reloaded?.name).toBe("重启存活项目");
    expect(reloaded?.items).toHaveLength(1);
    expect(reloaded?.items[0]?.spec).toEqual({
      supportedSockets: ["AM5", "LGA1700"],
      heightMm: 158,
    });
  });

  it("加载最近一次检查：清单未变化时不标记过期", () => {
    const build = service.createBuild({ name: "结果恢复主机" });
    service.addBuildItem(build.id, { category: "cpu", label: "CPU", spec: { socket: "AM5" } });
    service.addBuildItem(build.id, {
      category: "motherboard",
      label: "MB",
      spec: { socket: "AM5" },
    });
    service.checkBuild(build.id);

    const latest = service.getLatestCheck(build.id);
    expect(latest).not.toBeNull();
    expect(latest?.stale).toBe(false);
    expect(latest?.findings).toHaveLength(1);
    expect(latest?.findings[0]?.status).toBe("pass");
  });

  it("检查后新增配件会标记旧结果过期", () => {
    const build = service.createBuild({ name: "过期主机" });
    service.addBuildItem(build.id, { category: "cpu", label: "CPU", spec: { socket: "AM5" } });
    service.checkBuild(build.id);
    service.addBuildItem(build.id, { category: "ram", label: "内存", spec: { ddrType: "DDR5" } });

    const latest = service.getLatestCheck(build.id);
    expect(latest?.stale).toBe(true);
  });

  it("删除项目会连同配件和检查记录一起删除", () => {
    const build = service.createBuild({ name: "待删除主机" });
    service.addBuildItem(build.id, { category: "cpu", label: "CPU", spec: { socket: "AM5" } });
    service.checkBuild(build.id);

    service.deleteBuild(build.id);

    expect(service.getBuild(build.id)).toBeUndefined();
    expect(() => service.getLatestCheck(build.id)).toThrow("BUILD_NOT_FOUND");
  });

  it("配件价格持久化且预算汇总随响应附带", () => {
    const build = service.createBuild({ name: "预算主机", budgetCents: 800_00 });
    service.addBuildItem(build.id, {
      category: "cpu",
      label: "CPU",
      spec: { socket: "AM5" },
      priceCents: 200_00,
    });
    service.addBuildItem(build.id, { category: "case", label: "机箱" });

    const loaded = service.getBuild(build.id);
    expect(loaded?.items[0]?.priceCents).toBe(200_00);
    expect(loaded?.budgetSummary).toEqual({
      budgetCents: 800_00,
      pricedTotalCents: 200_00,
      pricedCount: 1,
      unpricedCount: 1,
      unpricedLabels: ["机箱"],
      differenceCents: 600_00,
    });
  });

  it("关闭连接后重新打开，价格字段仍然存在", () => {
    const build = service.createBuild({ name: "价格重启项目" });
    service.addBuildItem(build.id, { category: "psu", label: "电源", priceCents: 75_00 });

    closeDatabase();

    const reloaded = service.getBuild(build.id);
    expect(reloaded?.items[0]?.priceCents).toBe(75_00);
  });
});
