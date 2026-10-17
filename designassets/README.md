# designassets —— 版式库与元素库

> ⚠️ **旧契约流程，相关工具已删除（2026-10-16）。本文下半部分"怎么出图"的口径已作废，照做跑不出东西。**
>
> 文中提到的 `render_sketch` / `generate_assets` / `render_design` / `compile_appearance` 等工具，
> 以及这些路径 **都已不存在**：`src/workflow/design-sketch/`（含 `render.ts`）、
> `src/workflow/appearance/`、`src/workflow/compose/`、`src/render/declarative/`、
> `src/document/design-sketch.ts`、`src/document/design-appearance.ts`。
> 现在**唯一的文档模型**是 `src/document/vocabulary.ts`，落盘只有一份 `doc.json`
> （口径见 [`src/document/README.md`](../src/document/README.md)）；
> 素材生成（`src/workflow/assetsgen/`）也已经改成吃 `DesignDocument`。
>
> 下面**仍然有效**的是资产本身：目录结构、入库规则、元素 / 字体 / 配色的用法。
> **失效**的是"用哪个工具把版式渲成草图 / 成品"那几段。
> 各 `layouts/<名>/` 里的 `design-sketch.json` / `design-appearance.json` / `sketch.html`
> 是**历史存档**，现在没有任何代码读它们。

设计资产集中在这里。分两类：**版式**（可挑着复用的整套版面）和**元素**（版式的零件）。

```
designassets/
  layouts/          ← 版式库：**只有沉淀为资产的版面**（如参考图复刻）
    <name>/            ⚠️ 分析链跑出的工作版式（PT 系列）在 test_product/layout/，
      design-sketch.json  版式契约实例
      assets.json         素材订单（生图请求）
      sketch.png
      README.md
  elements/         ← 元素库
    palette/          配色方案 JSON
    icons/            图标 SVG（15 个）
    textures/         纹理素材（如笔刷 PNG）
  fonts/            ← 字体库
    families/<Family>/  family.json + <字重>.woff2
    schemes/<方案>.json  命名排版方案（规格用 fontScheme 引用）
  README.md
```

## 三条产品线的关系

**版式 × 配色 × 排版 = 三个正交参数。** 版式规格用三个名字引用它们：

```json
{
  "name": "banner-topleft",
  "palette": "warm-copper",
  "fontScheme": "slab-bitter",
  ...
}
```

所以「换配色」「换字体」都不需要改版式结构，反之亦然。

## ⚠️ 入库规则（designassets ≠ 工作产物）

| 目录 | 语义 | 谁决定 |
|---|---|---|
| `designassets/` | **用户认定有价值的可沉淀资产**（参考图复刻的版式、字体、图标、配色、纹理） | 用户 |
| `test_product/` | **分析链跑出的工作产物**（PT 系列的版式与图） | 管线 |

**入库规则 = 策展，不是自动倒库**：只有**用户认定有价值**的版式才进
`designassets/layouts/`。工作版式（`test_product/layout/<名>/`）跑多少次都不进库。

> 2026-09-28 教训：曾把分析链跑出的 8 个 PT 工作版式全部同步进了资产库——
> 资产库应该是**策展**的结果（用户挑过的），不是管线自动倾倒的。

⚠️ **"入库"目前没有入口**（2026-10-09）。旧机制是「spec 位于库里 → 跑 sketch 顺手
回写 spec / 草图 / 自动生成的资产卡 README」，实现在 `src/workflow/steps/step-layout.ts`
——该文件已随整层 CLI 入口删除。而且那机制的条件与当代链路**相反**（版式生在会话
工作目录，永不在库里），所以它从未真正触发过：**实测库 2 个 / 工作目录 32 个，交集为空**。
「把定稿版式提升进库」这个动作待做。

## 版式（layouts）

**一个版式 = 一套固定的区域划分 + 可变的文案。** 它描述的是"画面分几块、每块在哪、多大"，
不描述具体某个产品的内容。

### 现有版式

| 名称 | 结构 | 来源 |
|---|---|---|
| `banner-topleft` | 左上笔刷横幅（两行）+ 铜色副文案；全幅单场景 | 图片1 复刻 |
| `split-diagonal` | 上下通栏横幅 + 左右标签 + **竖直斜切**双场景 | 图片2 复刻 |

### 用版式出图

产品链路的入口是**对话**（`amazon-listing` 技能手册）：主 AI 读版式规格 → 渲草图 →
生成素材 → 渲成品。对应工具 `render_sketch` / `generate_assets` / `render_design`。

⚠️ 旧的 `npm run step scripts/step-layout.ts -- … sketch gen final` CLI 已于
2026-10-09 随 `src/workflow/steps/` 整层删除——而且它写的 `scripts/` 路径本就失效
（文件更早就迁走了），照抄命令只会报"找不到文件"。

| 阶段 | 工具 | 做什么 | 产出 |
|---|---|---|---|
| 草图 | `render_sketch` | 分区虚线框 + 灰条 + 区域标签 | `sketch.png` |
| 素材 | `generate_assets` | 把 `[商品参考图] + [草图] + 提示词` 交给生图模型 | `scene*.png` |
| 成品 | `render_design` | AI 图作底 + HTML+CSS 文字层合成 | `final.png` |

⚠️ **草图不再落盘 HTML**（2026-10-09）：草图完全可由 spec + appearance 编译出来
（`renderDesign(spec, {mode:'sketch'})`），落盘只是多一份会漂移的快照——与
`final.html`/`final.linked.html` 同理。要看草图就是 `sketch.png` 本身。

**产物落到会话工作目录的 `<项目>/designs/<名>/`，不落回库里**——库只存版式本身
（规格 + 草图 + 资产卡），产物（生成素材、成品图）留在工作目录。

### 版式与产物的分工

| | 版式库 `designassets/layouts/` | 产物 `test_product/layout/` |
|---|---|---|
| 内容 | 规格 + 草图 + HTML | 生成素材 + 成品图 |
| 复用 | 可反复挑用、**跨产品复用** | 某个产品的具体产出 |
| 关键 | 版式结构 | 具体文案与场景 |

> **草图是通用蓝图**：商品位置只用虚线框（`PRODUKT`）标注，**不含任何具体商品图**。
> 具体商品由生图阶段单独传的**商品参考图**交代——所以同一份版式可以直接套用到别的产品。
>
> 早先版本把商品抠图直接摆进草图，那是概念错误：草图就不再通用了，
> 而且模型可能直接照抄那张贴好的合成图，而不是重新生成一张光影融合自然的。

## 元素（elements）

### `palette/<名>.json`

配色由版式规格的 `palette` 字段引用（省略则用 `warm-copper`）。
驱动脚本会读 JSON 并通过 `renderLayout(spec, { palette })` 注入渲染器。

**改配色改 JSON，不要改 `banner-layout.ts` 里的兜底常量**——那份只是为了让渲染器
不依赖文件系统而保留的副本（将来浏览器预览层要复用渲染器）。

### `icons/<名>.svg`

用 `currentColor` 填充，颜色由外层的 `color` 决定。
调用方按名字引用（`badge.icon`），**不要把 SVG 源码内联进规格**——
那会让规格臃肿、图标无法复用、改图标要改所有规格。

## 字体（fonts）

**字体是参数，不是常量。** 多个家族并存，由命名方案挑选组合，版式规格引用方案名——
与配色同一套做法。

```
fonts/
  families/<Family>/
    family.json      元数据：可用字重、授权、来源、气质备注
    <字重>.woff2      latin 子集（覆盖德语 ä/ö/ü/ß）
  schemes/<方案名>.json
```

### 已入库的家族

| 家族 | 字重 | 授权 | 气质 |
|---|---|---|---|
| Bitter | 400/700/900 | OFL | 低对比、大 x-height、有墨陷细节；编辑气质 |
| Roboto Slab | 400/700/900 | Apache-2.0 | 几何骨架、偏机械；Material Design 血统 |
| Rokkitt | 400/700/900 | OFL | 几何板衬线，干净，**品牌包袱最轻** |
| Zilla Slab | 400/600/700 | OFL | 尖角衬线、略窄；Mozilla 品牌。⚠️ 最高 700 |
| Arvo | 400/700 | OFL | 几何方块衬线，**最接近 Rockwell**。⚠️ 仅两档 |
| Alfa Slab One | 400 | OFL | 极重、海报式。⚠️ 仅一档，句子一长就糊 |
| Noto Serif | 400/700/900 | OFL | ⚠️ **不是板衬线**，是过渡衬线。仅作对照 |

### 方案与用法

`slab-bitter` · `slab-rokkitt` · `slab-arvo` · `slab-zilla` · `slab-roboto` ·
`display-alfaslab` · `legacy-system`（对照，系统字体）

```bash
# 用哪套方案由版式的 design-appearance.json 的 fontScheme 字段声明
# 换方案 = 改这个字段 → 重渲（对话里的 render_design，零 API 成本）
```

**字体以内联 woff2（data URL）方式嵌入 HTML**——每个约 33KB，
换来成品 HTML 完全自包含、**换机器不变样**。这是「不再依赖系统字体栈」的落点。

## 待补

- `elements/brush/`：现在只有一种笔刷形状（`brushPath()` 用确定性伪随机抖动多边形生成）。
  多样化的毛躁度 / 角度 / 粗细需要抽成素材。
- **版式参数化**：现在库条目的文案是写死的。跨产品复用需要引入占位符（如 `{{HEADLINE}}`）。
- `elements/icons/` 现有 15 个图标，按名引用（`icon: '<名字>'`）；
  一次性装饰可直接内联 SVG（逃生舱，见 `src/schema/README.md` 3.9）。
  应改成按名引用（`badge.icon: 'knife'`），否则规格臃肿、图标无法复用。
