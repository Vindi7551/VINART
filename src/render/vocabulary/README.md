# 词汇渲染器 —— `DesignDocument` → 自包含 HTML

> **现在唯一的渲染器**（词汇侧）：`DesignDocument` → 自包含 HTML。
> ⚠️ **旧链已整层删除（2026-10-16）**：`design-sketch` 契约与 `src/render/declarative/`
> （`render.ts` / `sketch.ts` / `shared.ts` / `render-style.ts`）**都不在了** ——
> 本文原先"旧链一行不动 / 两者并存、互不引用"的说法**作废**。
> 文档模型的权威说明见 [`src/document/README.md`](../document/README.md)。
>
> 建立 2026-10-13（纵切片第一步）；2026-10-16 随文档模型改版成为唯一渲染器。

## 它是什么

```
DesignDocument（src/document/vocabulary.ts）
        │
        ▼  emitDocument(doc, opts)        ← 本目录，纯函数、不开浏览器、不读盘
自包含 HTML 字符串
        │
        ▼  src/render/rasterize/blink-renderer.ts
PNG
```

**术语**：项目里这一步叫**渲染**（`src/document/README.md` §一：`spec → HTML`，确定性、零模型调用）。
本文件不碰模型、不碰文件系统 —— 字体（`faceCss`）与素材（`assets`）都由调用方**以值注入**。

## 对外接口

```ts
emitDocument(doc, {
  faceCss?,   // @font-face 声明（含内联 data URL）
  assets?,    // 素材名 → URL / data URL
  fits?,      // 每个节点的装填系数（≤1），缩字号用
}) → { html, unsupported, notes }
```

- **`unsupported`**：**词汇里有、这一版翻不出来**的每一项，带 `id` + 字段名 + 原因。
  **空数组 = 这份文档被完整翻译了。** 非空 = 有东西被丢下了，**不许当没看见**。
- **`notes`**：有损但没丢语义的（例如"这个单位是猜的"）。

> 这条「**不静默丢弃**」是刻意设计的：它把「词汇 → HTML 哪里说不清」变成**可断言的东西**。
> 探针里专门有一份"脏文档"来钉住它，**还带负例**（矩形上的渐变**不该**报不支持，因为它走 CSS，渐变是现成的）。

> ⚠️ **待决策（2026-10-18 记录，未实现）**：普通文字（无 `curve`/`path`）用**渐变描边/渐变装饰线**时，
> 目前是"首色近似"；是否/如何自动升级到 SVG `<textPath>` 渲染，见
> [`docs/PENDING-TEXT-SVG-UPGRADE.md`](../../../docs/PENDING-TEXT-SVG-UPGRADE.md)。**先记录，别当已实现。**

## 这一版**支持**什么（精确清单）

| 节点 | 支持 |
|---|---|
| `canvas` | `width` / `height` / `background`（单层） |
| `svg` | 外部 `.svg` 文件 → `<img>` + `object-fit:contain`（图标**绝不裁**）|
| `shape` | ⭐ **统一内嵌 `<svg>`**：`rect`（含 `rx` 圆角）/ `ellipse` / `polygon` 像素坐标；`path` 0–1 + `scale`；渐变走 `<defs>`；阴影走 `drop-shadow` |
| `group` | 容器（铺满画布）+ **递归**子元素；组自己的效果落在这层 |
| 文字装填 | ⭐ `fit.ts` —— 装不下时**自动缩字号**（浏览器实测，见下） |
| `shape` ⭐ | **4 种几何全支持** —— `rect`（+ `radius`）· `ellipse` · `polygon`（点集）· `path`（任意曲线）；`fill`（纯色 / 渐变）· `stroke`（线宽 / 虚线 / 端点 / 拐角 / 上下序）· `transform` · 全部元素级效果 |
| `text` | `rect` · `runs[]`（`text` / `fill` / `fontFamily` / `fontScale` / `weight` / `italic` / `stretch` / **`underline` · `strike` · `decoration` · `letterSpacing` · `wordSpacing` · `baselineShift` · `textTransform` · `smallCaps` · `features` · `variations`**）· 元素级同名字段（作整块默认）· `align` / `alignLast` · `lineHeight` / `letterSpacing` / `wordSpacing` · `wrap` · `writingMode` / `direction` · `textTransform` / `smallCaps` / `features` · `underline` / `strike` / `decoration` · **元素级渐变 / 多层填字**（`background-clip:text`）· **片段级渐变 / 图案填字**（每段各自裁剪）· **描边**（`-webkit-text-stroke`）· **`baselineShift`**（`vertical-align`）· **`variations`**（`font-variation-settings`）· **`dropCap`**（`::first-letter` + `initial-letter`）· **`curve` / `path` 沿路径排字**（SVG `<textPath>`，另一条渲染路径）|
| `image` | `rect` · `asset` · `fit` / `position` / `render` |
| 所有节点 | `transform`（`rotate` / `skewX` / `skewY` / `scale` / `origin`）· `opacity` · `radius`（rect 用）· `clip` · `mask` · `blend` · `filter` / `backdrop` |

**规则 2 已遵守**：每个节点落成一个带 `data-layer` 的容器，**DOM 顺序 = `layers` 数组顺序**。

### 产物上另外两个属性（**给编辑器用的锚点**，不是给浏览器看的）

| 属性 | 打在哪 | 谁在用 | 干嘛 |
| --- | --- | --- | --- |
| `data-fit="<id>"` | 文字的**内层** `.vt` | `fit.ts` | 量"装不装得下"（`scrollWidth / clientWidth`）。与旧链同名 |
| `data-run="<i>"` | 每个片段（run）的 `<span>` | `text-selection.ts` | 把"用户在画面上选中的那几个字"对回 `runs[i]` —— **Word 式自由选区染色靠它** |

⚠️ 少了 `data-run`，编辑器就只能整个文字块一起改色（"选中的字"和"文档里的片段"对不上号）。

## ⭐ shape：**一条渲染路线**（全部内嵌 `<svg>`，2026-10-14 统一）

原先 `rect`/`ellipse` 走 **CSS**（div + background + border-radius + outline）、
`polygon`/`path` 走**内嵌 `<svg>`** —— 两条路线导致一堆不一致：
渐变只有"盒子"能用、阴影只有"盒子"能用、描边的行为两边不同。

**2026-10-14 统一：所有 shape 都落成一个内嵌 `<svg>`**（用户拍板"删掉之前那种渲染"）。

| 几何 | 产物 | 坐标系 |
|---|---|---|
| `rect` | `<rect x=0 y=0 width height rx>` | **像素**（圆角 `rx` 不变形）|
| `ellipse` | `<ellipse cx cy rx ry>` | **像素** |
| `polygon` | `<polygon points>` | **像素**（描边不再需要 `non-scaling-stroke`）|
| `path` | `<path d transform="scale(W,H)">` | **0–1**（不解析 `d`；描边配 `non-scaling-stroke`）|

**代价必须说清（统一 = 先把 CSS 路线扛着的能力在 SVG 侧补齐，否则就是回退）：**
- ✅ 渐变：`linear-gradient` **与 `repeating-linear-gradient`**（周期展开 stop）→ `<linearGradient>` + `fill="url(#…)"`（`defs` 收在文档级一个 0 尺寸 svg 里）
  —— ⚠️ `conic` / 现代色空间仍报 `unsupported`（SVG 无原生对应）
- ✅ 阴影：投影 = `filter: drop-shadow(...)`（**无 spread 参数**——硬塞会导致整条 filter 非法被浏览器丢弃，实测踩过）；
  **内阴影** = SVG filter 配方（alpha 偏移模糊后 feComposite out 减掉，spread 用 `feMorphology erode`）—— **顺带升级**：多边形/路径也获得阴影
- ✅ 多层填充：**同一形状画多份图元**（数组[0] 最底、最后最上；描边/滤镜只挂最上层——每层都挂会叠加）
- ✅ 图案填充：`<pattern>` + `<image>`（词汇还没放平铺/尺寸参数 ⇒ 当前**拉伸铺满**，note 说明）
- ⚠️ **无 `fill` 的 shape** 也必须有一份 `fill="none"` 的图元承载描边/滤镜
  —— 兜底分支丢 attrs 的 bug：无 fill 的形状连描边/阴影都静默消失（实测踩过）
- ⚠️ 圆角：`rect.radius` → `<rect rx>`（像素、不变形 ✓）；`polygon`/`path`/`ellipse` 的 `radius` 无意义（挂 note）

**编辑器联动**：`rect`/`ellipse` 仍然没有顶点（它们是**解析形状**，一个公式定义，不是点集）；
`polygon`/`path` 的顶点编辑照旧。统一的是**渲染路线**，不是几何表达。

## 沿路径排字（`curve` / `path`）—— **另一条渲染路径**

普通文字是**浏览器排版**（`div` + `span`，CSS 自己断行 / 居中）；
排到一条线上只能靠 **SVG `<textPath>`** —— DOM 里没有别的手段。
所以这不是"再加几个字段"，而是换了一套渲染机制，产物结构完全不同：

```
<div class="vl" data-layer="…">              ← 外层照旧（rect / 变换 / 效果都在这层）
  <svg viewBox="0 0 W H">
    <path id="tp-…" d="…" transform="scale(W,H)"/>
    <text text-anchor="…"><textPath href="#tp-…" startOffset="…"><tspan data-run="0">…</tspan></textPath></text>
  </svg>
</div>
```

| 决策 | 为什么 |
|---|---|
| **不解析 `d`，用 `transform="scale(W,H)"`** | 路径坐标恒为 0–1。逐个数字乘宽高要写 SVG path 词法解析器、还得区分坐标 / 控制点 / 半径 —— 易错。改成"路径在 0–1 空间里画，SVG 自己铺到像素空间"，**而且变换挂在 `<path>` 上 ⇒ 字形不会被拉变形**。（反过来用 `viewBox="0 0 1 1" preserveAspectRatio="none"` 会把字压扁，是错的。）|
| `curve` 落成一条二次贝塞尔 | `t=0.5` 处 y = `(P0+2C+P2)/4` ⇒ 要弧顶抬升 = `curve × 容器高`，控制点 y 取 `1 − 2·curve` |
| 颜色写 **`fill`** | ⚠️ SVG 文字的颜色是 `fill` 属性，不是 CSS `color` —— 写 `color` **一点反应都没有** |
| 对齐要 **`startOffset` + `text-anchor` 一起给** | 只给 `startOffset="50%"` 是"**从中间往后排**"，稍长一点就被路径末尾截断（看图才发现的）。要居中必须配 `text-anchor="middle"` |
| `data-run` 照打在 `<tspan>` 上 | 选区（改样式）还要靠它把画面上的字对回 `runs[i]` |

**⚠️ 结构性的后果（都挂 `note`，不静默丢弃）**：
沿路径排字**就是单行** ⇒ `lineHeight` / `wrap` / `alignLast` / `dropCap` 没有意义；
装饰线 / 文字描边 / 上下标 / 渐变填字这一版没做。
另外 **文字比路径长时，超出那一截根本不渲染**（SVG 的规矩，不是 bug）—— 路径给长一点或字号小一点。

**装填实测（`fit.ts`）不参与**：页面上没有 `[data-fit]` 那个锚点，
而且"按路径长度排"本来就不是"塞进一个框里缩字号"。

**编辑器边界**：沿路径的文字**可以选字改样式**（`data-run` 在 `<tspan>` 上）。
至于**就地打字** —— SVG 元素上 `contentEditable` **根本设不上**（那是 HTML 元素才有的能力，
实测 `getAttribute` 回 `null`、元素连 `isContentEditable` 都没有）。
⇒ 宿主在**编辑期间把它降级成普通文字**渲染（摊平显示，这样才有 `.vt` 和光标），退出时自动回到弧线。
⚠️ 降级只发生在**送进渲染器的那一份**上（深拷贝）—— 文档里的 `path` / `curve` **一个字节都不改**。
⚠️ 代价说清：**摊平时的宽度 ≠ 弧线上的可用长度**，所以状态条会提示这一点。

## `svg`（外部图标）与 `group`（组）

### `svg` —— 别人给的图标 / 徽标

落地就是一个 `<img>`，和 `image` 几乎一样，只有**一处有意的差别**：
**装填固定 `contain`**。照片裁掉一条边没事，**图标裁掉一条边就废了** ⇒ 所以它没有 `fit` 字段。

⚠️ **换色做不到**（`fill`）：`<img>` 引用的 SVG 是**另一个文档**，CSS 进不去 ⇒ 报 `unsupported`，
不装作能改。要染色得走 `mask-image`（和 `image` 的染色是同一件事，都还没做）。

### `group` —— 让一组元素**整体**受效果影响

这是组存在的**唯一理由**：整体旋转 / 淡出 / 滤镜 / 裁剪蒙版 / 混合。

**实现：容器铺满画布。** 组**没有 `rect`**（词汇定的：范围 = 子元素并集，不必自己算）⇒
容器 `inset: 0`，子元素照自己那份**相对画布**的 `rect` 摆 ——
于是"组内坐标"与"画布坐标"是同一套，**不用换算也不该换算**。

⚠️ **顺带暴露的一处词汇空缺**：组没有 `rect`，而 `Transform` 又故意没有 `translate`
⇒ **组在文档层无法表达"平移"**。解法在编辑器侧（不动渲染模型）：
**组的移动 = 把它里面的元素一起搬**（PS / Figma 同款）——
组自己不动，落地时把位移写进每个子元素的 `rect`。

### ⚠️ 组的实现**就是靠父容器** —— 这不是偷懒，是别无选择

组的全部效果（`transform` / `opacity` / `blend` / `filter` / `backdrop` / `clip` / `mask`）
都落在那个容器 `div.vg` 上，子元素是它的 **DOM 后代** ⇒ 子元素的渲染**必然**受父容器影响。

**为什么不能"让子元素各自做"**？实测对比（`test_product/vocab-emit/group-opacity-proof.png`）：
左 = 组 `opacity:0.5`（挂容器）；右 = 不分组、两个子元素**各自** `opacity:0.5`。

| | 重叠区 |
|---|---|
| **组**（容器 opacity） | 整组先当**一张图**、再整体变淡 ⇒ 重叠处**不叠加** |
| **各自** opacity | 两个半透明**各画各的** ⇒ 重叠处**混出第三种颜色**，看得出边界 |

⇒ 画面**不一样**。「一组东西整体变淡 / 整体旋转」这件事，CSS 里**只有"包一层父元素"这一条路**
（`opacity` / `transform` 在子元素上各自生效 = 绕各自中心转、各自淡，不是"整体"）。

⇒ 所以 `src/document/README.md` 的**规则 3**（"节点不得依赖父容器实现自身效果"）
在**组**这里必须让路：已改述为"**可截层的单位 = 每个「顶层」节点**"。
这不是"绕过规则"，而是承认——**组的定义本身就是"让子元素受父容器影响"**，两者不可能同时成立。

> 💡 真要"每个节点都能单独截出来"，唯一的替代是**栅格化**（先把子元素合成一张位图、再对那张图做变换，
> 即 M4 的 `backend: 'raster'` 思路）—— 代价是**文字变成像素**（不能改字、放大会糊）。
> 所以它是一条**有代价的备选**，不是"更好的实现"。

⚠️ **组容器必须 `pointer-events:none`**（CSS 里那条 `.vg{pointer-events:none}`）：
它铺满画布，**吃鼠标就会盖住底下所有元素** —— 点击一律命中它，画布上什么都选不中。
（实测踩过：查了很久"顶点手柄拿不到位置"，根因就是这个。）
配 `.vg .vl{pointer-events:auto}` 让事件穿透到组内子元素。

⚠️ **连带修正了旧契约「规则 3」**（`src/document/README.md` §3.3）：
规则 3 说"节点不得依赖父容器来实现自身效果 ⇒ 每个节点必须能被单独截出来而不变样"，
而**组的意义恰恰就是**让子元素受父容器影响 ⇒ 两者不可能同时成立
⇒ 已改述为"**可截层的单位 = 每个「顶层」节点**"。
⚠️ 同时更新了 §3.4："节点之间是平级的、没有嵌套"这个理由过时了 ——
组里可以嵌套，但**坐标系仍是画布比例**（因为组容器铺满画布）。

## 这一版**不支持**什么（都走 `unsupported` 报出来）

| 缺什么 | 为什么这一版不做 |
|---|---|
| 图片：`fill`（染色） | 要 `mask-image` + `background-color` 换结构 |
| 描边：四边不同线宽 / `cap` / `join` / `over` / 图片描边 | 盒模型没有这些概念（属矢量 / 要 `border-image`）|
| `shadow.inset` / `shadow.follow:'outline'` | 前者要内阴影写法；后者要 `filter:drop-shadow`，会和 `filter` 字段打架 |
| 平铺图案的 `repeat` / `size` / `position` | 词汇里**还没有地方放**（`fill` 只是值） |
| 画布多层底色 | 只取第一层 |

## ⭐ 文字装填 `fit.ts`（"实测那一遍"，2026-10-14 做完）

字号是写死的（`fontScale × 画布宽`），文字一长就冲出框。**CSS 没有"自动缩到装得下"**
这种写法（`clamp()` / `cqw` 只知道容器多宽，不知道**这段文字**有多宽）⇒ 只能实测：

```
emit → 浏览器里量 → 算系数 → 重新 emit       （循环，直到装下或轮数用完）
```

```ts
const r = await emitFitted(doc, page, { faceCss, assets, maxRounds: 3 });
r.html   // 已经缩好的最终产物
r.fits   // 每个文字节点的系数（只含"确实需要缩"的）
r.rounds // 实际量了几轮
```

**浏览器是注入的**（`MeasurePage`），本文件不自己启动它 —— 既能接真 playwright，
也能在测试里接假页面（探针就是用假页面断言"系数是**累乘**的"）。

三条照抄旧链的经验（`src/workflow/compose/assemble.ts` —— ⚠️ **该文件已删除**，这里指它当年踩出来的做法）：
1. **测量视口 = 画布尺寸**（不然"可用宽"是错的）；
2. **必须等 `document.fonts.ready`**（woff2 异步，不等就量到兜底字体的宽度，系数全错）；
3. 量 `scrollWidth / clientWidth` —— 只对显式 `wrap:'nowrap'` 的文字有意义（它被拉成框宽，
   "需要多宽"藏在 `scrollWidth` 里）；默认换行的文字 `scrollWidth == clientWidth`，不缩字号。

⚠️ **高度不能量外层的 `scrollHeight`**（实测踩到）：内层是 `top:50%` 绝对定位，
那 50% 的偏移会被算进外层的滚动区域 ⇒ 怎么缩都差几像素，永远收敛不了。
⇒ 高度量**文字块自身**的 `offsetHeight` 和框高比。

探针 `scripts/_probe-vocab-fit.ts`（**29 条**）：必然装不下 ⇒ 缩完**真的**不溢出；
负例（本来装得下不该缩）；高度溢出；系数累乘（`0.5³`，不是覆盖成 `0.5`）。

## ⚠️ 待办（按要紧程度）

### #2 一批字段的**相对基准**在词汇里没写清

渲染器必须知道"这个数字相对什么"，但下面这些词汇里没定义，本文件只好**先猜**：

| 字段 | 猜的基准 | 风险 |
|---|---|---|
| `letterSpacing` / `wordSpacing` | `em`（字号倍数） | 也可能是 px 或"画布宽比例" |
| `shadow.blur` / `shadow.spread` | 相对**短边**（与 `radius` 一致） | 也可能是 px |
| `fontScale` | 相对**画布宽** | 词汇文档里没写，是从旧契约继承的 |
| `stroke.width` | **px**（矢量图形走 `non-scaling-stroke`，所以是屏幕 px） | 也可能是相对短边 |

⇒ **建议**：把这几条的基准**写进 `vocabulary.ts` 的注释**。不然换一个渲染器就换一套解释。

### ~~#3~~ ✅ **已解决（2026-10-14）**：`GroupNode` 挂效果与旧契约**规则 3** 的冲突

`src/document/README.md` §3.3 规则 3 原文：

> **节点不得依赖父容器来实现自身效果。** 不能让某个节点的外观靠父级的
> `background` / `opacity` / `mix-blend-mode` / `filter`。**每个节点必须能被单独截出来而不变样。**

而 `GroupNode` 继承了 `VisualBase`（含 `opacity` / `blend` / `filter` / `clip` / `mask`）——
组里的**子节点就依赖父级了**，逐层截图（PS 化要用）会对不上。

⇒ **已办**：`src/document/README.md` §3.3 的规则 3 已改述为
"**可截层的单位 = 每个顶层节点**"（并把 3.4 里"节点之间是平级的、没有嵌套"的理由也更新了：
组里可以嵌套，但**坐标系仍是画布比例**，因为组容器铺满画布）。

### #4 svg 节点与内联矢量**已经分家**（2026-10-13 改完）

`SvgNode` 现在**只负责引用外部 `.svg` 文件**；自己画的矢量全部走 `shape`。
早先两者揉在一个节点里（`asset` 与"内联图元"二选一），会造成"同一件事两个说法"，
而且内联图元还要额外背一套坐标系。**已拆。**

## 怎么跑

```bash
npx tsx scripts/_probe-vocab-emit.ts
```

跑完看 `test_product/vocab-emit/vocab-emit.png`。
探针断言 **141 条**：DOM 顺序 / 几何逐值 / 矢量两条路线（含描边与 `non-scaling-stroke`）/
字色片段覆盖 / **文字高级五样**（渐变填字 · 描边 · 上下标 · 可变轴 · 首字下沉）/ **沿路径排字**（curve · path · tspan 分段 · 对齐）/
**字符级覆盖**（下划线只落在一段上 · 三态 `false` 能取消整块下划线）/ `unsupported` 恰好命中（含负例）/
七张 PNG 非空（`vocab-emit` / `vocab-text-advanced` / `vocab-grad-run` / `vocab-path-text` / `vocab-group-svg`）。
## 沿路径排字（`curve` / `path`）—— **另一条渲染路径**

普通文字是**浏览器排版**（`div` + `span`，CSS 自己断行 / 居中）；
排到一条线上只能靠 **SVG `<textPath>`** —— DOM 里没有别的手段。
所以这不是"再加几个字段"，而是换了一套渲染机制，产物结构完全不同：

```
<div class="vl" data-layer="…">              ← 外层照旧（rect / 变换 / 效果都在这层）
  <svg viewBox="0 0 W H">
    <path id="tp-…" d="…" transform="scale(W,H)"/>
    <text text-anchor="…"><textPath href="#tp-…" startOffset="…"><tspan data-run="0">…</tspan></textPath></text>
  </svg>
</div>
```

| 决策 | 为什么 |
|---|---|
| **不解析 `d`，用 `transform="scale(W,H)"`** | 路径坐标恒为 0–1。逐个数字乘宽高要写 SVG path 词法解析器、还得区分坐标 / 控制点 / 半径 —— 易错。改成"路径在 0–1 空间里画，SVG 自己铺到像素空间"，**而且变换挂在 `<path>` 上 ⇒ 字形不会被拉变形**。（反过来用 `viewBox="0 0 1 1" preserveAspectRatio="none"` 会把字压扁，是错的。）|
| `curve` 落成一条二次贝塞尔 | `t=0.5` 处 y = `(P0+2C+P2)/4` ⇒ 要弧顶抬升 = `curve × 容器高`，控制点 y 取 `1 − 2·curve` |
| 颜色写 **`fill`** | ⚠️ SVG 文字的颜色是 `fill` 属性，不是 CSS `color` —— 写 `color` **一点反应都没有** |
| 对齐要 **`startOffset` + `text-anchor` 一起给** | 只给 `startOffset="50%"` 是"**从中间往后排**"，稍长一点就被路径末尾截断（看图才发现的）。要居中必须配 `text-anchor="middle"` |
| `data-run` 照打在 `<tspan>` 上 | 选区（改样式）还要靠它把画面上的字对回 `runs[i]` |

**⚠️ 结构性的后果（都挂 `note`，不静默丢弃）**：
沿路径排字**就是单行** ⇒ `lineHeight` / `wrap` / `alignLast` / `dropCap` 没有意义；
装饰线 / 文字描边 / 上下标 / 渐变填字这一版没做。
另外 **文字比路径长时，超出那一截根本不渲染**（SVG 的规矩，不是 bug）—— 路径给长一点或字号小一点。

**装填实测（`fit.ts`）不参与**：页面上没有 `[data-fit]` 那个锚点，
而且"按路径长度排"本来就不是"塞进一个框里缩字号"。

**编辑器边界**：沿路径的文字**可以选字改样式**（`data-run` 在 `<tspan>` 上）。
至于**就地打字** —— SVG 元素上 `contentEditable` **根本设不上**（那是 HTML 元素才有的能力，
实测 `getAttribute` 回 `null`、元素连 `isContentEditable` 都没有）。
⇒ 宿主在**编辑期间把它降级成普通文字**渲染（摊平显示，这样才有 `.vt` 和光标），退出时自动回到弧线。
⚠️ 降级只发生在**送进渲染器的那一份**上（深拷贝）—— 文档里的 `path` / `curve` **一个字节都不改**。
⚠️ 代价说清：**摊平时的宽度 ≠ 弧线上的可用长度**，所以状态条会提示这一点。

## `svg`（外部图标）与 `group`（组）

### `svg` —— 别人给的图标 / 徽标

落地就是一个 `<img>`，和 `image` 几乎一样，只有**一处有意的差别**：
**装填固定 `contain`**。照片裁掉一条边没事，**图标裁掉一条边就废了** ⇒ 所以它没有 `fit` 字段。

⚠️ **换色做不到**（`fill`）：`<img>` 引用的 SVG 是**另一个文档**，CSS 进不去 ⇒ 报 `unsupported`，
不装作能改。要染色得走 `mask-image`（和 `image` 的染色是同一件事，都还没做）。

### `group` —— 让一组元素**整体**受效果影响

这是组存在的**唯一理由**：整体旋转 / 淡出 / 滤镜 / 裁剪蒙版 / 混合。

**实现：容器铺满画布。** 组**没有 `rect`**（词汇定的：范围 = 子元素并集，不必自己算）⇒
容器 `inset: 0`，子元素照自己那份**相对画布**的 `rect` 摆 ——
于是"组内坐标"与"画布坐标"是同一套，**不用换算也不该换算**。

⚠️ **顺带暴露的一处词汇空缺**：组没有 `rect`，而 `Transform` 又故意没有 `translate`
⇒ **组在文档层无法表达"平移"**。解法在编辑器侧（不动渲染模型）：
**组的移动 = 把它里面的元素一起搬**（PS / Figma 同款）——
组自己不动，落地时把位移写进每个子元素的 `rect`。

### ⚠️ 组的实现**就是靠父容器** —— 这不是偷懒，是别无选择

组的全部效果（`transform` / `opacity` / `blend` / `filter` / `backdrop` / `clip` / `mask`）
都落在那个容器 `div.vg` 上，子元素是它的 **DOM 后代** ⇒ 子元素的渲染**必然**受父容器影响。

**为什么不能"让子元素各自做"**？实测对比（`test_product/vocab-emit/group-opacity-proof.png`）：
左 = 组 `opacity:0.5`（挂容器）；右 = 不分组、两个子元素**各自** `opacity:0.5`。

| | 重叠区 |
|---|---|
| **组**（容器 opacity） | 整组先当**一张图**、再整体变淡 ⇒ 重叠处**不叠加** |
| **各自** opacity | 两个半透明**各画各的** ⇒ 重叠处**混出第三种颜色**，看得出边界 |

⇒ 画面**不一样**。「一组东西整体变淡 / 整体旋转」这件事，CSS 里**只有"包一层父元素"这一条路**
（`opacity` / `transform` 在子元素上各自生效 = 绕各自中心转、各自淡，不是"整体"）。

⇒ 所以 `src/document/README.md` 的**规则 3**（"节点不得依赖父容器实现自身效果"）
在**组**这里必须让路：已改述为"**可截层的单位 = 每个「顶层」节点**"。
这不是"绕过规则"，而是承认——**组的定义本身就是"让子元素受父容器影响"**，两者不可能同时成立。

> 💡 真要"每个节点都能单独截出来"，唯一的替代是**栅格化**（先把子元素合成一张位图、再对那张图做变换，
> 即 M4 的 `backend: 'raster'` 思路）—— 代价是**文字变成像素**（不能改字、放大会糊）。
> 所以它是一条**有代价的备选**，不是"更好的实现"。

⚠️ **组容器必须 `pointer-events:none`**（CSS 里那条 `.vg{pointer-events:none}`）：
它铺满画布，**吃鼠标就会盖住底下所有元素** —— 点击一律命中它，画布上什么都选不中。
（实测踩过：查了很久"顶点手柄拿不到位置"，根因就是这个。）
配 `.vg .vl{pointer-events:auto}` 让事件穿透到组内子元素。

⚠️ **连带修正了旧契约「规则 3」**（`src/document/README.md` §3.3）：
规则 3 说"节点不得依赖父容器来实现自身效果 ⇒ 每个节点必须能被单独截出来而不变样"，
而**组的意义恰恰就是**让子元素受父容器影响 ⇒ 两者不可能同时成立
⇒ 已改述为"**可截层的单位 = 每个「顶层」节点**"。
⚠️ 同时更新了 §3.4："节点之间是平级的、没有嵌套"这个理由过时了 ——
组里可以嵌套，但**坐标系仍是画布比例**（因为组容器铺满画布）。

## 这一版**不支持**什么（都走 `unsupported` 报出来）

| 缺什么 | 为什么这一版不做 |
|---|---|
| 图片：`fill`（染色） | 要 `mask-image` + `background-color` 换结构 |
| 描边：四边不同线宽 / `cap` / `join` / `over` / 图片描边 | 盒模型没有这些概念（属矢量 / 要 `border-image`）|
| `shadow.inset` / `shadow.follow:'outline'` | 前者要内阴影写法；后者要 `filter:drop-shadow`，会和 `filter` 字段打架 |
| 平铺图案的 `repeat` / `size` / `position` | 词汇里**还没有地方放**（`fill` 只是值） |
| 画布多层底色 | 只取第一层 |

## ⭐ 文字装填 `fit.ts`（"实测那一遍"，2026-10-14 做完）

字号是写死的（`fontScale × 画布宽`），文字一长就冲出框。**CSS 没有"自动缩到装得下"**
这种写法（`clamp()` / `cqw` 只知道容器多宽，不知道**这段文字**有多宽）⇒ 只能实测：

```
emit → 浏览器里量 → 算系数 → 重新 emit       （循环，直到装下或轮数用完）
```

```ts
const r = await emitFitted(doc, page, { faceCss, assets, maxRounds: 3 });
r.html   // 已经缩好的最终产物
r.fits   // 每个文字节点的系数（只含"确实需要缩"的）
r.rounds // 实际量了几轮
```

**浏览器是注入的**（`MeasurePage`），本文件不自己启动它 —— 既能接真 playwright，
也能在测试里接假页面（探针就是用假页面断言"系数是**累乘**的"）。

三条照抄旧链的经验（`src/workflow/compose/assemble.ts` —— ⚠️ **该文件已删除**，这里指它当年踩出来的做法）：
1. **测量视口 = 画布尺寸**（不然"可用宽"是错的）；
2. **必须等 `document.fonts.ready`**（woff2 异步，不等就量到兜底字体的宽度，系数全错）；
3. 量 `scrollWidth / clientWidth` —— 只对显式 `wrap:'nowrap'` 的文字有意义（它被拉成框宽，
   "需要多宽"藏在 `scrollWidth` 里）；默认换行的文字 `scrollWidth == clientWidth`，不缩字号。

⚠️ **高度不能量外层的 `scrollHeight`**（实测踩到）：内层是 `top:50%` 绝对定位，
那 50% 的偏移会被算进外层的滚动区域 ⇒ 怎么缩都差几像素，永远收敛不了。
⇒ 高度量**文字块自身**的 `offsetHeight` 和框高比。

探针 `scripts/_probe-vocab-fit.ts`（**29 条**）：必然装不下 ⇒ 缩完**真的**不溢出；
负例（本来装得下不该缩）；高度溢出；系数累乘（`0.5³`，不是覆盖成 `0.5`）。

## ⚠️ 待办（按要紧程度）

### #2 一批字段的**相对基准**在词汇里没写清

渲染器必须知道"这个数字相对什么"，但下面这些词汇里没定义，本文件只好**先猜**：

| 字段 | 猜的基准 | 风险 |
|---|---|---|
| `letterSpacing` / `wordSpacing` | `em`（字号倍数） | 也可能是 px 或"画布宽比例" |
| `shadow.blur` / `shadow.spread` | 相对**短边**（与 `radius` 一致） | 也可能是 px |
| `fontScale` | 相对**画布宽** | 词汇文档里没写，是从旧契约继承的 |
| `stroke.width` | **px**（矢量图形走 `non-scaling-stroke`，所以是屏幕 px） | 也可能是相对短边 |

⇒ **建议**：把这几条的基准**写进 `vocabulary.ts` 的注释**。不然换一个渲染器就换一套解释。

### ~~#3~~ ✅ **已解决（2026-10-14）**：`GroupNode` 挂效果与旧契约**规则 3** 的冲突

`src/document/README.md` §3.3 规则 3 原文：

> **节点不得依赖父容器来实现自身效果。** 不能让某个节点的外观靠父级的
> `background` / `opacity` / `mix-blend-mode` / `filter`。**每个节点必须能被单独截出来而不变样。**

而 `GroupNode` 继承了 `VisualBase`（含 `opacity` / `blend` / `filter` / `clip` / `mask`）——
组里的**子节点就依赖父级了**，逐层截图（PS 化要用）会对不上。

⇒ **已办**：`src/document/README.md` §3.3 的规则 3 已改述为
"**可截层的单位 = 每个顶层节点**"（并把 3.4 里"节点之间是平级的、没有嵌套"的理由也更新了：
组里可以嵌套，但**坐标系仍是画布比例**，因为组容器铺满画布）。

### #4 svg 节点与内联矢量**已经分家**（2026-10-13 改完）

`SvgNode` 现在**只负责引用外部 `.svg` 文件**；自己画的矢量全部走 `shape`。
早先两者揉在一个节点里（`asset` 与"内联图元"二选一），会造成"同一件事两个说法"，
而且内联图元还要额外背一套坐标系。**已拆。**

## 怎么跑

```bash
npx tsx scripts/_probe-vocab-emit.ts
```

跑完看 `test_product/vocab-emit/vocab-emit.png`。
探针断言 **141 条**：DOM 顺序 / 几何逐值 / 矢量两条路线（含描边与 `non-scaling-stroke`）/
字色片段覆盖 / **文字高级五样**（渐变填字 · 描边 · 上下标 · 可变轴 · 首字下沉）/ **沿路径排字**（curve · path · tspan 分段 · 对齐）/
**字符级覆盖**（下划线只落在一段上 · 三态 `false` 能取消整块下划线）/ `unsupported` 恰好命中（含负例）/
七张 PNG 非空（`vocab-emit` / `vocab-text-advanced` / `vocab-grad-run` / `vocab-path-text` / `vocab-group-svg`）。
