# 完整 plan 示例（7 套）

> 本文件是 `layout-planning` 的附属示例，字段名与约束以 `SKILL.md` 为准。
> `asset` 一律 `@placeholder`，素材阶段再 patch；图片示例统一 `fit:'cover'`。
> 坐标都是 0–1；文字只写 `x/y/w`。

## ① `type-led`（0 图，字体主视觉）

```yaml
canvas: { ratio: '4:5', background: '#F7F3EA' }
layers:
  - name: 主视觉
    elements:
      - { type:'text', name:'kicker', rect:{x:.08,y:.12,w:.50}, fontScale:.016, placeholder:'独立出版 · 第 3 期' }
      - { type:'text', name:'title',  rect:{x:.08,y:.20,w:.84}, fontScale:.15,  placeholder:'夜行' }
      - { type:'shape', kind:'rect',  name:'rule', rect:{x:.08,y:.58,w:.30,h:.004} }
  - name: 文字信息
    elements:
      - { type:'text', name:'subtitle', rect:{x:.08,y:.63,w:.60}, fontScale:.028, placeholder:'一场关于城市与失眠的展览' }
      - { type:'text', name:'dates',    rect:{x:.08,y:.73,w:.50}, fontScale:.020, placeholder:'9.12 — 10.20' }
      - { type:'text', name:'note',     rect:{x:.08,y:.90,w:.84}, fontScale:.014, placeholder:'周二至周日 11:00–19:00' }
```

> 纯字体不是“没图可放”的兜底：大字号、字距、色块、细线本身就是主视觉。

## ② `split`（1 图，左文右图）

```yaml
canvas: { ratio: '4:5', background: '#F7F3EA' }
layers:
  - name: 主视觉
    elements:
      - { type:'image', name:'image-main', rect:{x:.50,y:0,w:.50,h:1}, asset:'@placeholder', fit:'cover' }
  - name: 文字信息
    elements:
      - { type:'text', name:'kicker', rect:{x:.07,y:.12,w:.36}, fontScale:.016, placeholder:'NIGHT WALK' }
      - { type:'text', name:'title',  rect:{x:.07,y:.20,w:.38}, fontScale:.07,  placeholder:'夜行' }
      - { type:'text', name:'body',   rect:{x:.07,y:.52,w:.36}, fontScale:.022, placeholder:'一场关于城市与失眠的展览' }
      - { type:'text', name:'labels', rect:{x:.07,y:.68,w:.36}, fontScale:.017, placeholder:'9.12 — 10.20' }
      - { type:'text', name:'note',   rect:{x:.07,y:.90,w:.36}, fontScale:.014, placeholder:'周二至周日 11:00–19:00' }
```

> 只有一张照片时，`split` 比 `bleed-inset` 更克制，也更容易让文字成为主角。

## ③ `full-bleed`（1 图）

```yaml
canvas: { ratio: '4:5', background: '#0E0E10' }
layers:
  - name: 主视觉
    elements:
      - { type:'image', name:'image-main', rect:{x:0,y:0,w:1,h:1}, asset:'@placeholder', fit:'cover' }
      - { type:'shape', kind:'rect', name:'scrim', rect:{x:0,y:.52,w:1,h:.48} }
  - name: 文字信息
    elements:
      - { type:'text', name:'kicker',   rect:{x:.08,y:.10,w:.50}, fontScale:.016, placeholder:'NIGHT WALK' }
      - { type:'text', name:'title',    rect:{x:.08,y:.58,w:.84}, fontScale:.10,  placeholder:'夜行' }
      - { type:'text', name:'subtitle', rect:{x:.08,y:.72,w:.60}, fontScale:.028, placeholder:'一场关于城市与失眠的展览' }
      - { type:'text', name:'note',     rect:{x:.08,y:.88,w:.84}, fontScale:.015, placeholder:'2026.09.12 — 10.20' }
```

> `scrim` 的填充留到外观阶段用渐变；plan 里不写 `fill`。

## ④ `two-up`（2 图）

```yaml
canvas: { ratio: '4:5', background: '#F7F3EA' }
layers:
  - name: 主视觉
    elements:
      - { type:'image', name:'image-a', rect:{x:.05,y:.05,w:.43,h:.55}, asset:'@placeholder', fit:'cover' }
      - { type:'image', name:'image-b', rect:{x:.52,y:.05,w:.43,h:.55}, asset:'@placeholder', fit:'cover' }
  - name: 文字信息
    elements:
      - { type:'text', name:'title',    rect:{x:.05,y:.65,w:.90}, fontScale:.055, placeholder:'两种观看' }
      - { type:'text', name:'subtitle', rect:{x:.05,y:.74,w:.60}, fontScale:.022, placeholder:'同一件作品的两种距离' }
      - { type:'text', name:'labels',   rect:{x:.05,y:.82,w:.90}, fontScale:.016, placeholder:'现场 · 手稿' }
      - { type:'text', name:'note',     rect:{x:.05,y:.92,w:.90}, fontScale:.013, placeholder:'展期限定' }
```

## ⑤ `bleed-inset`（2 图）

```yaml
canvas: { ratio: '4:5', background: '#0E0E10' }
layers:
  - name: 主视觉
    elements:
      - { type:'image', name:'image-main',  rect:{x:0,y:0,w:1,h:1}, asset:'@placeholder', fit:'cover' }
      - { type:'image', name:'image-inset', rect:{x:.68,y:.06,w:.26,h:.22}, asset:'@placeholder', fit:'cover' }
  - name: 文字信息
    elements:
      - { type:'text', name:'kicker',   rect:{x:.07,y:.55,w:.55}, fontScale:.016, placeholder:'NIGHT WALK' }
      - { type:'text', name:'title',    rect:{x:.07,y:.59,w:.62}, fontScale:.08,  placeholder:'夜行' }
      - { type:'text', name:'subtitle', rect:{x:.07,y:.69,w:.50}, fontScale:.024, placeholder:'城市 · 失眠 · 九个房间' }
      - { type:'text', name:'note',     rect:{x:.07,y:.90,w:.62}, fontScale:.015, placeholder:'2026.09.12 — 10.20' }
```

> 主体在中间时用这份 **text-bottom**；顶部是暗部/天空才用 ⑤a 的 text-top，并可加 `scrim`。

## ⑥ `three-up`（3 图）

```yaml
canvas: { ratio: '4:5', background: '#F7F3EA' }
layers:
  - name: 主视觉
    elements:
      - { type:'image', name:'image-a', rect:{x:.06,y:.06,w:.55,h:.62}, asset:'@placeholder', fit:'cover' }
      - { type:'image', name:'image-b', rect:{x:.64,y:.06,w:.30,h:.30}, asset:'@placeholder', fit:'cover' }
      - { type:'image', name:'image-c', rect:{x:.64,y:.38,w:.30,h:.30}, asset:'@placeholder', fit:'cover' }
  - name: 文字信息
    elements:
      - { type:'text', name:'title',    rect:{x:.06,y:.72,w:.88}, fontScale:.06,  placeholder:'展厅的三种光' }
      - { type:'text', name:'subtitle', rect:{x:.06,y:.81,w:.60}, fontScale:.022, placeholder:'从入口到最里面的房间' }
      - { type:'text', name:'labels',   rect:{x:.06,y:.89,w:.88}, fontScale:.015, placeholder:'装置 · 手稿 · 现场' }
```

## ⑦ `grid`（4 图）

```yaml
canvas: { ratio: '4:5', background: '#F7F3EA' }
layers:
  - name: 主视觉
    elements:
      - { type:'image', name:'image-a', rect:{x:.06,y:.05,w:.88,h:.48},  asset:'@placeholder', fit:'cover' }
      - { type:'image', name:'image-b', rect:{x:.06,y:.56,w:.27,h:.19},  asset:'@placeholder', fit:'cover' }
      - { type:'image', name:'image-c', rect:{x:.355,y:.56,w:.27,h:.19}, asset:'@placeholder', fit:'cover' }
      - { type:'image', name:'image-d', rect:{x:.65,y:.56,w:.29,h:.19},  asset:'@placeholder', fit:'cover' }
  - name: 文字信息
    elements:
      - { type:'text', name:'title',    rect:{x:.06,y:.79,w:.88}, fontScale:.05,  placeholder:'一件作品的四个局部' }
      - { type:'text', name:'subtitle', rect:{x:.06,y:.86,w:.70}, fontScale:.02,  placeholder:'从材料到现场' }
      - { type:'text', name:'note',     rect:{x:.06,y:.92,w:.88}, fontScale:.013, placeholder:'2026 春季群展' }
```
