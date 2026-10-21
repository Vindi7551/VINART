---
name: layout-planning
description: 写 sketch_plan 的 plan（画布 / 图层 / 四类元素的结构、0–1 坐标与约束）
whenToUse: 用户要做新设计、需要新建版式（调 sketch_plan）时
---

# 版式 plan 怎么写

调 `sketch_plan` **之前**读这一份。plan 只决定**结构 / 位置 / 占位**，
不决定颜色、字体、阴影——那些是后面 `patch_doc` 的事。

## 结构

```
canvas:
  ratio: '1:1' | '4:5' | '3:4' | '16:9' | '9:16'
  background?: CSS 颜色（默认白；要底色写这里）

layers: [{ name, elements: [...] }]   // 数组顺序 = 叠放顺序
```

## 四类元素

```
text:  { type:'text', name, rect:{x,y,w}, align?, fontScale?, wrap?, placeholder? }
       rect 只有 x/y/w，**没有 h**（高度由排版决定）；
       fontScale 是字号比例（相对画布宽，不写默认 0.022）；
       align: left | center | right | justify；
       wrap: normal（默认，在 w 内换行）| nowrap（单行）。

image: { type:'image', name, rect:{x,y,w,h}, asset?, fit? }
       asset 缺省 @placeholder；素材生成后用 patch_doc 指向文件名；
       fit: cover（默认，铺满裁切）| contain（完整放入）| fill（拉伸）。

svg:   { type:'svg', name, rect:{x,y,w,h}, asset? }
       线框图标用；fill 用来染色（SVG 内部用 currentColor）。

shape: { type:'shape', kind:'rect'|'ellipse', name, rect:{x,y,w,h} }
       真正的设计形状（面板 / 徽章 / 装饰），**不是画布底色**。
```

## 约束（硬）

- 一律 **0–1 归一化** rect；不要写 px。
- 不写 `fill` / 字体 / 阴影 / 透明度 / effects——plan 不管外观。
- **不暴露 group**：需要“一组”时用图层（layers）表达。
- shape **只支持 `rect` / `ellipse`**，不要 `polygon` / `path`。
- `name` 是自由标签（`title` / `hero` / `主标题` 都行），不要指望它决定字号。
- 占位文案写**可读短样例**；占位图用 `@placeholder`。
- 画布底色用 `canvas.background`，**不要**加一个铺满画布的 shape。

## 常见错误

| 错误 | 后果 |
|---|---|
| 用铺满画布的 `shape` 当背景 | 多一个节点、层级混乱；应写 `canvas.background` |
| 给 `text` 写 `h` 或 px 字号 | plan 校验不过 / 字号被忽略 |
| 用 `polygon` / `path` | plan 不支持，会被拒 |
| 用 `group` | plan 不暴露 group |
| 生成前就把 `asset` 写成真实文件名 | 渲染断图；生成前用 `@placeholder` |
| 图层顺序随手排 | layers 的顺序就是叠放顺序，前面的在下、后面的在上 |

## 调用与后续

- `sketch_plan({ plan, layout })`；`layout` 必须是**新名字**（如 `coffee-brand-poster-02`），
  已存在会报错、不写盘。
- 成功返回 `layout`：同一轮后续 `get_design` / `patch_doc` / `generate_assets`
  都用它，**不要假设 active 已经切过去**。
- plan 落成的是草稿：颜色、字体、素材后续用 `patch_doc` 改；
  换素材不要重跑 `sketch_plan`。
