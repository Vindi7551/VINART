# 02 · 构图 recipe

> 读这份的时机：**选构图时**。7 选 1，照抄骨架，不要手写坐标。
> 坐标一律 0–1：`x/y` 是左上角，`w/h` 是宽高；**文字只写 `x/y/w`（没有 h）**。

## 一、先选槽位数，再选 recipe

| recipe | 图槽位 | 长相 | 适用 |
|---|---|---|---|
| `type-only` | 0 | 纯文字 + 细线 | 引言 / 展览信息 / 大字报 |
| `hero-overlay` | 1 | 满幅主图 + 压暗 + 大字 | 氛围 / 单主体 |
| `split-panel` | 1 | 左文右图 | 引言 / 单主体 + 信息 |
| `diptych` | 2 | 两张等大并排 | 对比 / 前后 |
| `full-bleed-inset` | 2 | 满幅主图 + 细节内嵌（文字可上可下） | 质感 / 工艺 |
| `triptych` | 3 | 主图 + 两张细节 | 工艺 / 多证据 |
| `editorial-grid` | 4 | 大图 + 三小图 | 多卖点 / 图集 |

**槽位数按内容任务选（0–4 都可能），没有默认档位。** 1 图 recipe 只用于"确实只需要一个主体"的场景；
用之前先回答：这个信息任务真的拆不出细节 / 场景 / 对比吗？

## 二、七个骨架

### ① `type-only` · 0 图 · 纯文字海报

```
kicker    x .08 y .12 w .50   fontScale .016
title     x .08 y .22 w .84   fontScale .13
rule      x .08 y .58 w .30 h .004   （shape: rect）
subtitle  x .08 y .62 w .60   fontScale .028
body      x .08 y .72 w .50   fontScale .020
footer    x .08 y .90 w .84   fontScale .014
```

### ② `hero-overlay` · 1 图 · 满幅主图 + 压暗 + 大字

```
image     x 0   y 0   w 1   h 1    fit cover
scrim     x 0   y .52 w 1   h .48  （shape: rect；patch 时 fill 用底部渐变，不要整块 rgba）
kicker    x .08 y .10 w .50   fontScale .016
title     x .08 y .58 w .84   fontScale .10
subtitle  x .08 y .72 w .60   fontScale .028
note      x .08 y .88 w .84   fontScale .015
```

### ③ `split-panel` · 1 图 · 左文右图

```
image     x .50 y 0   w .50 h 1    fit cover
kicker    x .07 y .12 w .36   fontScale .016
title     x .07 y .20 w .38   fontScale .07
body      x .07 y .52 w .36   fontScale .022
labels    x .07 y .68 w .36   fontScale .017
note      x .07 y .90 w .36   fontScale .014
```

### ④ `diptych` · 2 图 · 两张等大并排 + 底部文字

```
image A   x .05 y .05 w .43 h .55  fit cover
image B   x .52 y .05 w .43 h .55  fit cover
title     x .05 y .65 w .90   fontScale .055
subtitle  x .05 y .74 w .60   fontScale .022
labels    x .05 y .82 w .90   fontScale .016
note      x .05 y .92 w .90   fontScale .013
```

### ⑤ `full-bleed-inset` · 2 图 · 满幅主图 + 细节内嵌

**先看素材的安静区，再选文字在上还是在下。** 主体在中间（杯子 / 人物 / 产品）时，
顶部 scrim 会把主体一起压暗——用 **text-bottom**，别用 text-top。

**⑤a `text-top`（只在素材顶部是暗部 / 天空时用）**

```
image     x 0   y 0   w 1   h 1    fit cover
scrim     x 0   y 0   w 1   h .38  （只盖文字带；fill 用渐变，不要整块 rgba）
inset     x .68 y .66 w .26 h .22  fit cover
kicker    x .07 y .10 w .50   fontScale .016
title     x .07 y .16 w .55   fontScale .09
subtitle  x .07 y .38 w .42   fontScale .024
note      x .07 y .88 w .55   fontScale .015
```

**⑤b `text-bottom`（默认；素材主体在中间 / 下方是暗桌面时用）**

```
image     x 0   y 0   w 1   h 1    fit cover
inset     x .68 y .06 w .26 h .22  fit cover
kicker    x .07 y .55 w .55   fontScale .016
title     x .07 y .59 w .62   fontScale .08
subtitle  x .07 y .69 w .50   fontScale .024
note      x .07 y .90 w .62   fontScale .015
scrim     x 0   y .54 w 1   h .46  （可选；fill 用底部渐变，桌面够暗就不加）
```

**scrim 三条纪律**：

- **只盖文字块**，高度通常 `.30–.45`；**不要 `.60`**——那会把主体一起压掉，还会在 `.60` 处留一条硬边；
- 优先用渐变：`linear-gradient(to bottom, rgba(20,12,6,.85), rgba(20,12,6,0))`；
  底部同理 `to top`（`fill` 支持 CSS 渐变字符串，见 06）；
- 文字区必须在素材的**安静区**（暗部 / 天空 / 桌面），不在主体上。

### ⑥ `triptych` · 3 图 · 主图 + 两张细节

```
hero      x .06 y .06 w .55 h .62  fit cover
detail 1  x .64 y .06 w .30 h .30  fit cover
detail 2  x .64 y .38 w .30 h .30  fit cover
title     x .06 y .72 w .88   fontScale .060
subtitle  x .06 y .81 w .60   fontScale .022
labels    x .06 y .89 w .88   fontScale .015
```

### ⑦ `editorial-grid` · 4 图 · 大图 + 三小图

```
hero      x .06  y .05 w .88 h .48  fit cover
image 2   x .06  y .56 w .27 h .19  fit cover
image 3   x .355 y .56 w .27 h .19  fit cover
image 4   x .65  y .56 w .29 h .19  fit cover
title     x .06 y .79 w .88   fontScale .050
subtitle  x .06 y .86 w .70   fontScale .020
note      x .06 y .92 w .88   fontScale .013
```

## 三、比例换算（只动字号，不动骨架）

以上坐标按 **4:5 / 3:4 竖版**调。换比例时：

| 比例 | title 字号 | 正文 | 文字块 |
|---|---|---|---|
| `9:16` | 原样，可再放大一档 | 原样 | 不用挪 |
| `1:1` | × 0.75 | × 0.9 | 不用挪 |
| `16:9` | × 0.55 | × 0.8 | 整体上移 0.05–0.1 |

横版高度小，原字号会顶到下一行——**换比例必须重算字号，不要原样抄**。

## 四、字号四档（相邻档尽量 1.5–2 倍）

| 层级 | `fontScale` | 字数 | 用在哪 |
|---|---|---|---|
| title | .06–.13（大字报可到 .16） | 3–8 词 | 钩子 |
| subtitle | .024–.036 | ≤18 词 | 一句解释 |
| labels | .015–.020 | 2–4 词/条 | 部位/要素 |
| note | .013–.018 | ≤12 词 | 日期/地点/保养 |

**不要所有文字一个字号**——这是"单调"的第二个来源。
**字号尽量互成倍数**（如 .06 / .03 / .015），零散字号会让画面失序。

## 五、recipe 变体（不新增 recipe，只改比例/边距）

同一个 recipe 可以有变体，避免"同套图全长一样"：

| 变体 | 怎么做 | 注意 |
|---|---|---|
| 左右翻转 | 所有 `x` → `1 - x - w` | 文字对齐方向也要跟着翻 |
| 主图上下互换 | `hero` 与 `text` 区的 y 互换 | 保证 title 仍在视觉落点 |
| 不对称边距 | 左 .04 / 右 .12，或反向 | 不要两边都 .06，会像模板 |
| 主图放大 | `hero` 宽 .55 → .68，文字区让位 | 不能压到 detail 框 |
| 网格偏移 | 整体 x/y 各偏 .01–.02 | 偏离要有意图，不能随手 |

**变体只动比例与边距，不发明新骨架。** 真要新骨架，先确认 7 个 recipe 都不合适。

## 六、选择纪律

- 同套图 **recipe 必须错开**：不能 8 张全用 `triptych`，同一 recipe 连用不超过 2 张；
- 选完把 **recipe 名 + 槽位数 + 主角**在对话里说出来，让用户能拦；
- 如果画面平，先回 `03-排版思想.md` / `04-杠杆点.md`，**不要靠换 recipe 解决层级问题**；
- recipe 是骨架，不是死板：允许 **1–2 处故意偏离**，但**只能让杠杆点去偏**（见 03「打破网格」）。

## 七、完整 plan 示例（挑一份改，别默认抄同一个）

> 示例只是骨架：**先按内容任务定槽位数**，再挑最接近的一份改。
> 坐标都是 0–1；文字只写 `x/y/w`；`asset` 一律 `@placeholder`（素材阶段再 patch）。
> 槽位名与素材文件名一致（`slot-hero` → `slot-hero.png`）。

### ① `hero-overlay`（1 图）

```yaml
canvas: { ratio: '4:5', background: '#0E0E10' }
layers:
  - name: 主视觉
    elements:
      - { type:'image', name:'slot-hero', rect:{x:0,y:0,w:1,h:1}, asset:'@placeholder', fit:'cover' }
      - { type:'shape', kind:'rect', name:'scrim', rect:{x:0,y:.52,w:1,h:.48} }
  - name: 文字信息
    elements:
      - { type:'text', name:'kicker',   rect:{x:.08,y:.10,w:.50}, fontScale:.016, placeholder:'LIMITED' }
      - { type:'text', name:'title',    rect:{x:.08,y:.58,w:.84}, fontScale:.10,  placeholder:'夜色里的第一杯' }
      - { type:'text', name:'subtitle', rect:{x:.08,y:.72,w:.60}, fontScale:.028, placeholder:'浅烘 · 单品 · 手冲' }
      - { type:'text', name:'note',     rect:{x:.08,y:.88,w:.84}, fontScale:.015, placeholder:'2026 秋季限定' }
```

> `scrim` 的填充留到 patch 时用渐变（见 06）；plan 里不写 `fill`。

### ② `diptych`（2 图）

```yaml
canvas: { ratio: '4:5', background: '#F7F3EA' }
layers:
  - name: 主视觉
    elements:
      - { type:'image', name:'slot-a', rect:{x:.05,y:.05,w:.43,h:.55}, asset:'@placeholder', fit:'cover' }
      - { type:'image', name:'slot-b', rect:{x:.52,y:.05,w:.43,h:.55}, asset:'@placeholder', fit:'cover' }
  - name: 文字信息
    elements:
      - { type:'text', name:'title',    rect:{x:.05,y:.65,w:.90}, fontScale:.055, placeholder:'两种喝法' }
      - { type:'text', name:'subtitle', rect:{x:.05,y:.74,w:.60}, fontScale:.022, placeholder:'同一支豆子的两面' }
      - { type:'text', name:'labels',   rect:{x:.05,y:.82,w:.90}, fontScale:.016, placeholder:'热冲 · 冰滴' }
      - { type:'text', name:'note',     rect:{x:.05,y:.92,w:.90}, fontScale:.013, placeholder:'季节限定' }
```

### ③ `full-bleed-inset`（2 图）

```yaml
canvas: { ratio: '4:5', background: '#0E0E10' }
layers:
  - name: 主视觉
    elements:
      - { type:'image', name:'slot-hero',  rect:{x:0,y:0,w:1,h:1}, asset:'@placeholder', fit:'cover' }
      - { type:'image', name:'slot-inset', rect:{x:.68,y:.06,w:.26,h:.22}, asset:'@placeholder', fit:'cover' }
  - name: 文字信息
    elements:
      - { type:'text', name:'kicker',   rect:{x:.07,y:.55,w:.55}, fontScale:.016, placeholder:'SINGLE ORIGIN' }
      - { type:'text', name:'title',    rect:{x:.07,y:.59,w:.62}, fontScale:.08,  placeholder:'把产地装进杯子' }
      - { type:'text', name:'subtitle', rect:{x:.07,y:.69,w:.50}, fontScale:.024, placeholder:'浅烘 · 柑橘 · 蜂蜜' }
      - { type:'text', name:'note',     rect:{x:.07,y:.90,w:.62}, fontScale:.015, placeholder:'2026 新产季' }
```

> 主体在中间时用这份 **text-bottom**；顶部是暗部/天空才用 ⑤a 的 text-top，并可加 `scrim`。

### ④ `triptych`（3 图）

```yaml
canvas: { ratio: '4:5', background: '#F7F3EA' }
layers:
  - name: 主视觉
    elements:
      - { type:'image', name:'slot-hero',     rect:{x:.06,y:.06,w:.55,h:.62}, asset:'@placeholder', fit:'cover' }
      - { type:'image', name:'slot-detail-1', rect:{x:.64,y:.06,w:.30,h:.30}, asset:'@placeholder', fit:'cover' }
      - { type:'image', name:'slot-detail-2', rect:{x:.64,y:.38,w:.30,h:.30}, asset:'@placeholder', fit:'cover' }
  - name: 文字信息
    elements:
      - { type:'text', name:'title',    rect:{x:.06,y:.72,w:.88}, fontScale:.06,  placeholder:'手冲的清晨' }
      - { type:'text', name:'subtitle', rect:{x:.06,y:.81,w:.60}, fontScale:.022, placeholder:'一杯，从水温开始' }
      - { type:'text', name:'labels',   rect:{x:.06,y:.89,w:.88}, fontScale:.015, placeholder:'手冲 · 浅烘 · 单品' }
```

### ⑤ `editorial-grid`（4 图）

```yaml
canvas: { ratio: '4:5', background: '#F7F3EA' }
layers:
  - name: 主视觉
    elements:
      - { type:'image', name:'slot-hero', rect:{x:.06,y:.05,w:.88,h:.48},  asset:'@placeholder', fit:'cover' }
      - { type:'image', name:'slot-2',    rect:{x:.06,y:.56,w:.27,h:.19},  asset:'@placeholder', fit:'cover' }
      - { type:'image', name:'slot-3',    rect:{x:.355,y:.56,w:.27,h:.19}, asset:'@placeholder', fit:'cover' }
      - { type:'image', name:'slot-4',    rect:{x:.65,y:.56,w:.29,h:.19},  asset:'@placeholder', fit:'cover' }
  - name: 文字信息
    elements:
      - { type:'text', name:'title',    rect:{x:.06,y:.79,w:.88}, fontScale:.05,  placeholder:'一支豆子的四种表情' }
      - { type:'text', name:'subtitle', rect:{x:.06,y:.86,w:.70}, fontScale:.02,  placeholder:'从产地到杯中' }
      - { type:'text', name:'note',     rect:{x:.06,y:.92,w:.88}, fontScale:.013, placeholder:'2026 秋季系列' }
```

槽位名与后面的素材文件名一致（`slot-hero.png`），patch 时按 `get_design` 的 id 对应。
