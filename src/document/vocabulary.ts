/**
 * 文档词汇表 —— 画布 / 元素 / 效果 / 矢量 / 分组
 *
 * 对象：画布 / text / image / svg / group。
 *
 * ⚠️ 我多留了两个（`id` / `rect`）—— 没有它们，"一个元素"就不成立。
 *
 * ══════════════════════════════════════════════════════════════════════
 * ⭐ 改任何字段之前，先读 `README.md`（同目录）的两张表
 * ══════════════════════════════════════════════════════════════════════
 *
 * ## ① 分母表 —— 每个 0–1 是"谁的 0–1"。**分母不止一个！**
 *
 * ```
 *   rect.x / rect.w    ÷ 画布宽         （0.06 × 900 = 54px）
 *   fontScale          ÷ 画布宽         （0.028 × 900 = 25px）
 *   polygon.points     ÷ 它自己的盒子    （0.5 × 盒宽 —— 不是画布！）
 *   path.d             ÷ 它自己的盒子
 *   radius             ÷ 盒子短边
 *   shadow.offset/blur ÷ 盒子短边
 *   letterSpacing      ÷ 字号（em）
 *   lineHeight         ÷ 字号（倍数）
 * ```
 *
 * ## ② 三个层次 —— 那个乘法在哪一层发生
 *
 * ```
 *   ① 设计层   比例 → px         渲染器算（emit.ts 的 boxOf / textFontSize）
 *   ② 排版层   em / 倍数 / %      **Blink 排版时算** —— 我们不写代码
 *   ③ 显示层   画布 px → 屏幕 px   Blink 合成时算（wrapper 的 transform:scale）
 * ```
 *
 * ## ⭐ 判据：CSS / SVG 有没有现成的相对单位能表达它？
 *
 * - **有**（`em` / `%` / 无单位倍数）⇒ 原样写进去，**交给 Blink**，绝不自己乘
 *   ⇒ 所以 `letterSpacing` / `baselineShift` **永远不该存 px**
 *   （`em` 是免费解析的；改成 px 反而要在"改字号"时回头重算 —— 白白丢一份能力）
 * - **没有**（"相对画布宽"、"相对盒子短边"这些 CSS 里**不存在**）⇒ 只能自己乘
 *   ⇒ 那就只乘一次：
 *     · 分母**恒定**的（`rect` / `fontSize`，分母是画布）⇒ ✅ **可以存 px**
 *     · 分母**会被用户拖**的（`points` / `radius` / `shadow.*`）⇒ ❌ 必须留比例
 *
 * ⇒ 一条原则：**不自己实现相对性；能用现成的相对单位，就绝不自己乘。**
 */

// ══ 画布 ══════════════════════════════════════════════
export interface Canvas {
  width: number;
  height: number;

  /**
   * **画布底色** —— 值 = 一个 CSS「背景」值，和元素的 `fill` **同一个值空间**
   * （纯色 / 渐变 / 图案 / 多层叠）。
   *
   * ⚠️ **省略 = 白底**（`#FFFFFF`）。这是个**安全的默认**：交付出去的 PNG 不带 alpha，
   *    下游不管合成到什么底色上都不会变样。
   *
   * ⚠️ 要**透明**必须**显式写** `'transparent'`（CSS 合法值，原样透传）。
   *    但先想清楚：**带 alpha 的 PNG 交给 Amazon，合成底色不由你控制**
   *    （有的环节会合到黑底上）。而且透明只在 PNG 下有意义（JPEG 不支持 alpha）。
   */
  background?: string | string[];
}

// ══ 文档 ══════════════════════════════════════════════
/**
 * ## ⭐ 文档的结构（2026-10-16 定）
 *
 * ```
 * 画布
 * └─ 图层（画布的孩子 —— "又叠加的一张画布"）
 *     └─ 元素（图层的孩子）
 *         ├─ 叶子元素：矩形 / 椭圆 / 多边形 / 路径 / 文字 / 图片 / 图标
 *         └─ 组（元素里特殊的一类）
 *             └─ 组内元素（组的孩子，还能再是组）
 * ```
 *
 * ⚠️ **图层和元素是父子，不是平级**：图层是画布的孩子，元素是图层的孩子。
 *    （这条是用户 2026-10-16 明确的；此前这里是一个扁平的 `Layer[]`，
 *     矩形/文字/图片/组全混在画布下面 —— 那表达不了上面这个三层结构。）
 *
 * ⚠️ **图层永远和画布一样大**，而且**没有底色**（用户 2026-10-16 定）—— 所以 `Layer` 既没有
 *    `rect` 也没有 `background`。
 *    「又叠加的一张画布」= 一个**透明的合成面**：跟主画布一样大、能整体做效果，
 *    但**底色归画布**（`Canvas.background`），图层本身不画任何东西。
 *    ⇒ **元素坐标永远是画布坐标**，不存在"层内坐标"这回事，编辑器也就不需要任何坐标换算。
 *    ⚠️ 这两个字段都曾经有过：`rect`（让图层是个更小的盒子、元素用层内坐标）删掉了 ——
 *      渲染支持而编辑器（手势/选中框/顶点）完全没跟上，是个"渲染对、编辑器错"的静默陷阱；
 *      `background`（图层自己的底色）也删掉了 —— 那会把图层变成"卡片模型"，不是图层。
 *      将来真要做"局部画板 / 卡片"，**必须连编辑器一起做**，而且要另立类型。
 */
export interface DesignDocument {
  canvas: Canvas;
  /** **图层**列表（不是元素列表！）：数组顺序即叠放顺序（先写的在下面） */
  layers: Layer[];
}

// ══ 元素 ══════════════════════════════════════════════

/**
 * **位置尺寸** —— 单位是**画布 px**（不是比例！）。
 *
 * `x` / `y` 是相对画布**左上角**的偏移，`w` / `h` 是自身宽高。
 * 例：`{ x: 54, y: 72, w: 360, h: 432 }`。
 *
 * ## 为什么这里用 px，而别的字段还是比例
 *
 * 判据是**那个乘法在哪一层发生**（见文件头的三个层次）：
 *
 * | | 分母 | CSS 有现成的相对单位吗 | 结论 |
 * |---|---|---|---|
 * | **`rect`** | 画布 | ❌ 没有"相对画布宽"这种写法 | ⇒ 只能自己乘 ⇒ **改 px，只乘一次** |
 * | `polygon.points` | 它自己的盒子 | ❌ 没有 | ⚠️ 但分母**会被用户拖** ⇒ 必须留比例 |
 * | `fontSize` | 画布宽 | ❌ 没有 | ⇒ 改 px |
 * | `letterSpacing` | 字号 | ✅ `em` | ⇒ **留比例，交给 Blink** |
 *
 * 一句话：**分母恒定（画布）⇒ 可以落精确 px；分母会被编辑改动 ⇒ 留比例。**
 *
 * ⚠️ 所以**别再对 `rect` 做"× 画布宽"的换算** —— 它已经换好了。
 *    （编辑器曾经在这里来回乘除，除完还有 4 位小数的精度损失：900 宽画布上 0.09px/次。）
 */
export interface Rect {
  /** 左边缘（画布 px） */
  x: number;
  /** 上边缘（画布 px） */
  y: number;
  /** 宽（画布 px） */
  w: number;
  /** 高（画布 px） */
  h: number;
}

/**
 * **视觉变换** —— 只作用于最终画面，**不参与任何布局计算**。整块可省 = 不变换。
 *
 * ## ⭐ 这里只留「`rect` 做不到的」
 *
 * `rect` 是一个**矩形**（位置 + 尺寸），所以它**已经能表达**：
 *
 * | 想做什么 | 用 `rect` |
 * |---|---|
 * | **平移** | 改 `x` / `y` |
 * | **等比缩放** | 改 `w` / `h` —— 而且文字会**重新排版 → 清晰** |
 *
 * `rect` **做不到**的只有三件：
 *
 * | 做不到 | 只能靠 |
 * |---|---|
 * | **旋转** | `rotate` |
 * | **斜切** | `skewX` / `skewY` |
 * | **非等比变形**（压扁 / 拉长） | `scale`（`{x,y}` 不同）|
 *
 * ⇒ 所以本接口**只有** `rotate` / `skewX` / `skewY` / `scale` / `origin`。
 * **没有 `translate`** —— "平移"就是 `rect` 的活，不该有第二个说法。
 *
 * ⚠️ 它和 `rect` 的分工：`rect` **参与**布局（对齐/间距/网格全靠它）；
 *    `transform` **不参与** —— 只改画面，别的不动。
 */
export interface Transform {
  /** "它转了 -8 度"（度，**顺时针为正**；负值 = 逆时针） */
  rotate?: number;

  /**
   * **横向斜切**（度）：`8` = 斜 8 度。
   *
   * ⚠️ 口径**与 CSS `skewX()` 逐字一致**（y 轴朝下）
   * ⇒ **正角度 = 底边向右、顶边向左**，与 `rotate` 的"顺时针为正"同出一源。
   * 编译器原样写出去，**不做任何换算**。
   *
   * ⚠️ 曾经存的是"顶边错开多少倍框宽"的**比例** —— 那是错的：换算成角度还要用到**框高**
   * （`tan θ = 比例 × 宽 ÷ 高`）⇒ 名义一维、实际依赖长宽比，而且同一个接口里
   * `rotate` 是度、`skewX` 是比例，两套单位。已统一为**度**。
   */
  skewX?: number;
  /** **纵向斜切**（度）：与 CSS `skewY()` 同口径 ⇒ **正角度 = 右边向下、左边向上** */
  skewY?: number;

  /**
   * **非等比变形**（压扁 / 拉长）：`{x:1.2, y:0.8}`。
   *
   * ## ⚠️ 只给 `shape` / `image` 用；**文字一个都不许**（等比、非等比都禁）
   *
   * | | 它其实在做什么 | 该归谁 |
   * |---|---|---|
   * | 等比 `{2,2}` | 改文字的**大小** | **`fontSizePx`** |
   * | 非等比 `{0.8,1}` | 改文字的**字形比例** | **字体文件**（condensed 家族 / 变量字体的 `wdth` 轴） |
   *
   * ⇒ **文字的大小归 `fontSizePx`，文字的形状归字体文件 —— `transform` 两样都不管。**
   *
   * **为什么非等比也不行**：它不是"换一个窄的字形"，是**把已经画出来的字按方向压** ⇒
   * 竖笔变细、横笔不动 ⇒ **笔画粗细不再一致**。印刷界管这个叫 faux condensed
   * （与 faux bold / faux italic 同类），**懂排版的人一眼看得出来**。
   *
   * ⇒ **要放大文字**：`rect.w/h` × k **且** `fontSizePx` × k —— **两个都要动**，缺一个就不对
   *    （只改框 = 字一点没变大，只是给了更多空间）。
   * ⇒ `shape` / `image` 的**等比**放大也请改 `rect` —— 那是**版式上真的变大**，
   *    而不是"画面上放大、版式占位没变"。
   * ⇒ 编译器遇到"文字 + `scale`"会**丢掉它并报出来**（`emit.ts` 的 `effectiveTransform`）。
   */
  scale?: { x: number; y: number };

  /**
   * **支点**：变换绕哪个点发生。相对 **`rect` 自身**的 0–1 坐标，
   * 省略 = 中心 `{x:.5, y:.5}`。
   *
   * 常用：中心 `0.5 0.5` · 左上 `0 0` · 左下 `0 1` · 上边中点 `0.5 0`。
   * 单独出现没意义 —— 必须配合 `rotate` / `skew` / `scale`。
   */
  origin?: { x: number; y: number };
}

// ── 公共部件（元素 / 组 / 矢量图元共用）────────────────

/**
 * **混合模式** —— 这个元素怎么和**压在它下面的东西**相混。
 *
 * 值 = CSS `mix-blend-mode` 的 16 种。省略 = `normal`（正常覆盖）。
 *
 * ⚠️ **只有 16 种**（PS 有 27）—— 缺 `subtract` / `divide` / `linear-burn` / `vivid-light`
 *    等。要全 27 种得自建合成器（属位图侧）。
 */
export type BlendMode =
  // ── 正常一组 ──
  | 'normal'
  | 'multiply' // 正片叠底
  | 'screen' // 滤色
  | 'overlay' // 叠加
  // ── 对比一组 ──
  | 'darken' // 变暗
  | 'lighten' // 变亮
  | 'color-dodge' // 颜色减淡
  | 'color-burn' // 颜色加深
  | 'hard-light' // 强光
  | 'soft-light' // 柔光
  // ── 差值一组 ──
  | 'difference' // 差值
  | 'exclusion' // 排除
  // ── 色彩一组 ──
  | 'hue' // 色相
  | 'saturation' // 饱和度
  | 'color' // 颜色
  | 'luminosity'; // 明度

/**
 * **描边**：给元素描一圈边。
 *
 * 作用在**形状/盒子**上是 `border`；作用在**文字**上是文字描边；作用在**矢量轮廓**上是 SVG `stroke`。
 * —— **同一句话，三种落地**（渲染器的事）。
 */
export interface Stroke {
  /** 画什么：颜色，或一张图（`border-image`） */
  paint?: string;
  /** 线宽。四边可以不同：`[上, 右, 下, 左]` */
  width?: number | [number, number, number, number];
  /** 向内描（默认沿边向外） */
  inset?: boolean;
  /** 虚线：`[段长, 间隔]` */
  dash?: [number, number];
  /** 端点样式（只对开放路径有意义） */
  cap?: 'butt' | 'round' | 'square';
  /** 拐角样式（只对有折点的路径有意义） */
  join?: 'miter' | 'round' | 'bevel';
  /** 画在填充**上面**（默认在下面） */
  over?: boolean;
}

/** **阴影**（一层）。数组 = 多层叠（先写的在上层） */
export interface Shadow {
  /** 偏移（相对盒子短边的比例） */
  offset?: { x: number; y: number };
  /** 模糊半径 */
  blur?: number;
  /** 扩散：正数放大、负数收缩 */
  spread?: number;
  color?: string;
  /** **内阴影**（默认外阴影） */
  inset?: boolean;
  /**
   * **沿着什么**打阴影：
   * - `box`（默认）—— 沿**盒子**（矩形；圆角会跟随）
   * - `outline` —— 沿元素的**真实轮廓**（含透明区、斜切、任意路径）
   */
  follow?: 'box' | 'outline';
}

/**
 * **所有元素共有的一组「效果」字段**：变换 / 透明 / 混合 / 滤镜 / 裁剪 / 蒙版。
 *
 * 元素（`ElementBase`）和组（`GroupNode`）都从这里继承 ——
 * 组能对**一整组**做同样的事（整体旋转、整体淡出、整体打滤镜……）。
 */
export interface VisualBase {
  /**
   * **显示名**（给人看的标签，不是身份）。
   * 省略 / 空 ⇒ UI 回退显示 `id`。改它**不影响** `id` / DOM 的 `data-*` / 选中 / 渲染。
   */
  name?: string;

  /** 视觉变换（旋转 / 斜切 / 非等比缩放 + 支点）。省略 = 不动它 —— 见 `Transform` */
  transform?: Transform;

  /** 整元素的透明度（0–1）。⚠️ 与"颜色的半透明"不同：这个连描边一起淡 */
  opacity?: number;

  /**
   * **混合模式**：和压在下面的东西怎么混 —— 见 `BlendMode`。
   * 省略 = `normal`（正常覆盖）。
   */
  blend?: BlendMode;

  /**
   * **对元素「背后」的内容做滤镜** —— 值 = 一个 CSS `backdrop-filter` 值。
   * 典型用途：毛玻璃（`'blur(12px)'`）。
   */
  backdrop?: string;

  /**
   * **滤镜** —— 对元素**自己**的像素做处理。值 = 一个 CSS `filter` 值，
   * 可以串多个算子（**顺序即先后**）：`'blur(4px)'` · `'brightness(1.2) contrast(.9)'`。
   *
   * 可用算子（CSS 原生）：`blur` / `brightness` / `contrast` / `saturate` /
   * `hue-rotate` / `grayscale` / `sepia` / `invert`。
   * ⚠️ 投影**别**用 `drop-shadow()` —— 用 `shadow.follow:'outline'`；
   *    淡化**别**用 `opacity()` —— 用 `opacity`。
   *
   * 也能 `url(#名字)` 引用一个 SVG 滤镜定义 —— 那是**卷积 / 置换 / 湍流 / 形态学 /
   * 光照**这类高级算子的入口，但它们属"程序化生成"（和 `mask` 同一个处理方式）。
   */
  filter?: string;

  /**
   * **裁剪**：按一个**形状**把元素切掉（**硬边**）。
   *
   * 值是一个 CSS `clip-path` 值：
   * `'circle(50%)'` · `'ellipse(...)'` · `'polygon(…)'` · `'inset(…)'` · `'path(…)'`
   * 或引用 SVG 里定义的形状 `'url(#myClip)'`。
   */
  clip?: string;

  /**
   * **蒙版**：用一张**灰度图 / 渐变**决定哪里显、哪里隐 —— **可以半透明、可以羽化**。
   *
   * 值是一个 CSS `mask-image` 值：`'linear-gradient(to bottom, #000, transparent)'` · `'url(soft-edge.png)'`。
   * 给**数组**表示**多层蒙版**（后面的压在前面的上面）。
   *
   * ⚠️ 与 `clip` 的区别：`clip` 是**硬边裁**，`mask` 是**软蒙版**。
   *
   * ⚠️ **没放进来**的蒙版参数：平铺 / 尺寸 / 位置 / 按亮度还是按透明度 / 多层怎么合成
   *    —— 这些是**技术细节**，不是设计师会说的话。**需要时再加。**
   *
   * ⚠️ 「用 SVG 生成不规则边缘」（`feTurbulence` + `feDisplacementMap`）**不在这里** ——
   *    那是**怎么产出那张蒙版图**（属程序化生成）；产出后 `mask: 'url(那张图)'` 引用即可。
   */
  mask?: string | string[];
}

/** 每个元素都有的字段 */
export interface ElementBase extends VisualBase {
  id: string;
  rect: Rect;

  /**
   * **填充** —— 元素级（文字 / 形状 / 图片都能填）。
   *
   * 值 = 一个 CSS 的「背景」值。给**数组**表示**多层叠**（后面的压在前面的上面）。
   *
   * 能填什么（**都是"值"，不是另外的字段**）：
   * - 纯色：`'#B8722F'` · 调色板角色名 `'cream'`
   * - 半透明：`'rgba(0,0,0,.5)'` · 8 位 hex `'#B8722F80'`
   * - 现代色空间：`'oklch(0.7 0.1 60)'` · `'lab(…)` · `'color(display-p3 …)'`
   * - **跟着同元素的其他颜色**：`'currentColor'`
   * - 渐变：`'linear-gradient(115deg, #b8722f, #2f6b8a)'`
   *   （线性 / 径向 / 锥形 / **重复** —— 都靠这一个写法；色标可到透明、可硬边）
   * - 图案：`'url(leaf.svg)'`
   *
   * ⚠️ **图案的平铺 / 尺寸 / 位置**（repeat / size / position）**还没有地方放** —— 待定。
   *
   * ⚠️ **对单色图 / 图标，`fill` 就是「染色」** —— "把这张图变成铜色"。
   * （所以不需要另开一个 `tint` 字段：同一个词，在矢量上是"颜色"，在位图上是"染色"。）
   *
   * ⚠️ 作用在**文字**上时不用多说：渲染器自己会用 `background-clip:text`
   * 把填充裁进字形里。**那是实现，不是词汇。**
   */
  fill?: string | string[];

  /**
   * **圆角**：0–1（相对**盒子短边**）。
   * 四个角可以不同：`[左上, 右上, 右下, 左下]`。
   *
   * ⚠️ **不能用 `clip` 代替它**：`clip-path` 是"外面的裁刀"，**不裁描边**；
   * 而圆角是**盒子本身的形状**，描边跟着一起圆 —— 这正是当年三角形描边坏掉的原因。
   */
  radius?: number | [number, number, number, number];

  /** **描边** —— 形状/盒子 = `border`；文字 = 文字描边；矢量 = SVG `stroke`。见 `Stroke` */
  stroke?: Stroke;

  /** **阴影**（可多层）—— 见 `Shadow`。沿真实轮廓的投影用 `follow:'outline'` */
  shadow?: Shadow[];
}

// ── 文字 ──────────────────────────────────────────────

/**
 * **字号兜底**（画布 px）—— 文档没写字号时用它。
 *
 * ⚠️ 这是个**绝对 px** ⇒ 同一份文档在 900 和 1440 的画布上默认字号**一样**。
 *    27 是**照搬**"画布宽 3%"在 900 宽下的老取值，纯为不改动已有文档的观感。
 *
 * ⚠️ 它住在**文档模型**里、而不是渲染器里，因为它是**两边的共同契约**：
 *    渲染器拿它当兜底，翻译器拿它**报给模型**（"你没写字号，会用 27px"）。
 *    各写一份必然分叉 —— 翻译器曾经自己写了个 `0.03 × 画布宽`，
 *    在 1440 画布上对模型报 **43px**，而渲染器实际用的是 **27px**。
 */
export const DEFAULT_FONT_PX = 27;

/**
 * **装饰线**（下划线 / 删除线的长相）。
 *
 * ⚠️ 只能是**纯色**（装饰线填不了渐变/图）—— 所以它叫 `color` 而不是 `fill`。
 */
export interface TextDecoration {
  color?: string;
  style?: 'solid' | 'dashed' | 'dotted' | 'wavy';
  thickness?: number;
}

/**
 * 文字片段 —— **文字内容的唯一载体**。
 *
 * 多色 / 多字号 / 多字重，**全靠它**：一个片段一个样式，排在一个文本框里。
 * 只有一个颜色时，`runs` 就只有一个元素 —— **没有"单色"这个特例。**
 *
 * ## ⚠️ 划分依据：**Word 的「字符」面板 vs「段落」面板**
 *
 * 凡是**在字上选一段就能单独设**的，都是**字符级** ⇒ 进本接口（元素级同名项作"整块默认"，片段覆盖它）：
 *     字体 / 字号 / 字重 / 斜体 / 拉伸 / 颜色 · **下划线 · 删除线 · 装饰线** ·
 *     **字距 / 词距 · 基线偏移（上下标）· 大小写 / 小型大写 · OpenType 特性 · 可变字体轴**。
 *
 * 只有**按整段文字才说得通**的留在元素上（`TextNode`），**不进片段**：
 *     对齐 / 末行对齐 / 行高 / 换行 / 书写方向 / 文字方向 / 首字下沉 / 沿路径排字。
 *
 * > 早先这里只放了"字体 / 字号 / 字重 / 斜体 / 颜色 / 拉伸"六项，把下划线、字距、
 * > 上下标也当成了段落级 —— **那是错的**：Word 里选几个字加下划线是再普通不过的操作。
 * > 判据不是"CSS 能不能"，而是"**设计师会不会只想改这几个字**"。
 */
export interface TextRun {
  /** 这一段写什么。**换行写在文字里**（`\n`） */
  text: string;

  /** ↓ 以下都是**覆盖项**：只写"和元素级默认不一样"的 */
  fill?: string;
  fontFamily?: string;
  /**
   * **字号（画布 px）** —— 这一段比元素级大 / 小多少，直接写绝对值。
   *
   * ⚠️ 原名 `fontScale`（画布宽的比例）。改成 px 的理由见 `Rect` 的注释：
   * 分母是画布、**CSS 没有现成的相对单位**能表达 ⇒ 只能自己乘 ⇒ 那就只乘一次。
   * 例：`fontSizePx: 30` = 这一段是 30px（不再是 `0.0333` 这种比例）。
   */
  fontSizePx?: number;
  weight?: number;
  italic?: boolean;
  stretch?: number;

  // ── 以下同样是字符级（同样是覆盖项）──────────────────────
  /**
   * **下划线**。⚠️ **三态**：`true` 要 / `false` **明确不要**（用来取消元素级的下划线）/ `undefined` 跟随元素级。
   */
  underline?: boolean;
  /** **删除线**。三态同上 */
  strike?: boolean;
  /**
   * 装饰线的长相 —— ⚠️ **逐项覆盖**（只写"和元素级不一样"的那几项）：
   * 片段只写了 `color`，线型 / 线粗仍跟随元素级。
   */
  decoration?: TextDecoration;
  /** **字距**（em，字号倍数） */
  letterSpacing?: number;
  /** **词距**（em） */
  wordSpacing?: number;
  /**
   * **基线偏移**（em，**正数上移**）—— 上标/下标。
   *
   * ⚠️ 它**必须落在片段上**：`vertical-align` 只对**行内**元素有效，
   * 而整块文字那一层是绝对定位的块（`position:absolute` ⇒ 被 blockify）——
   * 写在那一层就是一句**无效 CSS**，画面上一点反应都不会有。
   */
  baselineShift?: number;
  /** 大小写改写（**只改显示，不改原文**） */
  textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  /** 小型大写 */
  smallCaps?: boolean;
  /** **OpenType 特性**开关（如 `['liga','smcp']`） */
  features?: string[];
  /** **可变字体的任意轴**（如 `{ wght: 427 }`） */
  variations?: Record<string, number>;
}

/** 文字 */
/**
 * ⭐ **文字的位置框 —— 没有高度**（2026-10-17 用户定）。
 *
 * 文字只有两个"输入"：**放哪儿** 和 **多宽换行**（`w`；`wrap !== 'normal'` 时无效）。
 * **高度是排版结果** ✗ 不是你能决定的 ⇒ 存了必然漂
 * （发生过：`tx-full` 存 `h:208`，实际只有 ~30，于是选中框比字大一圈 ✗）。
 *
 * ⇒ 高度由 `emit` 的 `height:auto` + 编辑器**测量 DOM** 得到 ⇒ 框永远贴着字 ✓
 * ⇒ `fit.ts`（"缩字号直到装进框"）的前提就此消失，已删除 ✓
 */
export interface TextFrame {
  x: number;
  y: number;
  /** 换行宽度（`wrap === 'normal'` 才用；否则单行不换行） */
  w: number;
  /**
   * ⚠️ **只有"路径文字"（`path` / `curve`）才需要它，普通文字不许有**。
   *
   * 对路径文字来说 `h` **不是排版结果**，而是 **SVG `viewBox` 的长宽比的一半** ——
   * `viewBox="0 0 w h"` 而 `path.d` 是 **0–1 归一化**的 ⇒ `w`/`h` 一起决定了
   * **曲线被拉伸成什么形状** ✗ 删掉它曲线就会变形 ✗
   *
   * ⇒ 校验规则：`path` 或 `curve` 存在 ⇒ 必须有 `h`；否则必须没有 ✓
   */
  h?: number;
}

export interface TextNode extends Omit<ElementBase, 'rect'> {
  type: 'text';

  /** ⭐ 位置 + 换行宽度（**没有高度**，见 `TextFrame`） */
  frame: TextFrame;

  /**
   * 文字内容 —— **按片段排，至少一段**。
   *
   * ⚠️ 「行」是**内容**，不是结构：多行就写在片段文字里（`\n`）。
   * （旧写法用 `string[]` 表示多行；现在行并入内容，结构只剩 `runs` 一个。）
   */
  runs: TextRun[];

  // ── 元素级默认样式（可省）────────────────────────────
  //    `runs` 里的**同名项覆盖**这里的值。
  //    所以"整块都是 900 粗"只需写一次，不必每个片段都写。
  //    （`fill` / `opacity` 是元素级公共属性，在 `ElementBase` 上。）
  fontFamily?: string;
  /**
   * **元素级字号（画布 px）** —— 所有片段的默认；片段可用自己的 `fontSizePx` 覆盖。
   *
   * ⚠️ 省略时用兜底常量 `DEFAULT_FONT_PX`（27px，见本节开头）——
   *    **它是绝对 px，与画布宽无关**。
   * （旧口径是"画布宽的 3%"，于是同一份文档在 900 和 1440 的画布上默认字号不同；
   *   改成 px 后不再随画布漂移。）
   */
  fontSizePx?: number;
  weight?: number;
  italic?: boolean;
  /** **横向拉伸**（比 1 宽 / 窄）—— 可变字体才有连续值 */
  stretch?: number;

  // ── 字形替换 ───────────────────────────────────────
  /** **OpenType 特性**开/关（如 `['liga','smcp','onum']`：连字 / 小型大写 / 旧体数字） */
  features?: string[];
  /** **可变字体的任意轴**（如 `{ wght: 427, wdth: 90 }`）—— 连续取值 */
  variations?: Record<string, number>;
  /** 大小写改写（**只改显示，不改原文**） */
  textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  /** 小型大写（小号的大写字母） */
  smallCaps?: boolean;

  // ── 装饰线（**整块的默认值**，片段可各自覆盖）──────────
  underline?: boolean;
  strike?: boolean;
  /** 线的长相。只有 `underline`/`strike` 打开时才有意义 */
  decoration?: TextDecoration;

  // ── 间距 ──────────────────────────────────────────
  /** 字距（em）—— 字符级（片段可覆盖），整块只是默认 */
  letterSpacing?: number;
  /** 词距（em）—— 字符级（片段可覆盖） */
  wordSpacing?: number;
  /** 行高 —— ⚠️ **段落级**（片段覆盖不了：行高是整段文字的事） */
  lineHeight?: number;

  // ── 对齐（段落级）──────────────────────────────────
  /** `justify` = 两端对齐 */
  align?: 'left' | 'center' | 'right' | 'justify';
  /** **最后一行**怎么对齐（两端对齐时，最后一行通常不能硬拉） */
  alignLast?: 'left' | 'center' | 'right';

  // ── 基线 / 首字 ────────────────────────────────────
  /** 基线微调：正数上移、负数下移（做上标/下标）。**字符级**，片段可覆盖 */
  baselineShift?: number;
  /**
   * 首字下沉：第一个字母跨越几行（`initial-letter`，**已实测 Chromium 生效**）。
   *
   * ⚠️ 依赖 `wrap: 'normal'` —— 首字下沉要有意义，这段文字**必须多行**。
   */
  dropCap?: number;

  // ── 排布方向 ──────────────────────────────────────
  writingMode?: 'horizontal' | 'vertical';
  direction?: 'ltr' | 'rtl';

  // ── 换行 ──────────────────────────────────────────
  /**
   * 换行规则。默认 `nowrap` —— 装不下时靠"实测宽度、缩字号"装进框里。
   *
   * ⚠️ **自动断词做不到**（浏览器事实，与本项目渲染器无关）：
   * `hyphens:auto` 实测在 Chromium 里不工作（英语、德语都不行）。
   * 要断词只能**自己标断点**（软连字符 `&shy;`）—— 那属于"自己分词"，不是声明式属性。
   */
  wrap?: 'nowrap' | 'normal';

  // ── 沿路径排字 ────────────────────────────────────
  /**
   * **沿弧线排字**（"拱形字"）—— 弧顶抬升 = `curve` × 容器高。
   * `>0` 时整节点合并为单行。这是**正圆弧**的**简写**。
   */
  curve?: number;

  /**
   * **沿任意路径排字**（SVG `<textPath>`）—— 值是路径的 `d` 数据
   * （`'M0,0.8 Q0.5,-0.2 1,0.8'`）。
   *
   * ⚠️ 坐标用**元素自身框**的 0–1 比例（和 `curve`、`rect` 同一套比例）。
   * ⚠️ 给了它就以它为准 —— `curve` 只是"正圆弧"的简写，两者**二选一**。
   */
  path?: string;
}

/** image（位图） */
export interface ImageNode extends ElementBase {
  type: 'image';
  /** 素材文件名（谁生产它、用什么提示词 —— 词汇一概不管，只管名字） */
  asset: string;

  /**
   * **装填方式** —— 图怎么放进这个框。
   * - `cover`（默认）：铺满，超出裁掉 —— 场景照用
   * - `contain`：完整放进，可能留空 —— **商品图用**（不能裁到主体）
   * - `fill`：拉伸铺满（**会变形**）
   */
  fit?: 'cover' | 'contain' | 'fill';

  /**
   * **焦点**：`cover` 裁掉时保留哪一块。0–1，相对图片自身。
   * `{x:.5,y:.5}` = 居中（默认）· `{x:0,y:0}` = 保左上 · `{x:1,y:1}` = 保右下
   */
  position?: { x: number; y: number };

  /**
   * **缩放质量**：放大时要不要"糊"。
   * `smooth`（默认）= 平滑插值；`pixelated` = 方块（像素风）。
   */
  render?: 'smooth' | 'pixelated';
}

// ── 矢量图形 ──────────────────────────────────────────
//
// ⭐ 只有**一个**概念：**「一块矢量图形」**。
//    底色 · 底板 · 卡片 · 圆角块 · 徽章 · 圆 · 异形 —— **全是它**，区别只在 `kind`。
//    「一块底」不是另一种节点，它就是**一块填充了颜色的矢量图形**。

/**
 * 矢量图形的**几何形态**。坐标一律是 **0–1、相对本节点自己的框**。
 *
 * | 想画 | 用 |
 * |---|---|
 * | 底色 / 底板 / 卡片 / 圆角块 | `rect`（圆角见 `ElementBase.radius`）|
 * | 圆 / 椭圆 / 徽章 | `ellipse`（框是正方形 ⇒ 正圆）|
 * | **直边异形**（旗标 / 箭头 / 三角 / 斜切块）| `polygon` —— **给一串点** |
 * | **带曲线的异形**（拱门 / 飘带 / 波浪）| `path` |
 *
 * ⚠️ **`polygon` 只有直边** —— 圆角、圆、拱门**都带曲线**，点集做不出来
 *    （除非撒一堆点假装曲线）。⇒ 所以"只做点集"是不够的，这 4 种要一起有。
 *
 * ⚠️ **`polygon` 与 `path` 对编辑器不是一回事**：
 * - `polygon` 给的是**一串点** ⇒ 编辑器能**直接插点 / 拖点 / 删点**；
 * - `path` 给的是**一段字符串**（`d`）⇒ 要插点得**先解析这串字符串**，麻烦得多。
 * ⇒ **想要"能逐点编辑的异形"，用 `polygon`。**
 *
 * ⚠️ 这里**没有**"枚举形状"（旧契约的 `rect`/`ellipse`/`arch`/`triangle`）——
 *    因为枚举**点集是写死的**，编辑器**没法往里插顶点**。
 *    旧契约画三角形用的正是"三个点写死在代码里"（`clip-path:polygon(50% 0%,100% 100%,0% 100%)`）——
 *    **枚举 = 点集写死；`polygon` = 点集自己给。**
 */
export type ShapeGeometry =
  /** **矩形** —— 就是本节点自己的框（圆角用 `ElementBase.radius`） */
  | { kind: 'rect' }
  /** **椭圆** —— 内切于本节点的框（框是正方 ⇒ 正圆） */
  | { kind: 'ellipse' }
  /** **多边形**（直边、闭合）—— 点相对本框 0–1。**唯一可逐点编辑的一种** */
  | { kind: 'polygon'; points: Array<[number, number]> }
  /** **任意轮廓**（含贝塞尔曲线）—— 坐标相对本框 0–1 */
  | { kind: 'path'; d: string };

/**
 * **矢量图形** —— 画面上的一块矢量内容（底色 / 底板 / 卡片 / 徽章 / 异形）。
 *
 * ⚠️ 矢量**放大不糊**（这是它和 `image` 的根本区别）：
 *    所以 `rect` 做大就是真的清晰，**不要**用 `transform.scale`（那会让它糊）。
 */
export type ShapeNode = ElementBase & ShapeGeometry & { type: 'shape' };

/**
 * **外部 SVG 文件**（从外面拿来的图标 / 徽标）。
 *
 * ⚠️ 与 `ShapeNode` 的分工：**自己画的走 `shape`，别人给的走 `svg`**。
 * （早先把两者揉进一个节点：`asset` 与"内联图元"二选一 ——
 *  那会造成"同一件事两个说法"，且内联图元还要额外背一套坐标系。）
 */
export interface SvgNode extends ElementBase {
  type: 'svg';
  /** 素材文件名（谁生产它、用什么工具 —— 词汇一概不管，只管名字） */
  asset: string;
}

// ── 分组 ──────────────────────────────────────────────

/**
 * **组** —— 元素里**特殊的一类**：把几个元素当一个整体来做效果
 * （整体旋转 / 整体淡出 / 整体打滤镜 / 整体裁剪蒙版 / 整体混合）。
 *
 * ⚠️ 组**没有 `rect`**（它的范围 = 组内元素的并集，不需要自己算），
 *    也**没有 `fill`/`stroke`/`shadow`**（组本身不画东西）——
 *    所以它不从 `ElementBase` 继承，只从 `VisualBase` 继承。
 *
 * ⚠️ 组是**元素**（`Element` 的一种）⇒ 它只能待在**图层里面**（或另一个组里面），
 *    **不能直接挂在画布上** —— 画布的孩子一律是图层。
 */
export interface GroupNode extends VisualBase {
  type: 'group';
  id: string;
  /** **组内元素**（还能再是组） */
  elements: ElementNode[];
}

/** **叶子元素** —— 自己不装别的东西的元素 */
export type LeafNode = TextNode | ImageNode | SvgNode | ShapeNode;

/**
 * **元素** —— 图层（或组）的孩子。要么是叶子，要么是组。
 *
 * ⚠️ 名字带 `Node` 后缀是**必须**的：`Element` 会和 **DOM 全局的 `Element`** 撞名
 *    （编辑器天天跟真 DOM 打交道，撞了以后 `tsc` 会说"两个不同的 Element"）。
 *    也与本文件既有的 `TextNode` / `GroupNode` 一致。
 */
export type ElementNode = LeafNode | GroupNode;

/**
 * 图层能带的**那组整体效果** —— 比元素的 `VisualBase` **窄**，这是故意的。
 *
 * 对着 PS 的图层面板一项项核过（2026-10-16）：
 *
 * | PS 图层属性 | 我们有 | 说明 |
 * |---|---|---|
 * | 混合模式 | `blend` | ✅ |
 * | 不透明度 | `opacity` | ✅ |
 * | 图层蒙版（软） | `mask` | ✅ |
 * | 智能滤镜 | `filter` | ✅（`url(#…)` 也能引 SVG 滤镜） |
 * | （PS 没有"对背后做滤镜"） | `backdrop` | ✅ CSS 独有，毛玻璃要靠它 |
 * | **旋转 / 斜切 / 缩放 / 支点** | ❌ **没有** | PS 也没有 —— 那是"自由变换"对**内容**做的事，不是图层属性。而且**图层和画布一样大**，转它等于转整张画布，没意义 |
 * | 矢量蒙版（形状硬边） | ❌ **没有** | `mask` 已经能表达硬边（一张黑白形状的蒙版）⇒ 留着 `clip` 就是**两套做同一件事** |
 * | 显示/隐藏 · 锁定 | ❌ 还没有 | PS 有、我们缺（**待做**） |
 * | 填充（第二种不透明度） | ❌ 没有 | 先不用 |
 */
export interface LayerEffects {
  /** 整层一起淡 —— ⚠️ 是"先合成再淡"，不是各自淡（这是"整组合成"） */
  opacity?: number;
  /** 整层和下面的东西怎么混 */
  blend?: BlendMode;
  /** 对**整层背后**做滤镜（毛玻璃） */
  backdrop?: string;
  /** 对**整层**做滤镜（模糊 / 对比度 / 饱和度…） */
  filter?: string;
  /** 整层的**软**遮罩（灰度图 / 渐变）；硬边用一张黑白形状的蒙版即可 */
  mask?: string | string[];
}

/**
 * **图层** —— 又叠加的一张画布。**画布的孩子一律是图层**（哪怕里面只有一个元素）。
 *
 * 它只带 `LayerEffects`（`opacity` / `blend` / `backdrop` / `filter` / `mask`），
 * 作用在**这张面上的一切元素**上 —— 也就是"整组合成"（先合成、再处理）。
 *
 * ## ⚠️ 它**没有**什么（都是用户 2026-10-16 定的，每条都有理由）
 *
 * | 没有 | 为什么 |
 * |---|---|
 * | `rect`（自己的范围） | **永远和画布一样大** ⇒ 元素坐标永远是画布坐标，编辑器零换算 |
 * | `background`（底色） | 底色归**画布**（`Canvas.background`）；图层是一张**透明的面** |
 * | `transform`（旋转/斜切/缩放/支点） | **和画布一样大的面转起来等于转整张画布**，没意义；PS 也没有 |
 * | `clip`（按形状裁） | `mask` 已能表达硬边 ⇒ 两套做同一件事 |
 * | 自己的填充/描边/阴影 | 图层不是元素，**它不画东西** |
 *
 * ⇒ 一句话：**图层 = 名字 + 装着的元素 + 那组整体效果**，别的都不该有。
 */
export interface Layer extends LayerEffects {
  id: string;
  /** **显示名**（同 `VisualBase.name`）：省略 / 空 ⇒ UI 回退显示 `id`；不参与渲染与身份 */
  name?: string;
  /**
   * **显示 / 隐藏**。省略 = 显示。
   *
   * ⚠️ 隐藏的图层**不产出任何 DOM**（不是 `display:none`，是根本不存在）——
   *    这样"分层截图 / 命中测试"天然看不到它，不用到处加判断。
   */
  visible?: boolean;
  /**
   * **锁定**。省略 = 不锁。
   *
   * ⚠️ **只给编辑器看**（锁住的图层里的元素不能选中 / 拖动 / 旋转），**渲染完全忽略它** ——
   *    它不是视觉字段，所以不进 `unsupported`。
   */
  locked?: boolean;
  /** 这张面上画的**元素** */
  elements: ElementNode[];
}

// ══════════════════════════════════════════════════════
// 【结构遍历】—— 到处都要用，收在这里一份，别再各写各的
// ══════════════════════════════════════════════════════

/** 深度优先遍历一个容器（图层 / 组）里的所有元素（含嵌套） */
export function* iterElements(c: { elements: ElementNode[] }): Generator<ElementNode> {
  for (const e of c.elements) {
    yield e;
    if (e.type === 'group') yield* iterElements(e);
  }
}

/** 按 id 找**元素**（含嵌套）。找不到返回 null */
export function findElement(doc: DesignDocument, id: string | null | undefined): ElementNode | null {
  if (!id) return null;
  for (const l of doc.layers) for (const e of iterElements(l)) if (e.id === id) return e;
  return null;
}

/** 按 id 找**图层**。找不到返回 null */
export function findLayer(doc: DesignDocument, id: string | null | undefined): Layer | null {
  return id ? (doc.layers.find((l) => l.id === id) ?? null) : null;
}

/** 按 id 找它**所在的容器**（图层或组）。它是图层本身、或找不到 ⇒ null */
export function containerOf(doc: DesignDocument, id: string | null | undefined): Layer | GroupNode | null {
  if (!id) return null;
  const hit = (c: Layer | GroupNode): Layer | GroupNode | null => {
    for (const e of c.elements) {
      if (e.id === id) return c;
      if (e.type === 'group') {
        const r = hit(e);
        if (r) return r;
      }
    }
    return null;
  };
  for (const l of doc.layers) {
    if (l.id === id) return null; // 它自己就是图层，没有"所在的容器"
    const r = hit(l);
    if (r) return r;
  }
  return null;
}

/** 按 id 找**任何节点**（元素或图层）—— 给"只关心它是什么"的地方用 */
export function findAny(doc: DesignDocument, id: string | null | undefined): ElementNode | Layer | null {
  return findElement(doc, id) ?? findLayer(doc, id);
}

// ══════════════════════════════════════════════════════
// 【扁平 → 图层】旧文档迁移 / 翻译器产出，**共用这一份规则**
// ══════════════════════════════════════════════════════

/**
 * **把一串扁平的元素折成图层**。旧文档（`doc.layers` 曾经直接装元素）迁移、以及
 * 翻译器把 intent 变成文档，都走这一份 —— 两边各写一遍必然漂开。
 *
 * ## 规则（两条，别的都不许加）
 *
 * 1. **顶层的组 → 直接升格成一个图层**（"画布的孩子一律是图层"）。
 *    `id` **保持不变**（选中/引用不断），效果字段原样搬到图层上，`children` → `elements`。
 * 2. **一段连续的普通元素 → 合成一个图层**。
 *
 * ## 为什么是"连续的一段"而不是"全部合成一个"
 *
 * `layers` 的**数组顺序就是叠放顺序**。若把散落在各处的普通元素全塞进同一个图层，
 * 它们与组之间的上下关系就丢了 ⇒ **渲染会变**。
 * 按"连续段"合并则顺序天然保真：`[a, b, 组, c]` → `[图层(a,b), 图层(组), 图层(c)]`。
 *
 * ⚠️ 合成出来的图层 `id` 取**这段里第一个元素的 id** 加 `-layer` 后缀 ——
 *    确定性、可追溯（同一份文档每次折出来一样）。
 */
export function wrapIntoLayers(elements: readonly ElementNode[]): Layer[] {
  const out: Layer[] = [];
  let bucket: ElementNode[] = [];
  const flush = () => {
    if (!bucket.length) return;
    out.push({ id: `${bucket[0].id}-layer`, elements: bucket });
    bucket = [];
  };
  for (const e of elements) {
    if (e.type === 'group') {
      flush();
      const { type: _drop, ...rest } = e;
      out.push({ ...rest, elements: e.elements });
    } else {
      bucket.push(e);
    }
  }
  flush();
  return out;
}

// ══════════════════════════════════════════════════════
// 【备忘录】—— 不是词汇，供归类时参照
//
// ▸ 明确**不要**的（用户决定）：
//     · **3D**（透视 / rotate3d / preserve-3d）· **背面隐藏** —— 本项目不需要
//     · **任意 2D 矩阵** `matrix(a,b,c,d,e,f)` —— 是 `transform` 的底层写法，
//       设计师的"旋转/缩放/斜切"三个词已覆盖
//     · 文字环绕形状（shape-outside）· 溢出省略号（text-overflow）·
//       首行缩进（text-indent）· 整块缩进（那是盒子的 padding，不属文字）
//
// ▸ 说"加进来"，但**不能作为文字字段**的：
//     · **内联字体**（@font-face + data URL）—— 是**机制/部署**，属**字体方案**层
//     · **文字渐隐/遮罩**（mask-image）—— **不是文字专有** ⇒ 已归**元素级 `mask`**
//     · **文字环绕形状**—— 需要"文字流 + float"，本项目是绝对定位 ⇒ 结构上不成立
//
// ▸ 做不到、因此不入表的：
//     · **自动断词**（hyphens:auto）—— 实测 Chromium 不工作
//     · **布尔路径运算**（并/交/差/排除）—— 无原生支持，需几何库先算
//     · **网格渐变**（mesh gradient）—— CSS 只有线性/径向/锥形
//     · **变宽描边**（沿线粗细变化）—— SVG `stroke-width` 沿线恒定
//     · **27 种混合模式** —— CSS 只有 16
//
// ▸ 已定，但**不属于词汇表**（属校验 / 规范化那一层）：
//     · 相邻片段样式完全相同 ⇒ **不强制合并**（渲染结果一样，先不管）
//
// ▸ **暂不建模**（需要时再加）：
//     · **SVG 滤镜原语** —— 卷积（`feConvolveMatrix`）/ 置换（`feDisplacementMap`）/
//       湍流（`feTurbulence`）/ 形态学（`feMorphology`）/ 光照（`fe*Lighting`）/ 合成
//       （`feMerge`·`feBlend`·`feComposite`）—— 属"程序化生成 / 需滤镜图"，
//       产出后由 `filter: 'url(#…)'` 引用（和 `mask` 同一处理方式）
//     · `mask` 的**合成 / 按亮度还是透明度**（mask-composite / mask-mode）
//     · `fill` **图案的平铺 / 尺寸 / 位置**（repeat / size / position）
//     · **背景层之间**的混合（`background-blend-mode`）—— 目前 `blend` 只管元素与背景
//     · 层叠隔离（`isolation`）—— 组一旦有 `opacity`/`mask`/`filter`，浏览器已自动隔离
//     · **强制任意处断行**（`overflow-wrap` / `word-break`）
//     · **复用一套定义**（旧写法的 `<use>` / `<symbol>` / `<defs>`）—— 要有"定义区"，
//       而现在画多个图元直接摆多个 `shape` 节点即可；等价物 = 把一份东西存进素材库
//     · 矢量图形里的 **`line` / `polyline`** —— 它们**只有线、没有面**，
//       摆在"一块矢量图形"这个模型里不自然（要一条线，用细长 `rect` 或 `path`）
//     · SVG 内的 `<text>` —— 直接用本表的 `text` 元素即可
// ══════════════════════════════════════════════════════
