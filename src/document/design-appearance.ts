/**
 * ═══════════════════════════════════════════════════════════════════════
 * DesignAppearance —— 外观契约（配色与描边）
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 版式契约（`design-sketch.ts`）回答「什么在哪、多大」；
 * 这份回答「它长什么样、是什么颜色」。
 *
 * ## 为什么分开
 *
 * | | 版式 | 外观 |
 * |---|---|---|
 * | 管什么 | 位置、尺寸、字号、层级、重复 | 颜色、描边、用哪套皮 |
 * | 草图要不要 | **要**（草图就是版式蓝图）| **不要**（草图是灰阶的）|
 * | 谁最常改 | 调构图时 | 换配色/换风格时 |
 *
 * 实测教训：模型在产版式**时被问到了配色**，于是编造出 `cold-dusk`、
 * `noir-amber` 这种不存在的名字——**它本来就不该在这一步被问**。
 *
 * ## 为什么不重复几何
 *
 * 外观**按图层 id 索引**，只写"这一层的颜色是什么"：
 *
 * ```jsonc
 * {
 *   "palette": "warm-copper",
 *   "layers": {
 *     "paper":     { "fill": "#F5F1EA" },
 *     "card-bg":   { "fill": "#FFFFFF", "stroke": { "color": "#B8722F", "width": 3 } },
 *     "card-label":{ "color": "ink" }
 *   }
 * }
 * ```
 *
 * 没有 id 的图层 = 该层没有额外外观，全部走默认（配色的角色值 / 渲染器兜底）。
 *
 * ## 关于 `repeat`
 *
 * 展开出的第 2..N 份**继承模板的外观**——外观在原 id 上写一次就够，
 * 不用为 `card-bg-2` / `card-bg-3` 各写一遍。
 * （实现上：**先合并外观、再展开 repeat**。）
 */

// ══════════════════════════════════════════════════════════════════════
// 单层外观
// ══════════════════════════════════════════════════════════════════════

/**
 * 一个图层的外观覆盖。
 *
 * ⚠️ 只放**不影响位置与尺寸**的字段。判断标准很简单：
 * 改它会不会让别的东西挪位置？会 → 那属于版式，不该在这儿。
 * （所以 `fontScale` 不在这里——字号决定文字块占多大。）
 */
export interface LayerAppearance {
  // ── 颜色 ──

  /** 填充色（`rect`） */
  fill?: string;
  /** 文字 / 线条 / 图标的主色（`subtext` / `line` / `icon`） */
  color?: string;
  /**
   * `subtext` 的自定义色，仅当 `color: "custom"` 时生效。
   *
   * ⚠️ 这个「开关 + 值」两字段的写法是历史遗留，用起来别扭（要写两次）。
   * 视图层已支持直接给 `color` 一个色值或角色名；等现有版式统一后再收掉它。
   */
  customColor?: string;
  /** `badge` 的标签文字色 */
  textColor?: string;
  /** `badge` 的图标色 */
  iconColor?: string;
  /** `badgeBar` 的底色（也接受 CSS 渐变） */
  background?: string;

  // ── 描边与边框（粗细不影响布局，只是"画多粗的边"）──

  /** 通用描边（沿图层盒子向内） */
  stroke?: { color: string; width: number };
  /** `circleInset` 的圆环 */
  ring?: { color?: string; width?: number };
  /** `inset` 的斜边线 */
  edgeLine?: { color?: string; width?: number };
  /** `splitBackground` 的分割线高光 */
  edgeHighlight?: { color?: string; width?: number };

  /**
   * 圆角：**相对盒子短边**的比例（0–1），与 `ShapeNode.radius` 同语义。
   *
   * 主要给 **image** 用——实测教训：`border-radius` 在容器上只裁自身背景，
   * 不裁子元素；而照片常与圆角描边框是**兄弟图层**（框在上、图在下），
   * 方角照片会从圆角框的角上露出来。给图配与框相同的 radius，两层对齐。
   */
  radius?: number;

  /**
   * 句中强调：把文字里的指定词渲染成另一种颜色（标题关键词高亮）。
   * 词按**原文精确匹配**（区分大小写）；未匹配到的部分用节点主色。
   *
   * ⚠️ 放在外观而不是版式：哪些词高亮是「长什么样」的设计决策，
   * 不影响文字占多大。渲染时逐段 escape，词里的特殊字符安全。
   */
  /**
   * 强调组(旧版单组,兼容保留——编辑器读写用 accents)
   */
  accent?: { words: string[]; color: string };

  /**
   * 多组强调:每组 = 词列表 + 颜色,渲染时按词匹配染色(同词多组时先组优先)。
   * 支持「一个标题 4-5 个颜色」——每组在图上是一个可点击的染色片段,
   * 编辑器单行颜色跟随点击的片段切换。
   */
  accents?: Array<{ words: string[]; color: string }>;

  /**
   * 本节点的字体族（须已包含在字体方案的 `faces` 里，否则没被内联、退回系统字体）。
   *
   * 存在的理由：渲染器 `.sub` 默认全用标题字体——标题与标签同族是「样式单调」
   * 的机制根源；标签/注记换一族（如圆体），层级立刻拉开。不改布局，归外观。
   */
  fontFamily?: string;

  /**
   * 图层透明度（0–1）。作用在**节点容器**上——整层含描边/底衬一起淡出；
   * 想只让文字色半透明而底板不透明，用 color 的 8 位 hex（#RRGGBBAA），两者语义不同。
   */
  opacity?: number;
}

// ══════════════════════════════════════════════════════════════════════
// 顶层
// ══════════════════════════════════════════════════════════════════════

export interface DesignAppearance {
  /**
   * 用哪套配色：
   * - **字符串** → 引用 `designassets/elements/palette/<名>.json`（资产库沉淀方案）
   * - **对象** → 内嵌的专属配色（角色名 → 色值），由外观编译步骤按产品自动生成，
   *   跟随本外观文件走、不进资产库——好用的由人再提升进库
   * 省略则用渲染器兜底（`render-style.ts` 里的 PALETTE）。
   */
  palette?: string | Record<string, string>;
  /**
   * 用哪套排版，对应 `designassets/fonts/schemes/<名>.json`。
   * 省略则用系统字体兜底。
   */
  fontScheme?: string;
  /** 各图层的外观覆盖：`{ '<图层id>': { … } }` */
  layers?: Record<string, LayerAppearance>;
}

/** 所有外观字段名（供校验器检查"有没有写错字段名"） */
export const APPEARANCE_KEYS = [
  'fill',
  'color',
  'customColor',
  'textColor',
  'iconColor',
  'background',
  'radius',
  'accent',
  'accents',
  'fontFamily',
  'opacity',
  'stroke',
  'ring',
  'edgeLine',
  'edgeHighlight',
] as const;

/**
 * 把外观合并进图层树。
 *
 * 按 id 匹配（组内图层同样处理），**在创建副本上进行，不改原对象**。
 *
 * ⚠️ 调用顺序很重要：**先合并外观、再展开 `repeat`**。
 * 反过来的话，展开出的副本 id 带了 `-2` / `-3` 后缀，就匹配不上外观表了。
 */
export function applyAppearance<T extends { id: string; children?: unknown[] }>(
  layers: T[],
  appearance: DesignAppearance | undefined,
): T[] {
  const table = appearance?.layers;
  if (!table) return layers;
  return layers.map((l) => {
    const patch = table[l.id];
    const kids = Array.isArray(l.children)
      ? applyAppearance(l.children as { id: string; children?: unknown[] }[], appearance)
      : undefined;
    const merged = { ...l, ...(patch ?? {}) } as T;
    if (kids) (merged as { children?: unknown[] }).children = kids;
    return merged;
  });
}
