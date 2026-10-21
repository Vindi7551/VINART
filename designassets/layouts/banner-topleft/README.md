# banner-topleft

> ⚠️ **旧契约流程，相关工具已删除（2026-10-16）。** 下面提到的 `render_sketch` / `generate_assets` /
> `render_design` 都已不存在（`design-sketch` / `design-appearance` 契约整层删除）。
> 本目录的 `design-sketch.json` / `design-appearance.json` / `sketch.html` 只是**历史存档**
> （文中提到的 `sketch.png` 也已不在），现在**没有任何代码读它们**。
> 当前文档模型与落盘口径见 [`src/document/README.md`](../../../src/document/README.md)（`doc.json`）。
> 下文保留原样，作当时的流程记录。

图片1 复刻 — Geschenk zum 40. Geburtstag（生日派对赠礼场景）

## 版式结构

- 画布：2000×2000
- 配色：`warm-copper`
- 背景：全幅单场景
- 覆盖层：
  - 场景底图（scene.png）
  - 笔刷横幅「GESCHENK ZUM / 40. GEBURTSTAG」
  - 副文案「Für Papa, Ehemann, Freund oder Kollegen」

## 文件

| 文件 | 用途 |
|---|---|
| `design-sketch.json` | **版式契约实例**（改版式改这个） |
| `assets.json` | 素材订单：生图提示词与参考图角色（没有则无需生成素材） |
| `sketch.png` | 版式草图渲染，挑版式时看这个 |

> 草图是**通用蓝图**：商品位置只用虚线框（`PRODUKT`）标注，**不含任何具体商品图**。
> 具体商品由生图阶段单独传的**商品参考图**交代——所以同一份版式可以直接套用到别的产品。

## 用法

这个版式由产品链路的**对话**流程使用（`amazon-listing` 技能手册）：主 AI 读
`design-sketch.json` → `render_sketch` 渲草图 → `generate_assets` 出素材 →
`render_design` 渲成品。

⚠️ 旧的 `npm run step scripts/step-layout.ts -- … sketch gen final` 命令已于
2026-10-09 删除——而且它写的 `scripts/` 路径本就失效，照抄只会报"找不到文件"。
