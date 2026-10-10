/**
 * 图层可视性 —— **编辑器视角态，不是版式数据**。
 *
 * 为什么单独一个模块（而不是塞进 `mergePatch`）：
 *
 * 1. 这层状态**绝不能进 spec/appearance**。编辑器有 1.5s 防抖**自动保存**
 *    （`App.handleLayerPatch` → `scheduleAutoSave`），字段一旦 merge 进 `spec`，
 *    用户什么都没按也会在 1.5 秒后被写进 `design-sketch.json`，
 *    接着 `render.ts` 就可能把它当版式数据渲染进成品图。
 *    → 不写进 spec 是**结构性保证**：渲染器连它的存在都不知道，不存在"忘了过滤"。
 * 2. 它是**纯集合运算**，没有 React 依赖 —— 所以能脱离浏览器穷举验证
 *    （见 `scripts/_probe-layer-visibility.ts`）。
 */

/**
 * 切换一个图层的可视性，返回新的隐藏集合。
 *
 * - 普通点击：翻转该图层（集合的普通增删）
 * - **Alt+点击（独奏）**：只留这一个可见，其余全藏
 * - 独奏态下再 Alt+点同一个 → **还原全显示**（这样独奏是一次可逆的开关，
 *   不用记"我原来藏了哪几个"）
 *
 * @param prev   当前隐藏集合
 * @param id     被点击的图层
 * @param solo   是否独奏（Alt 键）
 * @param allIds 当前版式的全部图层 id（独奏要知道"其余"是谁）
 */
export function toggleHidden(
  prev: ReadonlySet<string>,
  id: string,
  solo: boolean,
  allIds: readonly string[],
): Set<string> {
  if (!solo) {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  }

  // 独奏：目标 = 除 id 外全隐藏
  const soloSet = new Set(allIds.filter((x) => x !== id));
  // 已经在独奏这一个 → 再点即还原（含"本来一个都没藏"的情况：也算已还原）
  if (sameSet(prev, soloSet)) return new Set();
  return soloSet;
}

/** 两个集合是否相等（元素相同，与顺序无关） */
function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}
