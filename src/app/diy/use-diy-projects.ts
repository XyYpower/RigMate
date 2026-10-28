"use client";

import { useEffect, useMemo, useState } from "react";
import {
  buildSpecPayload,
  CATEGORY_META,
  specToFormValues,
} from "@/ui/category-form";
import type { Finding, FindingStatus } from "@/domain/build/types";
import type { CheckRunSummary } from "@/infra/db/repositories/build-repository";
import {
  EMPTY_DRAFT,
  latestFirst,
  type Build,
  type CatalogEntry,
  type CatalogProvenance,
  type Category,
  type CategoryDraft,
  type Item,
} from "./types";

/**
 * 高级 DIY 的全部状态与动作（自 page.tsx 原样抽出，行为不变）：
 * 项目切换/新建/删除、配件增改删、检查运行与历史、目录检索缓存。
 * 状态所有权集中在此 hook，区块组件只读 + 回调。
 */
export function useDiyProjects() {
  const [build, setBuild] = useState<Build | null>(null);
  const [projects, setProjects] = useState<Build[]>([]);
  const [name, setName] = useState("我的第一台 DIY 主机");
  const [useCase, setUseCase] = useState("2K 游戏");
  const [budgetYuan, setBudgetYuan] = useState("");
  const [itemCategory, setItemCategory] = useState<Category>("cpu");
  const [drafts, setDrafts] = useState<Record<string, CategoryDraft>>({});
  const [findings, setFindings] = useState<Finding[]>([]);
  const [resultMeta, setResultMeta] = useState<{ time: string; stale: boolean } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [confirmItemId, setConfirmItemId] = useState<string | null>(null);
  const [catalogByCategory, setCatalogByCategory] = useState<Record<string, CatalogEntry[]>>({});
  const [catalogProvenance, setCatalogProvenance] = useState<CatalogProvenance | null>(null);
  const [message, setMessage] = useState("正在加载你的历史项目…");
  const [busy, setBusy] = useState(false);
  const [checkHistory, setCheckHistory] = useState<CheckRunSummary[]>([]);
  // 价格快填模式：清单行内直接填价，一次批量保存（省去逐件走编辑表单）
  const [quickPriceMode, setQuickPriceMode] = useState(false);
  const [quickPrices, setQuickPrices] = useState<Record<string, string>>({});

  function loadCheckHistory(buildId: string) {
    void fetch(`/api/builds/${buildId}/check/history`)
      .then(async (response) => {
        if (!response.ok) return;
        const data = await response.json();
        setCheckHistory(data.runs ?? []);
      })
      .catch(() => undefined);
  }

  const meta = CATEGORY_META[itemCategory];
  const draft = drafts[itemCategory] ?? EMPTY_DRAFT;
  const fieldValues = draft.fields;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/builds");
        if (!response.ok) return;
        const data = await response.json();
        if (cancelled) return;
        const builds: Build[] = latestFirst(data.builds ?? []);
        setProjects(builds);
        // 方案库「打开」带 ?project=id 直达指定项目；无参数则恢复最近项目
        const requestedId = new URLSearchParams(window.location.search).get("project");
        const requested = requestedId ? builds.find((b) => b.id === requestedId) : undefined;
        const latest = requested ?? builds[0];
        if (latest) {
          setBuild(latest);
          loadCheckHistory(latest.id);
          setMessage(
            requested
              ? `已从方案库打开「${latest.name}」，共 ${latest.items.length} 个配件。`
              : `已恢复最近的项目「${latest.name}」，共 ${latest.items.length} 个配件。历史项目可在上方切换。`,
          );
          const checkResponse = await fetch(`/api/builds/${latest.id}/check`);
          if (cancelled) return;
          if (checkResponse.ok) {
            const checkData = await checkResponse.json();
            if (checkData.check) {
              setFindings(checkData.check.findings);
              setResultMeta({
                time: new Date(checkData.check.createdAt).toLocaleString(),
                stale: Boolean(checkData.check.stale),
              });
            }
          }
        } else {
          setMessage("还没有历史项目。先创建一个项目，数据会实时保存到数据库。");
        }
      } catch {
        if (!cancelled) setMessage("无法连接服务，请确认开发服务器正在运行。");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (catalogByCategory[itemCategory]) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/catalog?category=${itemCategory}`);
        if (!response.ok) return;
        const data = await response.json();
        if (!cancelled) {
          setCatalogByCategory((prev) => ({ ...prev, [itemCategory]: data.entries ?? [] }));
          if (data.provenance) setCatalogProvenance(data.provenance);
        }
      } catch {
        /* 目录加载失败不阻塞手填 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [itemCategory, catalogByCategory]);

  // 目录规模 = 人工种子 + BuildCores 导入（万级）：下拉默认只给前 30 条，
  // 输入关键词改走 q 检索，否则具体型号无法触达
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogSearchResults, setCatalogSearchResults] = useState<CatalogEntry[]>([]);
  useEffect(() => {
    const query = catalogSearch.trim();
    // 空关键词不请求：catalogOptions 直接回落到类别缓存（种子 + 未检索的前 30 条）
    if (!query) return;
    let cancelled = false;
    const handle = setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch(
            `/api/catalog?category=${itemCategory}&q=${encodeURIComponent(query)}`,
          );
          if (!response.ok) return;
          const data = await response.json();
          if (!cancelled) {
            setCatalogSearchResults(data.entries ?? []);
            if (data.provenance) setCatalogProvenance(data.provenance);
          }
        } catch {
          /* 检索失败保持上次结果 */
        }
      })();
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [itemCategory, catalogSearch]);
  const catalogOptions = catalogSearch.trim() ? catalogSearchResults : catalogByCategory[itemCategory] ?? [];

  const counts = useMemo(() => {
    const result: Record<FindingStatus, number> = {
      pass: 0,
      block: 0,
      warn: 0,
      unknown: 0,
      not_applicable: 0,
    };
    for (const finding of findings) result[finding.status] += 1;
    return result;
  }, [findings]);

  // 渐进披露（M32）：有问题时通过项折叠成一行；全部通过时照常展开（干净结果不需要藏）
  const problemFindings = useMemo(
    () => findings.filter((finding) => finding.status !== "pass"),
    [findings],
  );
  const passedFindings = useMemo(
    () => findings.filter((finding) => finding.status === "pass"),
    [findings],
  );
  const collapsePasses = problemFindings.length > 0 && passedFindings.length > 0;

  function switchProject(id: string) {
    const target = projects.find((project) => project.id === id);
    if (!target || target.id === build?.id) return;
    setBuild(target);
    loadCheckHistory(target.id);
    setFindings([]);
    setResultMeta(null);
    setConfirmDelete(false);
    setEditingItemId(null);
    setConfirmItemId(null);
    setMessage(`已切换到项目「${target.name}」，共 ${target.items.length} 个配件。`);
    void (async () => {
      const response = await fetch(`/api/builds/${target.id}/check`);
      if (!response.ok) return;
      const data = await response.json();
      if (data.check) {
        setFindings(data.check.findings);
        setResultMeta({
          time: new Date(data.check.createdAt).toLocaleString(),
          stale: Boolean(data.check.stale),
        });
      }
    })();
  }

  async function deleteProject() {
    if (!build) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      setMessage("再点一次「确认删除」就会连同配件和检查记录一起删除。");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/builds/${build.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("删除失败");
      const remaining = latestFirst(projects.filter((project) => project.id !== build.id));
      setProjects(remaining);
      setBuild(remaining[0] ?? null);
      setFindings([]);
      setResultMeta(null);
      setConfirmDelete(false);
      setEditingItemId(null);
      setConfirmItemId(null);
      setMessage(
        remaining[0]
          ? `项目已删除。已切换到「${remaining[0].name}」。`
          : "项目已删除。当前没有其他项目。",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除失败");
    } finally {
      setBusy(false);
    }
  }

  async function createProject() {
    const budgetRaw = budgetYuan.trim();
    let budgetCents: number | undefined;
    if (budgetRaw) {
      const yuan = Number(budgetRaw);
      if (!Number.isFinite(yuan) || yuan <= 0) {
        setMessage("预算需要是大于 0 的数字（单位：元）。");
        return;
      }
      budgetCents = Math.round(yuan * 100);
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/builds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, useCase, budgetCents }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "创建失败");
      const created: Build = data.build;
      setBuild(created);
      setProjects((prev) => latestFirst([created, ...prev]));
      setFindings([]);
      setResultMeta(null);
      setConfirmDelete(false);
      setEditingItemId(null);
      setConfirmItemId(null);
      setMessage(`新项目「${created.name}」已创建并保存。旧项目仍在历史列表里，随时可以切回。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "创建失败");
    } finally {
      setBusy(false);
    }
  }

  function parsePriceInput(): { priceCents: number | undefined; error: string | null } {
    const raw = draft.price.trim();
    if (!raw) return { priceCents: undefined, error: null };
    const yuan = Number(raw);
    if (!Number.isFinite(yuan) || yuan <= 0) {
      return { priceCents: undefined, error: "价格需要是大于 0 的数字（单位：元）。" };
    }
    return { priceCents: Math.round(yuan * 100), error: null };
  }

  async function addItem() {
    if (!build) return;
    const { spec, error } = buildSpecPayload(meta, draft.fields);
    if (error) {
      setMessage(error);
      return;
    }
    const price = parsePriceInput();
    if (price.error) {
      setMessage(price.error);
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/builds/${build.id}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: itemCategory,
          label: draft.label,
          spec,
          priceCents: price.priceCents,
          source: draft.catalogId ? `catalog:${draft.catalogId}` : undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "添加失败");
      const updated: Build = data.build;
      setBuild(updated);
      setProjects((prev) => prev.map((project) => (project.id === updated.id ? updated : project)));
      setDrafts((prev) => ({ ...prev, [itemCategory]: EMPTY_DRAFT }));
      if (findings.length > 0) {
        setResultMeta((prev) => (prev ? { ...prev, stale: true } : prev));
      }
      setMessage(`${meta.label} 已加入清单并保存。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "添加失败");
    } finally {
      setBusy(false);
    }
  }

  function startEdit(item: Item) {
    setItemCategory(item.category);
    setDrafts((prev) => ({
      ...prev,
      [item.category]: {
        label: item.label,
        price: typeof item.priceCents === "number" ? String(item.priceCents / 100) : "",
        catalogId: item.source?.startsWith("catalog:") ? item.source.slice("catalog:".length) : undefined,
        fields: specToFormValues(CATEGORY_META[item.category], item.spec ?? {}),
      },
    }));
    setEditingItemId(item.id);
    setConfirmItemId(null);
    setMessage(`正在编辑「${item.label}」：改完点「保存修改」，或点「取消编辑」。`);
  }

  function cancelEdit() {
    if (!editingItemId) return;
    setDrafts((prev) => ({ ...prev, [itemCategory]: EMPTY_DRAFT }));
    setEditingItemId(null);
    setMessage("已取消编辑。");
  }

  async function saveItem() {
    if (!build || !editingItemId) return;
    const { spec, error } = buildSpecPayload(meta, draft.fields);
    if (error) {
      setMessage(error);
      return;
    }
    const price = parsePriceInput();
    if (price.error) {
      setMessage(price.error);
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/builds/${build.id}/items/${editingItemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: draft.label, spec, priceCents: price.priceCents }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "保存失败");
      const updated: Build = data.build;
      setBuild(updated);
      setProjects((prev) => prev.map((project) => (project.id === updated.id ? updated : project)));
      setDrafts((prev) => ({ ...prev, [itemCategory]: EMPTY_DRAFT }));
      setEditingItemId(null);
      if (findings.length > 0) {
        setResultMeta((prev) => (prev ? { ...prev, stale: true } : prev));
      }
      setMessage(`「${draft.label}」的修改已保存。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function removeItem(itemId: string) {
    if (!build) return;
    if (confirmItemId !== itemId) {
      setConfirmItemId(itemId);
      setMessage("再点一次「确认删」会删除这个配件（项目保留）。");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/builds/${build.id}/items/${itemId}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "删除失败");
      const updated: Build = data.build;
      setBuild(updated);
      setProjects((prev) => prev.map((project) => (project.id === updated.id ? updated : project)));
      setConfirmItemId(null);
      if (editingItemId === itemId) {
        setEditingItemId(null);
        setDrafts((prev) => ({ ...prev, [itemCategory]: EMPTY_DRAFT }));
      }
      if (findings.length > 0) {
        setResultMeta((prev) => (prev ? { ...prev, stale: true } : prev));
      }
      setMessage("配件已删除，项目保留。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除失败");
    } finally {
      setBusy(false);
    }
  }

  function toggleQuickPriceMode() {
    if (!quickPriceMode) {
      const initial: Record<string, string> = {};
      for (const item of build?.items ?? []) {
        initial[item.id] = typeof item.priceCents === "number" ? String(item.priceCents / 100) : "";
      }
      setQuickPrices(initial);
    }
    setQuickPriceMode((prev) => !prev);
  }

  function setQuickPrice(itemId: string, value: string) {
    setQuickPrices((prev) => ({ ...prev, [itemId]: value }));
  }

  async function saveQuickPrices() {
    if (!build) return;
    const updates = build.items
      .map((item) => ({ item, raw: (quickPrices[item.id] ?? "").trim() }))
      .filter(({ item, raw }) => {
        if (raw === "") return false; // 快填只填/改价，不支持清价（空行跳过）
        const yuan = Number(raw);
        if (!Number.isFinite(yuan) || yuan <= 0) return false;
        return Math.round(yuan * 100) !== item.priceCents;
      });
    if (updates.length === 0) {
      setQuickPriceMode(false);
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      let latest: Build | null = build;
      for (const { item, raw } of updates) {
        const response = await fetch(`/api/builds/${build.id}/items/${item.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label: item.label, spec: item.spec ?? {}, priceCents: Math.round(Number(raw) * 100) }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? `保存「${item.label}」价格失败`);
        latest = data.build;
      }
      if (latest) {
        setBuild(latest);
        setProjects((prev) => prev.map((project) => (project.id === latest!.id ? latest! : project)));
      }
      setQuickPriceMode(false);
      setMessage(`已保存 ${updates.length} 件价格，检查结论已标记待更新，建议重新检查。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存价格失败");
    } finally {
      setBusy(false);
    }
  }

  /** 复制待录清单（粘贴格式）：没价格的件生成「类别 型号」行，用户查价后可直接粘进证据台账批量录入 */
  function copyPendingPriceList() {
    if (!build) return;
    const lines = build.items
      .filter((item) => typeof item.priceCents !== "number")
      .map((item) => `${item.category} ${item.displayName ?? item.label}`);
    if (lines.length === 0) {
      setMessage("清单里所有配件都已有价格。");
      return;
    }
    void navigator.clipboard.writeText(lines.join("\n")).then(() => {
      setMessage(`已复制 ${lines.length} 行待录清单（无价格）。查好价后在行尾补上数字，即可粘进证据台账批量录入。`);
    });
  }

  async function runCheck() {
    if (!build) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/builds/${build.id}/check`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "检查失败");
      const updated: Build = data.build;
      setBuild(updated);
      setProjects((prev) => prev.map((project) => (project.id === updated.id ? updated : project)));
      setFindings(data.findings);
      setResultMeta({ time: "刚刚更新", stale: false });
      loadCheckHistory(updated.id);
      setMessage(
        data.findings.some((finding: Finding) => finding.status === "block")
          ? "检查完成：存在阻断问题，请先处理。"
          : "检查完成，结果已保存。",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "检查失败");
    } finally {
      setBusy(false);
    }
  }

  function exitEditOnCategorySwitch() {
    if (editingItemId) {
      setEditingItemId(null);
      setDrafts((prev) => ({ ...prev, [itemCategory]: EMPTY_DRAFT }));
      setMessage("已退出编辑（切换了类别）。");
    }
  }

  return {
    // 状态
    build, projects, name, useCase, budgetYuan, itemCategory, drafts, draft, fieldValues,
    meta, findings, resultMeta, confirmDelete, editingItemId, confirmItemId,
    catalogSearch, catalogOptions, catalogProvenance, message, busy, checkHistory,
    counts, problemFindings, passedFindings, collapsePasses,
    // 动作
    setName, setUseCase, setBudgetYuan, setItemCategory, setDrafts, setCatalogSearch,
    switchProject, deleteProject, createProject, addItem, startEdit, cancelEdit,
    saveItem, removeItem, runCheck, exitEditOnCategorySwitch,
    quickPriceMode, quickPrices, toggleQuickPriceMode, setQuickPrice, saveQuickPrices, copyPendingPriceList,
  };
}

export type DiyWorkspace = ReturnType<typeof useDiyProjects>;
