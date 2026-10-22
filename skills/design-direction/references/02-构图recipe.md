# 02 · 构图结构

> 读这份的时机：**选结构时**。7 选 1，照抄骨架，不要手写坐标。
> 坐标一律 0–1：`x/y` 是左上角，`w/h` 是宽高；**文字只写 `x/y/w`（没有 h）**。

## 一、先选结构，不选角色

| 结构 | 图数 | 长相 | 适合的关系 |
|---|---|---|---|
| `type-led` | 0 | 纯文字 + 细线 | 标题 / 宣言 / 展览信息 |
| `full-bleed` | 1 | 满幅图 + 压暗 + 大字 | 氛围 / 单主体 |
| `split` | 1 | 左文右图 | 标题 + 一张图 |
| `two-up` | 2 | 两张等大并排 | 对比 / 前后 |
| `bleed-inset` | 2 | 满幅图 + 局部内嵌 | 大图 + 局部 |
| `three-up` | 3 | 一张大 + 两张小 | 多证据 |
| `grid` | 4 | 大图 + 三小图 | 多图 / 图集 |

**没有默认结构。** 按内容关系选：先 0 图，再 1 图，再 2 图及以上。

## 二、七个骨架

### ① `type-led` · 0 图 · 纯文字

```
kicker    x .08 y .12 w .50   fontScale .016
title     x .08 y .22 w .84   fontScale .13
rule      x .08 y .58 w .30 h .004   （shape: rect）
subtitle  x .08 y .62 w .60   fontScale .028
body      x .08 y .72 w .50   fontScale .020
footer    x .08 y .90 w .84   fontScale .014
```

### ② `full-bleed` · 1 图 · 满幅图 + 压暗 + 大字

```
image     x 0   y 0   w 1   h 1    fit cover
scrim     x 0   y .52 w 1   h .48  （shape: rect；patch 时 fill 用底部渐变，不要整块 rgba）
kicker    x .08 y .10 w .50   fontScale .016
title     x .08 y .58 w .84   fontScale .10
subtitle  x .08 y .72 w .60   fontScale .028
note      x .08 y .88 w .84   fontScale .015
```

### ③ `split` · 1 图 · 左文右图

```
image     x .50 y 0   w .50 h 1    fit cover
kicker    x .07 y .12 w .36   fontScale .016
title     x .07 y .20 w .38   fontScale .07
body      x .07 y .52 w .36   fontScale .022
labels    x .07 y .68 w .36   fontScale .017
note      x .07 y .90 w .36   fontScale .014
```

### ④ `two-up` · 2 图 · 两张等大并排 + 底部文字

```
image A   x .05 y .05 w .43 h .55  fit cover
image B   x .52 y .05 w .43 h .55  fit cover
title     x .05 y .65 w .90   fontScale .055
subtitle  x .05 y .74 w .60   fontScale .022
labels    x .05 y .82 w .90   fontScale .016
note      x .05 y .92 w .90   fontScale .013
```

### ⑤ `bleed-inset` · 2 图 · 满幅图 + 局部内嵌

**先看素材的安静区，再选文字在上还是在下。** 主体在中间时用 **text-bottom**，
别用顶部 scrim 把主体一起压暗。

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

- **只盖文字块**，高度通常 `.30–.45`；不要 `.60`——会把主体一起压掉，还会留一条硬边；
- 优先用渐变：`linear-gradient(to bottom, rgba(20,12,6,.85), rgba(20,12,6,0))`；
- 文字区必须在素材的**安静区**（暗部 / 天空 / 桌面），不在主体上。

**inset 三条纪律**：

- 不要「深色底矩形 + 细描边」浮在大图上——像贴了一块黑框；
- 要么贴边：至少贴住一条画布边（右 / 上 / 下），读成裁切延伸；
- 要么做成卡片：给明确底色 / 纸感 / 框，且 inset 图背景与框色一致。

### ⑥ `three-up` · 3 图 · 一张大 + 两张小

```
image A   x .06 y .06 w .55 h .62  fit cover
image B   x .64 y .06 w .30 h .30  fit cover
image C   x .64 y .38 w .30 h .30  fit cover
title     x .06 y .72 w .88   fontScale .060
subtitle  x .06 y .81 w .60   fontScale .022
labels    x .06 y .89 w .88   fontScale .015
```

### ⑦ `grid` · 4 图 · 大图 + 三小图

```
image A   x .06  y .05 w .88 h .48  fit cover
image B   x .06  y .56 w .27 h .19  fit cover
image C   x .355 y .56 w .27 h .19  fit cover
image D   x .65  y .56 w .29 h .19  fit cover
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
| note | .013–.018 | ≤12 词 | 日期/地点/注脚 |

**不要所有文字一个字号**——这是“单调”的第二个来源。
**字号尽量互成倍数**（如 .06 / .03 / .015），零散字号会让画面失序。

## 五、变体（只动比例和边距）

| 变体 | 怎么改 | 注意 |
|---|---|---|
| 图上下互换 | 图与文字区的 y 互换 | 保证 title 仍在视觉落点 |
| 大图放大 | 大图宽 .55 → .68，文字区让位 | 不能压到小图框 |
| 网格偏移 | 整体 x/y 各偏 .01–.02 | 偏离要有意图，不能随手 |

**变体只动比例与边距，不发明新骨架。** 真要新骨架，先确认 7 个结构都不合适。

## 六、选择纪律

- 同套图 **结构必须错开**：不能 8 张全用 `bleed-inset`，同一结构连用不超过 2 张；
- 选完把 **结构名 + 图数 + 主角** 在对话里说出来，让用户能拦；
- 如果画面平，先回 `03-排版思想.md` / `04-杠杆点.md`，**不要靠换结构解决层级问题**；
- 结构是骨架，不是死板：允许 **1–2 处故意偏离**，但**只能让杠杆点去偏**（见 03「打破网格」）。

## 七、选择顺序（先少后多）

1. **先问 0 图是否成立**：纯字体 / 纯图形 / 纯色块能不能完成任务？
2. **再问 1 图是否够**：`split` 或 `full-bleed`。
3. **只有确实需要多个独立证据**，才看 2 图及以上。
4. 示例索引：0 图 → ①；1 图 → ②/③；2 图 → ④/⑤；3 图 → ⑥；4 图 → ⑦。

> 不要因为“海报通常有图”就直接跳到 `bleed-inset`。

## 八、完整 plan 示例（挑一份改，别默认抄同一个）

> 示例只是骨架：**先按内容任务定图数**，再挑最接近的一份改。
> 坐标都是 0–1；文字只写 `x/y/w`；`asset` 一律 `@placeholder`（素材阶段再 patch）。
> 图片名与素材文件名一致（`image-main` → `image-main.png`）。

### ① `type-led`（0 图，字体主视觉）

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

### ② `split`（1 图，左文右图）

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

### ③ `full-bleed`（1 图）

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

> `scrim` 的填充留到 patch 时用渐变（见 06）；plan 里不写 `fill`。

### ④ `two-up`（2 图）

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

### ⑤ `bleed-inset`（2 图）

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

### ⑥ `three-up`（3 图）

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

### ⑦ `grid`（4 图）

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
