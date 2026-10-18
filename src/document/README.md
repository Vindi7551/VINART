# 版式文档模型 —— 词汇表（`vocabulary.ts`）

> **状态：2026-10-15 全量重写；2026-10-16 文档结构改版。** 老契约（`design-sketch.ts` /
> `design-appearance.ts` + 校验器 `validate.ts` + 老渲染链 `render/declarative/`
> + 旧外观 / 组装工作流）**已整层删除**。现在**只有一个文档模型**：`vocabulary.ts`。
> 2026-10-16 起文档是三层：**画布 → 图层 → 元素**（`Layer` 现在指**图层**，不再是"节点联合"）。
> 若发现本文与代码不符，**以代码为准**并顺手改本文。

---

## 一、一个文档 = 画布 → 图层 → 元素

```ts
DesignDocument = { canvas: Canvas, layers: Layer[] }                   // layers 是【图层】，不是元素
Layer          = { id, name?, …效果, elements: ElementNode[] }          // ⚠️ 没有 rect、没有 background
ElementNode    = LeafNode | GroupNode                                  // 图层的孩子 = 元素
LeafNode       = TextNode | ImageNode | SvgNode | ShapeNode
GroupNode      = { type: 'group', id, name?, …效果, elements: ElementNode[] } // 组的孩子 = 组内元素
```

> **显示名 `name`**：图层的 `Layer.name?`、元素的 `VisualBase.name?` 只是给人看的标签。
> 省略 / 空 ⇒ UI 回退显示 `id`；它**不参与身份、坐标、渲染和 `data-*`**，
> 改它不需要重新 emit 画布（只影响面板/图层列表的显示）。

⚠️ **图层和元素是父子，不是平级**：`layers` 的孩子一律是**图层**，元素在 `Layer.elements` 里；
组（`GroupNode`）是**元素里的一类**，它的孩子也在这同一个 `elements` 字段里（组里还能再套组）。
图层**没有 `rect`**（永远和画布一样大）⇒ **元素坐标永远是画布坐标**，不存在"层内坐标"。

⚠️ **旧名字对照**（2026-10-16 改的）：旧的 `Layer`（五类节点的联合）现在叫 **`ElementNode`**；
`LayerBase` → **`ElementBase`**；`GroupNode.children` → **`GroupNode.elements`**。
遍历请用词汇表导出的工具，别再自己 walk：
`iterElements` / `findElement`（= 编辑器里的 `elementById`）/ `findLayer` / `containerOf` / `findAny` / `wrapIntoLayers`。

| 类 | 是什么 | 关键字段 |
|---|---|---|
| `text` | 画面上的文案 | `runs: TextRun[]`（**内容的唯一载体**，多色 / 多字号靠它） |
| `image` | 照片 / 商品图 | `asset` · `fit` · `position` · `render` · `fill`（染色） |
| `svg` | 别人给的图标 | `asset`（**自己画的走 `shape`**） |
| `shape` | 框 / 底板 / 分区三合一 | `kind`（见下）· `radius` · `fill` · `stroke` · `shadow` |
| `group` | 让一组元素**整体**受效果影响 | `elements`（**没有 `rect`**，范围 = 子元素并集） |

**图层**（`Layer`）自己不是元素：它有 `id` · `LayerEffects`（`opacity` / `blend` / `backdrop` /
`filter` / `mask`）· `elements`。
⚠️ **图层没有 `rect`、没有 `background`、也没有 `transform` 和 `clip`**（2026-10-16 对 PS 逐项核过）：
`rect`/`background` 是因为「又叠加的一张画布」那张画布和主画布一样大、而且**透明**（底色归画布）；
所以元素坐标**永远是画布坐标**，编辑器不需要任何"层内 → 画布"的换算。

**形状只有 4 种几何**（`ShapeGeometry`）：

| `kind` | 坐标系 | 可逐点编辑 |
|---|---|---|
| `rect` | 像素（圆角走 `rx`） | ✖（解析形状） |
| `ellipse` | 像素 | ✖（解析形状） |
| `polygon` | **盒内 0–1** | ✅ 唯一可插点 / 拖点 / 删点的 |
| `path` | **盒内 0–1** + `scale(W,H)` | ✖（要解 `d` 字符串） |

---

## 二、⭐ 分母表 —— 每个 0–1 是"谁的 0–1"

**这一节是本文最重要的一节。** 同一个 `0.5` 在不同字段里意思完全不同；
改一个字段之前，先查它除的是谁。

⚠️ **这张表讲的全是「元素」的字段**（`rect` / `points` / `radius` / 字体…）。
**图层不在表里，也不需要**：图层**没有 `rect`**（永远和画布一样大），元素坐标就是画布坐标
⇒ 图层上没有任何"要除以谁"的几何字段（它只有 `id` / 效果字段 / `elements`）。

| 字段 | 除以谁（分母） | 例：分母多大 ⇒ 实际值 |
|---|---|---|
| `rect.x/y/w/h` | —— **就是画布 px，不除任何东西** | 画布 900 ⇒ `x: 54` 就是 54px |
| `polygon.points` | **本节点自己的盒子** | 盒子宽 360 ⇒ `0.5 × 360 = 180` |
| `path.d` | **本节点自己的盒子** | 同上 |
| `transform.origin` | **`rect` 自身** | `0.5,0.5` = 自己中心 |
| `fontSizePx` | —— **就是 px，不除任何东西** | `25` 就是 25px |
| `radius` | **盒子短边** | 短边 100 ⇒ `0.1 × 100 = 10px` |
| `shadow.offset` / `blur` / `spread` | **盒子短边** | 同上 |
| `letterSpacing` / `wordSpacing` / `baselineShift` | **字号（em）** | 字号 25 ⇒ `0.05em = 1.25px` |
| `lineHeight` | **字号（倍数）** | `1.15` = 字号的 1.15 倍 |
| `rotate` / `skewX` / `skewY` | —— **度**（无量纲，与 CSS 同口径） | `8` = 8 度 |
| `curve` | **容器高**（弧顶抬升） | `0.3` = 抬 30% 高 |
| `opacity` | —— 就是比例本身 | `0.8` = 80% |

### ⚠️ 两条从表里直接读出来的推论

1. **分母是"外部常量"的（画布）⇒ 可以安全换成 px**（`rect` / `fontSizePx` 就是这么办的）；
   **分母是"用户正在编辑的东西"的（盒子短边 / 本节点盒子）⇒ 必须留比例**，
   否则拖框时要遍历重算。
   ⚠️ **角度（`rotate` / `skewX` / `skewY`）是第三类** —— 无量纲，既不用 px 也不是比例，
   而且**拖框不用重算**（8 度在什么框上都是 8 度）。
2. **`polygon.points` 的分母就是那个 `rect`**（也就是编辑器画出来的选中框）
   ⇒ **改框宽，点数字一个都不用改，形状自动跟着缩放**。这就是所谓"白拿缩放"。

### ⚠️ 还没定死基准的字段（渲染器目前是"猜"的）

`shadow.blur` / `shadow.spread` / `stroke.width` 的基准**契约里没写**，
`emit.ts` 是按"相对短边 / px"猜的。**要用它们之前，先把基准写进 `vocabulary.ts`。**

---

## 二·补、⭐ 三个层次 —— 「谁负责做那个乘法」

分母表说清了"除以谁"，但还有一件事必须写死：**那个乘法在哪一层发生**。
搞混这两件事，就会去重复实现 Blink 已经免费给的能力。

```
① 设计层   比例 → px          渲染器算（emit.ts 的 boxOf / textFontSize）
② 排版层   em / 倍数 / % → px  Blink 排版时算 —— **我们不写代码**
③ 显示层   画布 px → 屏幕 px    Blink 合成时算（wrapper 的 transform:scale，不改数字）
```

### 判据：**CSS / SVG 有没有现成的相对单位能表达它？**

| 有没有现成的 | 怎么办 | 例子 |
|---|---|---|
| **有**（`em` / `%` / 无单位倍数 / `scale()` / `<pattern>`） | **原样写进去，交给 Blink / SVG 解析** —— 一个数都不用算 | `letter-spacing:0.05em` · `line-height:1.2` · `font-stretch:87%` |
| **没有**（"相对画布宽"、"相对盒子短边"这些 CSS 里**不存在**） | **只能在渲染器里乘出来** | `rect` · `fontSize` · `polygon.points` · `radius` · `shadow.*` |

**⇒ 一条原则：不自己实现相对性；能用现成的相对单位，就绝不自己乘。**

### 实测：把盒子从 200×200 放大到 400×400，产物里哪些数字变了

| 项 | 200×200 | 400×400 | 谁算的 |
|---|---|---|---|
| 盒子 `left/top/width/height` | `200px×200px` | `400px×400px` | ① 渲染器算（写死进 HTML） |
| `polygon points` | `100,0 200,200 0,200` | `200,0 400,400 0,400` | ① 渲染器算 |
| `rect rx`（圆角） | `20` | `40` | ① 渲染器算 |
| `drop-shadow` | `4px 4px 8px` | `8px 8px 16px` | ① 渲染器算 |
| `letter-spacing` | `0.05em` | `0.05em` | ② **Blink 解析**（没动） |
| `line-height` | `1.2` | `1.2` | ② **Blink 解析**（没动） |
| `stroke-width` | `3` | `3` | SVG 用户单位（没动） |
| `font-size` | `27px` | `27px` | ① 算过（**它不随盒子变**，随画布宽变） |

> 复现：`node --experimental-transform-types --import ./scripts/_ts-resolve.mjs scripts/_probe-scale-html.mjs`

### ⭐ 这份表直接决定了「能不能存 px」

```
落在 ② 排版层的字段   ⇒ 留着比例（其实是 em / 倍数），**让 Blink 算** —— 改了反而要多写代码
落在 ① 设计层的字段   ⇒ 再按分母表分：
        分母是画布（恒定）      ⇒ ✅ 可以存 px（换算一次永久有效，还能免掉 4 位小数的精度损失）
        分母是自己的框 / 短边    ⇒ ❌ 必须留比例（分母会被用户拖）
```

**两个具体推论**：

- `letterSpacing` / `baselineShift` **永远不该存 px** —— `em` 是 Blink 免费解析的，
  改成 px 反而要在"改字号"时回头重算（白白丢掉一份能力）。
- `rect` / `fontSize` **是最值得改成 px 的两个** —— 它们的分母（画布）恒定，
  且**没有任何 CSS 相对单位**能表达它们，所以那个乘法只能自己做 ⇒ 那就只做一次。

### 一个反例，防止借错

`path` 的 `d` 是 **0–1** 坐标，实现上**不解析 `d`**，而是

```html
<path d="M0,1 Q0.5,-0.3 1,1" transform="scale(W,H)"/>
```

**路径在 0–1 空间里画，缩放交给 SVG** —— 解析 `d` 再逐个乘宽高是最容易错的做法
（要区分坐标 / 控制点 / 半径、还要处理相对命令与隐式重复）。
⚠️ 而 `transform` 只挂在 `<path>` 上，**`<text>` 不受影响** ⇒ 字形不会被拉变形。
（反过来用 `viewBox="0 0 1 1" preserveAspectRatio="none"` 会让字跟着被压扁 —— 那是错的。）

---

## 三、一条判据分「版式」与「外观」

> **改它会不会让别的东西挪位置？**

| 会挪 ⇒ 版式 | 不会挪 ⇒ 外观 |
|---|---|
| `rect` · `fontScale` · `weight` · `align` · `lineHeight` · `letterSpacing` · `radius` · `transform` | `fill` · `stroke` · `shadow` · `fontFamily` · `opacity` · `blend` |

对照参考：**独立的 `design-appearance.json` 已经不存在了** ——
颜色 / 描边 / 阴影**直接放在元素自己身上**。

⚠️ `weight` 属于**版式**（粗体更宽，会挪位置），虽然它看着像"外观"。

---

## 四、两条渲染契约（`emit.ts` 要守的）

1. **规则 2 · 每个节点落成一个带 `data-layer` 的容器。**
   这是"DOM → 分层截图"的前提，也是编辑器的命中锚点。
   ⚠️ 2026-10-16 起**图层也各落一个容器**：`emitDocument` 对每个图层产出一个
   `<div class="vg" data-layer="<layerId>" data-layer-type="layer">`，元素在它里面
   （`div.vl` + `data-layer-type="<type>"`）。
2. **规则 3 · 节点外观不得依赖父级的 `background` / `opacity` / `mix-blend-mode` / `filter`。**
   ⚠️ 组是**唯一例外**，而这不是偷懒，是"组"这个概念的**定义**：
   可截层单位 = **每个顶层元素**（顶层 = 图层直属那一层）。

产物上另外几个锚点（**给编辑器 / 测量用，不是给浏览器看的**）：

| 锚点 | 打在哪 | 谁用 |
|---|---|---|
| `data-layer="<id>"` | 每个节点的容器 | 命中测试收口 · 覆盖层定位 |
| `data-fit="<id>"` | 文字**内层** `.vt` | 文字自适应测量 + 就地编辑挂 `contentEditable` |
| `data-run="<i>"` | 每个片段 `span` | 选区 ↔ `runs[i]` 的翻译 |

**shape 全部落成一个内嵌 `<svg>`**（2026-10-14 统一，原先 `rect`/`ellipse` 走 CSS）：

| `kind` | 产物 | 坐标系 |
|---|---|---|
| `rect` | `<rect x=0 y=0 width height rx>` | 像素 |
| `ellipse` | `<ellipse cx cy rx ry>` | 像素 |
| `polygon` | `<polygon points>` | 像素 |
| `path` | `<path d transform="scale(W,H)">` | 0–1 + `non-scaling-stroke` |

> 圆角 / 填充 / 描边 / 阴影**都在 svg 那边**；容器 div 只管
> 位置尺寸 · `transform` · `opacity` · `blend` · `clip` · `mask` · `backdrop`。

---

## 五、这份文档**刻意不含**什么（不是遗漏，是暂缓）

| 缺什么 | 加回时的原则 |
|---|---|
| 更复杂的组合形状 | **不要引入布尔运算**；只加"有名字的预设形状" |
| 分组 / 复制 | 属结构，与内容正交 |
| 对齐关系（声明式） | 属关系，与元素正交；现在全靠手算坐标 |
| 效果层（压暗 / 暗角） | **不该回来**：归生图提示词 |
| 有机形状（飘带、流体） | **不该回来**：它们归**素材图**，不是框 |

---

## 六、谁读这份文档

| 消费者 | 入口 | 说明 |
|---|---|---|
| 编译器 | `render/vocabulary/emit.ts` 的 `emitDocument(doc, opts)` | **纯函数**：不读盘、不调模型、不开浏览器 |
| 文字实测 | `render/vocabulary/fit.ts` 的 `emitFitted(doc, page)` | ⚠️ **全项目零生产调用**（见下） |
| 编辑器 | `editor/vocab-editor.ts` 的 `createVocabEditor(host, wrap, root, opts)` | 改的就是这份文档；**只改数据，DOM 是它写出来的投影** |
| 落盘 | `<工作目录>/designs/<版式名>/doc.json` | 一份文件 = 一份文档；**HTML 不存**，每次现场 emit |

### ⚠️ 三个已知缺口（别当它们是好的）

1. **`fit.ts` 零生产调用** ⇒ 长文字会冲出框，预览与 `final.png` 都会溢出。
2. **`emit.ts` 有静默丢弃**（shape 的四角 `radius`、`stroke.dash` on text/image、
   组内文字不进测量）—— 违反它自己立的"绝不静默丢弃"。复现：
   `node --import ./scripts/_ts-resolve.mjs scripts/_probe-vocab-coverage.mjs`
3. **harness 那一侧暂时是空的**：主 AI 的工具表里设计相关工具（`spawn_design_agents` /
   `render_design` / `generate_assets` / `compile_appearance` / `read_spec` / `edit_spec`）
   随旧契约一起摘除了，**要重新对着词汇表长**。目前只有 `skill` 工具。
