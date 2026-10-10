/**
 * 检查结果驱动的换件提示词 swap-v1（next-phase：检查 → 模型换件 → 再检查 有限迭代）。
 *
 * 只做"单件替换"决策：给出阻断/警告发现与候选池，模型从池内选一个更合适的替换件。
 * 版本化纪律与 selection-v1 相同：不允许原地修改，只能新增 swap-v2。
 */

export const SWAP_PROMPT_VERSION = "swap-v1";

export const SWAP_SYSTEM_PROMPT = `你是装机方案的换件顾问。给你一套方案的部分兼容检查发现（可能有阻断或警告）、当前被点名的部件和候选池。你的任务：从候选池中为被点名的类别挑选一个能解决或缓解问题、且不引入新问题的替换件（catalogId 必须原样照抄）。优先选择与平台匹配、缺失字段少、已审核价格合理的候选。如果池内没有更合适的候选，输出空 selections。只输出 JSON：{"selections":[{"category":"被点名的类别","catalogId":"候选 ID","reason":"一句替换理由（引用发现与候选规格）"}]}，最多 1 条。`;
