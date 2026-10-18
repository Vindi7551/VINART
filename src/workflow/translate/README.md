# 翻译器 —— `DesignIntent`（比例） → `DesignDocument`（px）

> **一句话**：整个项目里**唯一**该做"比例 → px"换算的地方。
> 其他地方出现这个乘法，就是回退。
>
> **2026-10-18**：`DesignIntent` / `Intent*` 类型已移到 `src/schema/intent.ts`，本文件只保留
> `translate()`；AI 的草图契约 `SketchPlan` + `planToIntent()` 在 `src/schema/plan.ts`。

---

## 一、它为什么存在

链路上有两种"单位"的需求，**互斥**：

```
  LLM 只会写比例      ← 它不知道画布多大。写 "0.06"（左边留 6%）它能做；
                        写 "54px" 它会算错 —— 这是 0–1 设计的原始动因
  编辑器 / 编译器要 px ← 它们写的是 DOM（`left:54px`）
```

⇒ 必须有"**换算发生的那一刻**"，而且**只能有一处**。那就是这里。

---

## 二、⭐ 换算只做两件事，第三件事是「什么都别做」

| 字段 | 分母 | 翻译器做什么 |
|---|---|---|
| `rect.x/y/w/h` | **画布** | ✅ 比例 × 画布 → px |
| `fontScale`（元素级 + 片段级） | **画布宽** | ✅ 比例 × 画布宽 → `fontSizePx` |
| `points` · `path.d` | 它自己的盒子 | ❌ **原样透传** |
| `radius` · `shadow.offset/blur/spread` | 盒子短边 | ❌ 原样透传 |
| `letterSpacing` · `wordSpacing` · `baselineShift` | 字号（em） | ❌ 原样透传 |
| `lineHeight` | 字号倍数 | ❌ 原样透传 |
| `transform.origin` | `rect` 自身 | ❌ 原样透传 |
| `rotate` · `skewX` · `skewY` | —— **度**（无量纲） | ❌ 原样透传（与 CSS 同口径 ⇒ 编译器零换算） |
| `scale` | —— 倍数 | ❌ 原样透传（⚠️ **文字上非法**，见 `vocabulary.ts` 的 `scale`） |
| `image.position` | 图片自己 | ❌ 原样透传 |

**最后那几行不是"暂时没做"，是永远不能做**：它们的分母是**用户正在拖的那个盒子**
（或字号）—— 一旦固化成 px，拖框缩放时形状就不跟着变了。

判据全文见 `src/document/README.md` §二（分母表）。

### 判断一个字段能不能加进"要换算"那一列

> **它的分母会被用户的编辑动作改变吗？**
> 会（盒子 / 短边 / 字号）⇒ **不许加**，它必须留在比例形态。
> 不会（只有画布）⇒ 可以换算，因为**换算一次永久有效**。

---

## 三、输入 / 产出的形态

```ts
translate(intent: DesignIntent): { doc: DesignDocument; issues: IntentIssue[] }
```

**纯函数**：不读盘、不开浏览器、不碰模型 —— 与 `emitDocument` 同一档次。

### `DesignIntent` 是怎么定义的（关键技巧）

**不手抄一份 200+ 字段的类型**，而是用类型映射从文档类型**派生**：

```ts
type IntentTextNode = Omit<TextNode, 'rect' | 'fontSizePx' | 'runs' | 'type'> &
  IntentLayerBase & { type: 'text'; runs: IntentTextRun[] };
```

⇒ 文档词汇表加字段时，意图类型**自动跟上**，不会漂移。

⚠️ **`type` 必须显式写回顶层**：`Omit` 产出的对象类型会丢掉判别联合的判别能力
（`switch (l.type)` 收不窄），每个 `case` 里的 `l` 还是整个联合。

### 它是不是一个 `.json` 文件？

**不是必须的。** `DesignIntent` 是个**类型**，从哪来（工具参数 / 文件 / 网络）是调用方的事。
"要不要落一份 `intent.json`"是**独立决策**，还没定 —— 见 CLAUDE.md 的核心链路。

---

## 四、校验：坏输入在这里拦住

`issues` 分两级（沿用 `emit.ts` 的"绝不静默丢弃"风格）：

| 级别 | 含义 | 例子 |
|---|---|---|
| `error` | 文档**不成立** | 画布宽 ≤ 0 · `id` 重复 · 缺 `rect` · 宽高 ≤ 0 · 未知 `type` · `runs` 为空 |
| `note` | 能翻，但值得提醒 | 超出画布（留白 / 出血合法）· 有文字没写字号（会走兜底） |

**调用方要先看 `issues`**：`error` 级条目意味着产出的文档有问题，
不该直接送进编辑器（用户会看到一个坏元素，而且不知道是谁弄坏的）。

出问题的位置报**路径**（`grp.children[2]`）而不是裸下标 —— 模型看到它才知道该改哪儿。

---

## 五、⚠️ 还没做的：实测

**纯算术的换算不需要"一层"——几行乘法而已。** 翻译器真正不可替代的职责是
**把"量出来的值"固化进文档**：

```
今天：fontSizePx 是算出来的（比例 × 画布宽）
      ⇒ 文字一长就冲出框（`fit.ts` 写了但零生产调用）

该做：文字装不下时**实测**，把**最终字号**写进 `fontSizePx`
      ⇒ 编辑器看到的字号 = 出图的字号（今天最痛的地方）
      ⇒ `emitDocument` 的 `fits` 参数可以整个删掉
```

**这一步需要浏览器**（`blink-renderer.newPage()` + `fit.ts` 的 `MEASURE_JS`），
所以排在纯算术之后。

失效规则（改完后该重测）：内容 / 字号 / 框宽高 / 字体 / 字重 / 字距 / 行高。

---

## 六、验收

```
node --experimental-transform-types --import ./scripts/_ts-resolve.mjs scripts/_probe-translate.ts
```

35 条断言，三条主线：

1. **换算对**：`rect` / 字号按各自画布换算；`points` / `radius` / `shadow` /
   `letterSpacing` / `lineHeight` / `position` **原样**
2. **校验能报**：7 种坏输入各自报对（含"超画布只是 note，不是 error"）
3. ⭐ **往返一致**：`比例 → px → 比例 → emit`，两份产物**逐字段相同** ——
   它同时证明"换算没丢字段"和"换算没多字段"
