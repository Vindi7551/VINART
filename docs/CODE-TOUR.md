# CODE-TOUR —— 编译器与编辑器代码导览

> # ⚠️ 本文档已过期 —— 它描述的是旧契约链，不要照着它去找文件
>
> **写于 2026-10-16 文档模型改版之前**，按当时的扁平文档模型（`layers` 直接装节点）+ 旧链编辑器入口行文。
> 2026-10-16 文档模型大改（画布 → 图层 → 元素）之后，下面这些东西**在仓库里已经不存在 / 已改名**，
> 正文里**每一处都已就地标了「（已删除）」或 ⚠️ 注**，但读之前先看这张表免得扑空：
>
> | 本文写的 | 现状 |
> |---|---|
> | `src/editor/index.ts`（旧链 `createEditor`，§0 / §1 / §5.3 提到） | ❌ **已删除**（随旧契约退役；新链入口是 `vocab-editor.ts` 的 `createVocabEditor`） |
> | `scripts/_probe-vocab-*.ts`（§0 / §9 提到） | ❌ **整批已删除**（断言现在在 `test/*.test.ts`，`npm test`） |
> | `layerById()` | ↔ **改名 `elementById()`**（= 词汇表的 `findElement`） |
> | `Layer` = `TextNode \| ImageNode \| SvgNode \| ShapeNode \| GroupNode` | ↔ 那个联合现在叫 **`ElementNode`**；**`Layer` 现在指「图层」**（画布的孩子，`elements: ElementNode[]`） |
> | `LayerBase` | ↔ 改名 **`ElementBase`** |
> | `GroupNode.children` | ↔ 改名 **`GroupNode.elements`** |
> | `rect` 是 0–1 比例 | ↔ **现在就是画布 px**（不再乘画布宽） |
> | `emitLayer` 分派所有节点类型 | ↔ **`emitLayer` 现在只处理图层**；元素走 `emitElement`，每个图层产出一个 `<div class="vg" data-layer-type="layer">` |
> | `src/workflow/compose/` · `src/render/declarative/` · `design-sketch*.ts` | ❌ 都是旧契约的文件，**已整层删除**（本文不常用到，但同期的其它文档常提；一律作废） |
>
> **当前真源是这几份文档（按这个顺序读）**：
>
> 1. [`src/document/README.md`](../src/document/README.md) —— 文档模型 + 分母表
> 2. [`src/editor/README.md`](../src/editor/README.md) —— 编辑器机制 · 打字链路 · 两条不变量
> 3. [`src/render/vocabulary/README.md`](../src/render/vocabulary/README.md) —— 词汇渲染器
> 4. [`docs/EDITOR-EVOLUTION.md`](EDITOR-EVOLUTION.md) —— 项目级演进方案
>
> 以及**代码本身**：[`src/document/vocabulary.ts`](../src/document/vocabulary.ts) —— 它的文件头就是权威说明。
>
> **本文剩余价值**：那些"为什么这么设计 / 踩过什么坑"的段落仍然成立（架构决策、两段式命中、
> 栈的引用分离坑…）。**行数、条数、字段数都是写时的快照，别当现值。**
>
> 下面原有引言保留：

> 面向**通读源码**的导览：每个模块讲清楚「职责 → 数据结构 → 核心函数（可直接搜索的锚点）→
> 实现思路 → 实测踩过的坑」。代码本身在仓库里，本文给的是**读法**和**为什么**。
>
> 全部代码 **7545 行**：词汇表 599 + 编译器 1134 + 编辑器 16 文件 4672 + demo 1143。
> 探针（scripts/_probe-vocab-*.ts）另计，是每一条能力的机器断言。
> ⚠️ **上面这些行数 / 条数都是当时的快照**（词汇表现在 867 行）；`scripts/_probe-vocab-*.ts` **整批已删除**。

---

## 0. 推荐阅读顺序

```
① src/document/vocabulary.ts        599 行   词汇表（一切的地基，纯类型）
② src/render/vocabulary/emit.ts    1134 行   编译器（词汇 → HTML）
③ src/editor/editor-stack.ts            118 行   统一编辑栈（最小而完整，先读它建立"事务"概念）
④ src/editor/vocab-editor.ts       1427 行   编辑器主体（手势/文字/升格/图层/栈集成）
⑤ src/editor/ 支撑模块（每个 <300 行，按需查）
⑥ src/demo/vector/main.ts          1009 行   宿主（编辑器如何被"喂"和"接"）
⑦ src/editor/index.ts              554 行   【旧链遗留】只为对照 D1/D2/D3 设计决策 —— ⚠️ **该文件已删除**
```

---

## 1. 全景

| 路径 | 行数 | 一句话职责 |
|---|---|---|
| `src/document/vocabulary.ts` | 599 | **词汇表**：画布/元素/效果/矢量/分组——唯一文档模型（纯类型，零实现） |
| `src/render/vocabulary/emit.ts` | 1134 | **编译器**：`DesignDocument` → 自包含 HTML（确定性纯函数，零模型调用） |
| `src/editor/editor-stack.ts` | 118 | **统一编辑栈**：快照式撤销/重做 + 打字合并 |
| `src/editor/vocab-editor.ts` | 1427 | **编辑器主体**：手势状态机 + 文字编辑 + 升格 + 图层 API + 栈集成 |
| `src/editor/gesture-math.ts` | 155 | 手势数学：move/resize/rotate/angle 的纯函数 |
| `src/editor/hit-test.ts` | 68 | **两段式命中**：先装饰件、再问子文档 |
| `src/editor/overlay.ts` | 108 | 包围盒覆盖层（角柄/旋转柄，DOM） |
| `src/editor/point-overlay.ts` | 258 | 顶点圆点 + "边上加点"悬停预览（DOM） |
| `src/editor/points.ts` | 218 | 顶点几何：拖动/插入/删除点集的纯函数 |
| `src/editor/target.ts` | 194 | 对子文档 DOM 的读写薄封装（编辑器不持全局 document）—— ⚠️ 文件还在，但**已是孤儿**（`createTarget()` 零调用，待清理） |
| `src/editor/text-runs.ts` | 283 | 文字 runs 的纯变换：插入/删除/选区染色/字符属性 |
| `src/editor/text-edit.ts` | 127 | 文字态的进入/退出/光标恢复 |
| `src/editor/text-selection.ts` | 286 | Word 式选区：屏幕点 ↔ 文档绝对偏移 |
| `src/editor/inspector.ts` | 686 | 属性面板的字段清单（fieldsFor）+ patch |
| `src/editor/types.ts` | 187 | 编辑器层的契约（不 import React 外壳，依赖方向 ui → editor） |
| `src/editor/index.ts` | 554 | 【旧链遗留】旧编辑器入口——只为对照设计决策 —— ⚠️ **已删除** |
| `src/demo/vector/main.ts` | 1009 | **宿主**：createVocabEditor 的调用方（render/onChange/onTyping/面板） |
| `src/demo/vector/doc.ts` | 134 | demo 文档（手写的 DesignDocument 样例） |

**两条可机器断言的不变量**（`src/editor/README.md`）：
1. 子文档 `<script>` 恒为 0（iframe 是纯渲染器）；
2. `src/editor/*.ts` grep `\b(document|window)\b` = 0 命中（编辑器不认识"当前页面"）。

---

## 2. 文档模型 —— `src/document/vocabulary.ts`（599 行 · ⚠️ **现在 867 行**）

### 定位
**词汇表 = 需求文档**。它回答"我们的设计语言能表达什么"，不描述渲染器现状。
纯类型、零实现、目标无关（不能长成 HTML 的样子）。生产者是对话链路的模型——按词汇表直接产出 `DesignDocument` JSON。

### 骨架

```ts
export interface Canvas { width; height; background?: string | string[] }
export interface DesignDocument { canvas: Canvas; layers: Layer[] }  // 数组顺序即叠放顺序（先写在下面）

export interface VisualBase {          // 所有节点的"效果"层
  transform?: Transform;               // rotate/skewX/skewY/scale/origin
  opacity?: number;
  blend?: BlendMode;                   // mix-blend-mode
  backdrop?: string;                   // 毛玻璃
  filter?: string;                     // CSS filter 串
  clip?: string;                       // clip-path（硬边）
  mask?: string | string[];            // mask-image（软蒙版，多层）
}

interface Stroke { paint?; width?; inset?; dash?; cap?; join?; over? }
interface Shadow { offset?; blur?; spread?; color?; inset?; follow?: 'box'|'outline' }

type Layer = TextNode | ShapeNode | ImageNode | SvgNode | GroupNode;
// 每种 = LayerBase(id/rect/fill/stroke/shadow/name) + 自己的部分
```

> ⚠️ **上面这段骨架已过时（2026-10-16 文档模型改版）**：
> `DesignDocument.layers` 现在装的是**图层**——`Layer = { id, background?, …效果, elements: ElementNode[] }`，
> **图层没有 `rect`**（永远和画布一样大）⇒ 元素坐标就是**画布坐标**；
> 元素在 `Layer.elements` 里，那个"五类节点的联合"现在叫 **`ElementNode`**（= `LeafNode | GroupNode`）；
> `LayerBase` 改名 **`ElementBase`**，`GroupNode.children` 改名 **`GroupNode.elements`**。
> 另外 `rect` 也已从 0–1 比例改成**画布 px**（见下一节 ⚠️）。
> 当前权威结构见 [`src/document/README.md`](../src/document/README.md) §一。

### 必须理解的三条设计决定

1. **`Transform` 故意没有 `translate`**——"平移就是 `rect` 的活，不该有第二个说法"。
   （推论见 §4：组没有 rect ⇒ 组在文档层无法表达平移 ⇒ 编辑器用"搬子元素"解。）
2. **`GroupNode` 没有 `rect`**——"范围 = 子元素并集，不需要自己算"。
   （两句各自成立 ⇒ 合起来组无法平移 ⇒ 编辑器侧用"搬子元素"补，渲染模型不动。）
3. **`rect` 用 0–1 比例**（相对画布）⇒ 换分辨率不用改一个字；文字装填实测两遍回填 `fit`。
   ⚠️ **已改（2026-10-15）**：`rect` 现在**就是画布 px**（分母恒定 ⇒ 只乘一次；见 `vocabulary.ts` 的 `Rect`）。
   所以"换分辨率不用改一个字"这句不再成立；比例只留给分母会被拖动的 `points` / `radius` / `shadow.*`。

### 有理由不做的（词汇注释里写明）
3D / 背面隐藏 / `matrix()`；图案的平铺尺寸参数、mask 的技术参数（"需要时再加"）。

---

## 3. 编译器 —— `src/render/vocabulary/emit.ts`（1134 行）

### 定位与总签名

```ts
export function emitDocument(doc: DesignDocument, opts: EmitOptions = {}): EmitResult
// EmitResult = { html: string; unsupported: EmitIssue[]; notes: EmitIssue[] }
```

**确定性纯函数**：同输入永远同输出，零模型调用、零 IO。
`html` 是**自包含**的（字体走 data URL 内联，`<style>`/`<defs>` 全在文档里）。
`unsupported` = "词汇里有、这版翻不出"的**诚实清单**——宁可报出来，绝不静默丢弃；
`notes` = 降级说明（能渲染但带了近似/取舍）。

### 主干：emitLayer 的分派（锚点 `function emitLayer`，~1024 行）

> ⚠️ **函数分工已变（2026-10-16）**：`emitLayer` 现在**只处理图层**（一张铺满画布的面：
> 底色 + 图层自己的效果，产出 `<div class="vg" data-layer="<layerId>" data-layer-type="layer">`）；
> 下面这段"按 `node.type` 分派"的骨架现在对应 **`emitElement`**（元素，产出 `div.vl`），
> 而且 `emitElement` 里还会先按"是不是组"分派。另外 `rect` 现在是画布 px，`boxCss` 不再乘画布宽。

```ts
// 伪码骨架（真实代码见锚点处）
if (node.type === 'group') return emitGroup(node, ctx);   // 容器铺满画布，子元素递归
const isText = node.type === 'text';
const isShape = node.type === 'shape';
let visual = visualCss(node);                              // opacity/blend/backdrop/clip/mask
if (isShape) visual = visual.filter(x => !x.startsWith('filter:')); // shape 的 filter 在 svg 属性里
const inner = isText
  ? (t.path || t.curve ? emitPathText(t, C, fit, note)     // 沿路径：SVG <textPath>（另一条渲染路径）
                        : emitText(t, C, fit, no, note, ctx.extraCss))  // DOM 排版
  : isShape ? emitShape(node, C, no, note, ctx.defs, ctx.opts.assets) // ⭐ 统一内嵌 <svg>
  : node.type === 'svg' ? emitSvg(node, ctx, no)           // 外部文件 → <img>
  : emitImage(node, ctx.opts, no);                         // <img> + object-fit
const style = css([ 'position:absolute', boxCss(b), radiusCss(...), fill, fillArr,
                    transformCss(node.transform, b), ...visual, shadowDecl,
                    node.type === 'image' ? strokeCss(node.stroke, no) : '' ]);
return `<div class="vl" data-layer=... style="${style}">${inner}</div>`;
```

**关键点：一个节点 = 外层通用容器（div.vl，承载 transform/五件套/阴影）+ 类型专属的内容**。
这个同构让"效果层"对所有类型行为一致。

### shape：统一渲染路线（锚点 `function emitShape`，831 行）

**全部四种几何都落成内嵌 `<svg>`**（旧版 rect/ellipse 走 CSS 的路线已删）：

| kind | 产物 | 坐标系 | 为什么 |
|---|---|---|---|
| `rect` | `<rect x=0 y=0 w h rx>` | 像素 | `rx` 圆角与描边**不变形** |
| `ellipse` | `<ellipse cx cy rx ry>` | 像素 | 同上 |
| `polygon` | `<polygon points>` | 像素 | 描边不需要 non-scaling-stroke |
| `path` | `<path d transform="scale(W,H)">` | **0–1** | 不解析 `d`；描边配 `non-scaling-stroke` |

⚠️ **图元坐标相对容器**（svg 放在容器 0,0）——用画布绝对值会**偏移两次**（实测错位过）。

**填充**（`takeFill`）：纯色 / `linear-gradient`（含 repeating，展开 stop）→ `<defs><linearGradient>` + `fill="url(#…)"` / 图案 `url(...)` → `<pattern><image>` / **多层填充 = 同一形状画多份图元**（数组[0] 最底、最后最上；**描边/滤镜只挂最上层**——每层都挂会叠加）。
⚠️ **无 fill 也要有一份 `fill="none"` 的图元**——否则描边/阴影静默消失（实测踩过）。

**阴影**（shape 内联 + text/image 的 `shadowCss`）：
- 投影 = `filter: drop-shadow(x y blur color)`——**没有 spread 参数**，硬塞会让整条 filter 非法被浏览器**整条丢弃**（阴影无声消失，实测踩过）；
- 内阴影 = SVG filter 配方：`SourceAlpha` 偏移+模糊 → `feComposite operator="out"` 从原 alpha 减掉 → 染色 → `feMerge` 叠回源；**spread 用 `feMorphology erode`**；
- `follow:'outline'` = drop-shadow（沿真实轮廓），text/image 上与用户 `filter` **合并成一条**声明。

**组的变换**（`groupTransformCss`）：支点参照**内容框**（`groupContentBox` = 子元素并集）⇒ 组绕自己转；
⚠️ 组容器铺满画布 ⇒ CSS `transform-origin` 的百分比口径与普通节点不同，要换算。

**诚实报错**：`no(field, reason)` 进 `unsupported`（翻不出）；`note(field, reason)` 进 `notes`（降级说明）。约束：**报出的每一条都必须真实**，不许静默丢弃。

---

## 4. 编辑器主体 —— `src/editor/vocab-editor.ts`（1427 行）

### 定位与入口

```ts
export function createVocabEditor(
  host: HostDom,            // 父页面挂载点（覆盖层画在这里）
  wrap: HTMLElement,        // 画布容器
  rootArg: LayerDom,        // 子文档（iframe 内 document）——编辑器只通过参数认识它
  opts: VocabEditorOptions, // { doc, onChange, onTyping, onSelect, patch... }
): VocabEditorHandle
```

编辑器住**父文档**，iframe 退化为纯渲染器（`pointer-events:none` + `sandbox="allow-same-origin"`，子文档 `<script>` 恒 0）。交互由父侧覆盖层接管。

### 三条地基决策（贯穿全部代码）

- **D1 真源是内部工作副本**：手势起点从内部 `doc` 取，**不从渲染产物读回**（读 DOM 会把亚像素量化掉）。
- **D2 一次手势恰好一条提交**：`pointerdown…pointerup` = 一次 `onChange`；原地单击不发。
- **D3 命中测试两段式**（`hit-test.ts`）：先问父侧装饰件（手柄/顶点），再问子文档（`elementFromPoint`）。

### 核心内部状态（锚点 `export function createVocabEditor`，249 行起）

```ts
let doc: DesignDocument = cloneDoc(opts.doc);  // 真源（D1）
let selectedId: string | null = null;
let textEditId: string | null = null;          // 文字态（与 session 互斥）
let session: Session | null = null;            // 手势会话
let gestureBox: LocalBox | null = null;        // 手势期间的实时值
const stack: UndoStack = createUndoStack(opts.doc);  // M2 统一编辑栈
```

`Session` 是判别联合（每种手势一个 kind）：
```ts
type Session =
  | { kind: 'move';    start: LocalBox; origin: LocalPoint; kids?: Kid[] }
  | { kind: 'resize';  dir: HandleDir; start: LocalBox; origin: LocalPoint; kids?: Kid[] }
  | { kind: 'rotate';  start: LocalBox; center: LocalPoint; angle0; rotate0 }
  | { kind: 'vertex';  index: number; origin: LocalPoint; start: Point01[] };
```

### 统一提交出口（M2 的接缝）

```ts
function submit(id: string | null, label: string, key?: string) {
  pushCommand(stack, doc, label, key);   // 压撤销栈（before 取自 stack.head）
  opts.onChange?.(id, doc);              // 通知宿主重渲
}
function commitTyping(id: string | null, keySuffix?: string) {
  pushCommand(stack, doc, '输入文字', keySuffix ? `type:${id}:${keySuffix}` : `type:${id}`);
  opts.onTyping?.(id, doc);              // 打字不重渲（宿主就地补 DOM），但参与合并
}
```
7 处 onChange + 3 处 onTyping 全部改道这两个函数——**没有任何编辑动作绕过栈**。

### 选中与组的语义（锚点 `resolveSelection` / `outermostGroupOf` / `boxOfAny` / `collectLeaves`）

- **单击选最外层组 / 再点一次下钻 / Ctrl+⌘+Alt 一步下钻**（Figma 同款）。
- ⚠️ **"下钻"规则不能拿去判断"起不起手势"**——否则选中组之后按下去想拖会被当成下钻（拖不动）。
  手势的地盘只认"光标是否压在**当前选中的那个东西**上（含它组里的元素）"。
- **组的移动 = 搬子元素**：词汇里组没有 `rect`、`Transform` 没有 `translate` ⇒ 组在数学上无法平移 ⇒
  编辑器解法（不动渲染模型）：**组的移动/缩放 = 把变化分摊到每个子元素的 rect**；
  拖拽预览 = 给组容器加一层 CSS 变换（容器铺满画布 ⇒ 等于整组在动，一个子元素都不用碰）。
- ⭐ **组的旋转是组自己的 `transform.rotate`**（子元素一个都不动）——与移动/缩放正相反，
  这是"组有 `transform` 但没有 `rect`"的自然结果，不是不一致。
- 包围盒（`boxOfAny`）：子元素并集，且**要把 4 角按组自己的 rotate 转过去**，否则框和内容错位。

### 升格（锚点 `promoteToPolygon` / `ensureEditablePoly` / `editablePoints`）

rect/ellipse 是**解析形状**（一个公式），文档里没有点集 ⇒ 要逐点编辑，在**用户真的要编辑的那一刻**
把解析形状转成 polygon（Figma 同款，**单向**）：
- `rect` → 4 角点（**圆角丢失**）；`ellipse` → **24 点近似圆**；`path` 不升格（贝塞尔编辑是另一个功能）。
- 三个入口（拖顶点/点边加点/双击删点）都先过 `blocked()` 再升格——**组带变换时不许升格也不许编辑**
  （坐标换算没算组上的变换，会改错地方）。
- 升格发一次 `onChange`（文档类型真的变了），**不改视觉**（形状完全一致），`rect` 保留为定位框。

### 文字（锚点 `emitText` 配合 demo 的 `onSubBeforeInput`；编辑器侧 insertText/deleteRange/applyRange）

- 双击进文字态：`.vt` 设 `contentEditable`，光标/方向键/拖选/输入法交给浏览器；拦 `beforeinput` 改 runs。
- ⭐ `onTyping(id, doc)` 与 `onChange` 分开：**段数没变就地补 DOM**（打字不重渲，否则光标闪+卡），变了才重渲。
- ⭐ `onTyping` **必须把 doc 一起交出去**（编辑器内部是克隆，宿主不接就会把刚打的字写回去）。
- Word 式选区（`text-selection.ts`）：屏幕点 ↔ 文档绝对偏移的双向换算；18 项字符级样式改完选区不丢。

### 撤销/重做（handle 上的 `undo`/`redo`）

```ts
undo(): boolean {
  if (textEditId) exitTextEdit();      // 文字态先退（浏览器原生撤销改 DOM 会搞乱真源）
  const prev = stackUndo(stack);
  if (!prev) return false;
  doc = cloneDoc(prev);                // ⭐ 必须再克隆一层！见 §5
  if (selectedId && !layerById(selectedId)) { selectedId = null; outline(null); }   // ⚠️ 现已改名 elementById()
  syncOverlay();
  opts.onChange?.(selectedId, doc);    // 宿主重渲
  return true;
}
```

### 图层管理（M3，handle 上的 `addLayer`/`removeLayer`/`moveLayer`）

全部走 `submit` 进栈。~~`removeLayer` 递归（组连子元素）；`moveLayer` 只动顶层。~~（这句已过时，见下）
⚠️ **口径已改（2026-10-16）**：方法名里的 "Layer" 是历史遗留 —— 它们收的是**元素 id**：
`removeLayer(id)` / `moveLayer(id, …)` 先用 `containerOf(doc, id)` 找**它所在的容器**（图层或组），
再在**那个容器**的兄弟之间摘掉 / 换位（不再是"顶层 splice"）；两者**也收图层 id**（在 `doc.layers` 的兄弟间换位 / 删除）。
`addLayer(node)` 加的是**元素**，进**第一个图层**（没有就先建 `layer-1`）。
⚠️ **方向语义**：数组**后面的东西画在上面** ⇒ `up` = 与**后一个**交换（i+1）——第一版写反实测抓出。

---

## 5. 统一编辑栈 —— `src/editor/editor-stack.ts`（118 行，独立可测）

### 设计三要素

1. **快照式**：文档是纯数据 ⇒ 每条命令 `{before, after}` 两份 `structuredClone`；
   撤销 = 装回 `before`。文档十几层，克隆成本可忽略（diff 补丁式只有文档巨大时才值得）。
2. **唯一栈管所有工具**——不是文字一条、图片一条（验收判据：跨工具混用不乱）。
3. **合并（coalescing）**：`key` 相同 + 800ms 窗口 ⇒ 并成一条——
   打字 `type:<id>`（连打 abc = 一次 Ctrl+Z 全撤）、面板 `patch:<id>:<path>`；
   换行/改样式/移动 key 不同 ⇒ 自然断开。新编辑清空重做分支（Word 同款）。

### 核心代码（全文骨架）

```ts
export function pushCommand(stack, doc, label, key?) {
  const top = stack.done[stack.done.length - 1];
  if (key && top && top.key === key && now - top.at < MERGE_WINDOW) {
    top.after = clone(doc);        // 合并：只更新 after（before 保持最早 ⇒ 撤销落点不变）
    stack.head = top.after;
    stack.undone = [];
    return;
  }
  const cmd = { label, key, at: now, before: clone(stack.head), after: clone(doc) };
  stack.done.push(cmd);
  if (stack.done.length > stack.limit) stack.done.shift();
  stack.head = cmd.after;
  stack.undone = [];               // 新编辑清空重做分支
}
export function undo(stack) {      // 返回要装回的文档（= head 的克隆）
  const cmd = stack.done.pop(); if (!cmd) return null;
  stack.undone.push(cmd);
  stack.head = clone(cmd.before);
  return stack.head;
}
```

⭐ **头号坑（实测排查了一下午）**：`stackUndo` 返回的就是 `stack.head` 本身——
编辑器里若写 `doc = prev`，**head 与 doc 变成同一引用**：下一次编辑改 doc 连 head 一起改，
再下一次 push 的 before 就成了"已改状态"（症状：撤销后打三个字，撤一次只撤掉两个）。
⇒ 编辑器里 **`doc = cloneDoc(prev)` 再克隆一层**，head 与 doc 永远引用分离。

---

## 6. 编辑器支撑模块（每个 <300 行，纯函数优先）

| 模块 | 职责 | 关键点 |
|---|---|---|
| `gesture-math.ts` | 手势几何纯函数 | `moveBox`/`resizeBox`/`rotateDegrees` —— ⚠️ 其中 `localBoxToRect` **已不存在**（`rect` 改成画布 px 后，这对换算函数删掉了，见该文件头部注释） |
| `hit-test.ts` | 两段式命中 | 先装饰件（`hitDecoration`），再子文档（`hitLayer`/`hitDecoration`） |
| `points.ts` | 顶点纯函数 | `dragPoint`（逆旋转只算节点自己的 rotate——组带变换时 blocked 挡住）/ `insertPoint` / `removePoint` |
| `overlay.ts` | 包围盒 DOM | 角柄/旋转柄；`rotateEl` 显隐 = rotateBlocked |
| `point-overlay.ts` | 顶点圆点 DOM | 等效顶点（rect 4 角 / ellipse 24 点）也走它；hover 出"边上加点"预览 |
| `target.ts` | 子文档读写薄封装 | 编辑器不持全局 document 的关键 —— ⚠️ **孤儿**：`createTarget()` 零调用，待清理 |
| `text-runs.ts` | runs 纯变换 | 插入/删除/染色全部返回新 runs（不可变风格） |
| `text-edit.ts` | 文字态进出 | contentEditable 开关 + 光标恢复（`selAbs`） |
| `text-selection.ts` | 选区换算 | 屏幕点 → 绝对偏移（跨 run）；Word 式拖选 |
| `inspector.ts` | 面板字段 | `fieldsFor(node, canvas)` 返回字段清单（**文字有防漏断言：37 个字段一个不能少**） |
| `types.ts` | 编辑器契约 | 不 import React 外壳（依赖方向 ui → editor） |

---

## 7. 宿主 —— `src/demo/vector/main.ts`（1009 行）+ `doc.ts`（134 行）

宿主是"编辑器如何被喂和接"的活样本。`createVocabEditor` 的四个回调：

```ts
createVocabEditor(host, wrap, subDocument(), {
  doc,
  onChange(id, next) {          // 结构变了（移动/样式/增删/升格/撤销）
    doc = next;                 // ⭐ 必须接住（编辑器内部是克隆）
    render();                   // 重渲整个子文档（iframe 内容整体替换）
    attachSubHandlers();        // 子文档换了 ⇒ 事件监听重新挂
    paintStatus(); paintPanel(); paintLayers();
  },
  onTyping(id, next) {          // 只是文字变了
    if (!id) return;
    doc = next;                 // ⭐ 必须接住，否则 patchTextDom 把刚打的字写回去
    afterTyping(id);            // 就地补 DOM + 光标恢复（段数没变不重渲）
  },
  onSelect() { ... },
  patch(id, path, value) { ... editor.patchTextDom / scheduleCommit(id, path) ... },
});
```

`render()`（锚点 `function render`，106 行）：
```ts
doc = editor.getDoc();                    // 真源在编辑器
const { html } = emitDocument(renderDoc(), { assets: DEMO_ASSETS });  // ⭐ 素材映射由宿主以值注入
// 重建子文档：d.open() / d.write(html) / d.close()（sandbox="allow-same-origin"）
```

**文字态的拦截**（demo 的 `onSubBeforeInput`）：`insertText`/`insertParagraph`/`deleteContentBackward`
全部 `preventDefault()` 后走 `editor.insertText/insertRange`——**浏览器原生撤销改 DOM 会搞乱真源**，
所以文字态里 Ctrl+Z 也在 `onSubKeyDown` 拦下走自己的栈。

**图层面板**（锚点 `function paintLayers`，512 行）：新增按钮（`data-add`）/ 行（类型中文名+id+上/下/删，
倒序）/ 点行选中（组的唯一选中途径）/ 事件委托到 `layersEl`。
⚠️ **口径已改（2026-10-16）**：`doc.layers` 现在是**图层**表 ⇒ 面板列的是**每个图层里的顶层元素**
（`listedElements()` 展开 `l.elements`），组内元素不单独成行。真正的 UI 里「图层」页是两级清单（图层 ▸ 元素）。

---

## 8. 两条可机器断言的不变量

1. **子文档里 `<script>` 数恒为 0** —— iframe 用 `sandbox="allow-same-origin"`，**故意不给** `allow-scripts`
2. **`src/editor/` 不引用任何全局网页对象** —— 文档对象一律从参数流入（这就是"编辑器改不到父页面"的结构性保证）

```bash
# ② 的断言：期望 0 命中
grep -rn "\b(document|window)\b" src/editor/ --include="*.ts" | grep -v "editor.document\|contentDocument"
```

---

## 9. 测试（`npm test`）

**断言一律进 vitest，没有探针。** `scripts/_probe-*.ts` 整批已删 ——
它们"只打印、不断言"，链一切换就整批失效而无人察觉。

| 文件 | 条数 | 覆盖 |
|---|---|---|
| `test/vocab-coverage.test.ts` | 5 | **词汇 → 编译器逐字段对账**：88 个字段里有没有被静默丢弃的 |
| `test/editor-geometry.test.ts` | 33 | 编辑器几何纯函数（移动 / 缩放 / 旋转 / 坐标换算） |

---

## 10. 关键设计决策速查（跨模块的"为什么"）

| 决策 | 理由 |
|---|---|
| 编辑器住父文档，iframe 纯渲染 | shadow root 里 `@font-face` 不注册不生效（实测 1.99% 像素差全在文字层）⇒ 产物必须被当完整 document 渲染 |
| 真源是内部副本，DOM 只是投影 | 读 DOM 会把亚像素量化掉（旧实现的教训） |
| shape 统一内嵌 `<svg>` | 两条渲染路线导致渐变/阴影/描边行为分裂；统一后多边形白拿渐变和阴影 |
| 组的移动=搬子元素，旋转=组自己 | 组有 `transform` 没有 `rect` ⇒ 平移无法表达；旋转本来就是 transform 的活 |
| 升格（rect/ellipse→polygon） | 不点集化词汇（避免"点集 vs rect.w/h 两个说法"），在要编辑的那一刻转换 |
| 快照式撤销 | 文档小，克隆便宜；唯一要求是 head 与 doc **引用分离** |
| unsupported/notes 诚实报错 | 词汇→产物的覆盖缺口**可见**而非静默；同时是模型重试的反馈源 |
| 断言进 vitest，不写探针 | 探针只打印不断言 ⇒ 坏掉没人知道（实测：整批探针在链切换后全失效、无人察觉）；测试失败即非 0 退出 |
