# banner-topleft

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
| `sketch.html` | 草图源文件（无图片引用，单份即用） |

> 草图是**通用蓝图**：商品位置只用虚线框（`PRODUKT`）标注，**不含任何具体商品图**。
> 具体商品由生图阶段单独传的**商品参考图**交代——所以同一份版式可以直接套用到别的产品。

## 用法

```bash
# 用这个版式出图（草图 → 生图 → 成品）
npm run step scripts/step-layout.ts -- designassets/layouts/banner-topleft/design-sketch.json sketch gen final
```
