# 编辑器演进与产品方向（EDITOR-EVOLUTION.md）

> **状态：方案阶段，尚无实现。** `src/editor/` 目录已预留但为空。
>
> **这是项目级文档，不是模块说明。** 它记录 Vinart **编辑工具**的现状与走向  
> **类 PS** 的演进方案 —— 编辑器是本项目的**核心功能**，其演化即产品演化。  
> 实现开始后，`src/editor/README.md` 才是模块说明；本文负责"为什么这么走"。
>
> 本文所有数字与结论均为**实测**，证据索引见 §7。  
> 术语沿用 `src/workflow/design-sketch/README.md`（「渲染」= 确定性那步；「方案生成」= 调模型那步）。

---

## 一、现状：编辑工具的全部代码与文件分布

### 1.0 项目代码地图（**当前真实结构**，2026-10-10 实测）

> ⚠️ 先看这个 —— `CLAUDE.md` 的 Architecture 章节**已严重过时**（详见 §8）。

```
src/
├── config.ts              配置 / 密钥
├── main.tsx               前端入口
├── server/                HTTP 面（含 /api/layout/*、/api/sessions/*）
├── ui/                    前端四栏：会话列表 / 画布 / 检查器 / 对话
├── preview/               ⚠️ 编辑器相关（§1.1）—— 本层待拆
├── editor/                ⚠️ 已预留，**空**（§5 的 M1 落点）
├── designharness/         设计运行时（模型接入 + 上下文 + 会话 + 工具）
│   ├── context/           上下文（chat-context / compaction / image-context）
│   ├── gateway/           模型接入（client / provider / registry / fallback / resilience / type）
│   ├── memory/            ⚠️ 空
│   ├── session/           会话（chat-session / chat-store / manager / transcript）
│   ├── skills/            技能（bundled / registry / skill-tool）
│   ├── subagent/          子 agent（agent-loop / runner / spawn-tool / design-system）
│   ├── tools/             工具（design-sketch / generate-assets / render-design /
│   │                              compile-appearance / **edit-spec** / project-paths）
│   └── SESSIONS.md        会话层设计文档
├── render/                Blink 渲染（blink-renderer / embed-images / index）
├── schema/                ⚠️ **空**（`asset-order.ts` 已移至 `workflow/assetsgen/`）
└── workflow/              一条工作流一个目录
    ├── briefgen/          创意方案
    ├── design-sketch/     版式规格 + **渲染真源 `render.ts`**
    ├── appearance/        外观编译（compile.ts）
    ├── assetsgen/         素材生成（asset-order / order / image / cutout）
    └── compose/           组装出图（assemble / emit-html）
```

### 1.1 编辑器相关文件清单（2026-10-10 实测行数）

> ⚠️ **本节是 M1 之前的快照，保留作"为什么改"的原始证据。** 其中
> `src/preview/{layout-editor-script,interaction-script,extract-elements}.ts`
> **已于 2026-10-11 随 M1 全部删除**（`src/preview/` 目录已不存在）；
> `PreviewPanel.tsx` 也已重写为"父侧编辑器宿主"。当前状态看 §5.3 与 `src/editor/README.md`。

| 文件                                     | 行数   | 角色                                                                                                                          |
| -------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------- |
| `src/preview/layout-editor-script.ts`  | 351  | **唯一的编辑器实现** —— `createLayoutEditorScript()` 返回一整段 `<script>` **字符串**                                                       |
| `src/ui/PreviewPanel.tsx`              | 428  | **编辑器宿主外壳**：纯预览 + 画布视口 + 编辑器宿主，**三种责任混在一起**                                                                                 |
| `src/ui/EditPanel.tsx`                 | 194  | 图层清单（层 → 检查器）                                                                                                               |
| `src/ui/LayerInspector.tsx`            | 333  | 参数检查器（颜色解析、强调词组）                                                                                                            |
| `src/ui/layer-visibility.ts`           | 53   | `toggleHidden()` 纯函数                                                                                                        |
| `src/ui/types.ts`                      | 102  | `LayoutData` / `LayoutSpec` / `LayerAppearance` / `HostSignal`                                                              |
| `src/ui/App.tsx`                       | 1223 | **编辑状态中枢**：`layout` / `selectedLayer` / `activeWord` / `hostSignal` / `hiddenLayers` / `seqRef` / `layoutRef` / `saveTimer` |
| `src/designharness/tools/edit-spec.ts` | 273  | **AI 侧第二条编辑通路**：`read_spec` / `edit_spec`（set/add/remove），与前端 `mergePatch` 语义对齐                                             |
| `src/preview/interaction-script.ts`    | 221  | ⚠️ **旧版（`htmlCode` 世代）**，运行时不可达 —— 见 §1.4                                                                                   |
| `src/preview/extract-elements.ts`      | 82   | ⚠️ 同上                                                                                                                       |

### 1.2 数据流（现状）

```
design-sketch.json + design-appearance.json
        │
        ├─ render.ts  renderDesign(spec, appearance)        ← 唯一渲染真源（425 行）
        │       ↓ 产出 HTML（{{占位符}} 已替换）—— 实测 0 个 <script>
        │
        ├─→ 服务端 /api/layout/<name>/render  →  final.png        （导出 / 成品）
        │
        └─→ 服务端 /api/layout/<name>/data    →  { name, spec, appearance, html }
                    ↓
            PreviewPanel 组装 srcdoc：
                ① <base href="/api/sessions/<sid>/file/designs/<name>/">
                ② <script type="application/json" id="__vinart-data">        ← spec 全量
                ③ <script type="application/json" id="__vinart-appearance">  ← appearance 全量
                ④ createLayoutEditorScript()                                ← 351 行注入脚本
                    ↓  html.replace('</head>', …).replace('</body>', …)
                iframe srcdoc="…"   sandbox="allow-scripts allow-same-origin"
                    ↕ postMessage（ve:* 协议）
                React 宿主（App.tsx 状态 + EditPanel + LayerInspector）
```

**关键认识**：注入脚本不是"额外的功能"，**它就是编辑器本身**。去掉它，iframe 里只是一张死的海报。

### 1.3 协议（现状 · 全部带 `{ source: 'vinart' }` 信封）

| 方向        | 消息                | 载荷                   | 作用                                                |
| --------- | ----------------- | -------------------- | ------------------------------------------------- |
| 宿主→iframe | ~~`ve:viewport`~~ | ~~`{zoom}`~~         | ⚠️ **已于 2026-10-10 删除**（多余且是 bug 源，见 §1.5 / §4.4） |
| 宿主→iframe | `ve:select`       | `{id}`               | 图层清单点选 → 画布高亮                                     |
| 宿主→iframe | `ve:patch`        | `{id, patch}`        | 参数面板改属性，实时应用                                      |
| 宿主→iframe | `ve:set-data`     | `{spec, appearance}` | 整体替换（重载 / 撤销预留）                                   |
| 宿主→iframe | `ve:set-hidden`   | `{ids[]}`            | 图层可视性（**整集、幂等**）                                  |
| iframe→宿主 | `ve:select`       | `{id}`               | 图上点选 → 切面板                                        |
| iframe→宿主 | `ve:change`       | `{id, patch}`        | 图上操作落定（拖拽结束 / 就地改字）                               |
| iframe→宿主 | `ve:word`         | `{id, word}`         | 强调词点选（供外观编译）                                      |
| iframe→宿主 | `ve:canvas-size`  | `{width, height}`    | ⚠️ 脚本会发，**宿主当前不处理**                               |

`patch` 形状：`{ rect?, text?, fontScale?, weight?, curve?, color?, fill?, opacity?, rotate? }`

> ⚠️ **`ve:viewport` 已实测为多余，并且它引出了一个真 bug** —— 见 §4.4。  
> 它是"跨文档 / 跨进程"思维的产物，而同进程之后根本不需要坐标换算。

⚠️ **`ve:set-hidden` 是唯一不进 spec 的指令** —— 只写 `el.style.display`、不发 `ve:change`。  
理由是图层可视性属"编辑器视角态"：一旦落进 spec，那 **1.5 s 防抖自动保存**会把它写盘，  
渲染器就会当版式数据用。传整集而非增量，是为了三个场景都能幂等重放（iframe 重载重建 /  
solo 一次改多层 / 宿主与 iframe 谁先就绪都无所谓）。

### 1.4 已经死掉的一代（清场对象，别照着改）

`htmlCode` 世代：`App.tsx:106` 写着 `const [htmlCode] = useState<string | undefined>(undefined)`  
—— **只赋初值、从不更新**；`PreviewPanel` 收到的恒为 `undefined`（`:1114` `htmlCode={layout ? undefined : htmlCode}`）。

→ 所以 `extract-elements.ts` / `interaction-script.ts` **不是 0 引用，而是入口被掐断**  
（`PreviewPanel.tsx:2-3` 还 import 着它们）。  
→ 连带 `PreviewPanel` 内 `elements`、`fitToCanvas(htmlCode)` 等分支全部**运行时不可达**，  
`onExport` 也恒为 `undefined`（`:1134`）。

### 1.5 已修复的缺陷：拖拽/缩放位移随 zoom 放大 1/zoom 倍（2026-10-10 发现并修掉）

> **状态：✅ 已修复（2026-10-10）。** 修法 = 删掉两处 `/ ZOOM`，  
> 并**同时删除 `ve:viewport` 消息**（它是 `ZOOM` 变量的唯一用途）+ 清理死变量 `var type`。  
> `tsc --noEmit` 0 错误；探针全部转绿（证据见 §7）。

`layout-editor-script.ts` 的 `applyMove` / `applyResize` 里有一处除以 `ZOOM`：

```js
var nx = drag.ox + (e.clientX - drag.x) / ZOOM;   // move   ← 已删
var dx = (e.clientX - rsz.x) / ZOOM;              // resize ← 已删
```

**这个除法是错的** —— iframe 内部的 `clientX` **本来就是 local 坐标**（不受父级 `scale(zoom)` 影响）。  
实测（真实产物 POSTER01 + **真实注入脚本** + 真实父级 transform，手拖 30 屏幕像素）：

| zoom | 手拖（屏幕 px） | 应移动（local px） | 修复前                 | 修复后       |
| ---- | --------- | ------------- | ------------------- | --------- |
| 1.0  | 30        | 30            | 30 ✓                | 30 ✓      |
| 0.5  | 30        | 60            | **120**（2× 过快）      | **60** ✓  |
| 0.3  | 30        | 100           | **333.3**（3.33× 过快） | **100** ✓ |

- 典型 `fitToCanvas` 出来的 zoom ≈ 0.3–0.4 → 修前**拖拽手感快 2.5–3.3 倍**。
- `applyResize`（四角缩放）同因同病；`applyRotate` 用的是**角度**，尺度无关，**不受影响**。
- **根因不是"算错"，是架构错位**：`/ZOOM` 是"以为自己跨了文档、坐标被父级缩放过"的补偿，  
  而实际上浏览器已经把坐标换算好了。**去掉补偿 = `ve:viewport` 也没有存在理由。**

**最强验证（真实 app，不是复刻）**：起 dev server 打开会话 → 画廊选 POSTER01 → 真实 zoom = **0.300463**，  
图上点选 `title_cn` 后拖 **24 屏幕像素** → `left: 222 → 302`（Δ=80，理论 24/0.300463 = **79.9**）。  
修复前该处会是 **266**。全程 0 运行时错误。

### 1.6 ~~已发现、修法已定但尚未实施：拖拽没有 pointer capture~~ → **❌ 已于 2026-10-11 实测否掉**

> **原结论（作废）**：拖拽没有 `setPointerCapture` ⇒ 鼠标移出 iframe 边界子文档就收不到 `mousemove`，  
> 拖拽静默停止。来源是端到端探针里把 `se` 手柄往右拖（`zoom=0.3`）→ 位移恒为 0。

**2026-10-11 重测（`probe-handle-capture.cjs`）**：每个场景**全新挂载**，真实产物 + 真实编辑脚本，  
`zoom = 1 / 0.5 / 0.3` 各三场：

| 场景 | 动作                       | zoom=1              | zoom=0.5            | zoom=0.3            |
| -- | ------------------------ | ------------------- | ------------------- | ------------------- |
| A  | 从 `se` 柄按下 → **框内**拖     | ✓ Δ=40.0 / 40.0     | ✓ Δ=80.0 / 80.0     | ✓ Δ=133.0 / 133.3   |
| B  | 从 `se` 柄按下 → **拖到框外**松手  | ✓ Δ=62.0 / 62.0     | ✓ Δ=217.0 / 217.0   | ✓ Δ=350.0 / 350.3   |
| C  | 从**图层本体**按下 → **拖到框外**松手 | ✓ Δ=1142.1 / 1141.8 | ✓ Δ=1315.3 / 1315.0 | ✓ Δ=1502.3 / 1502.5 |

**9/9 全部跟手**（且 `ve:change` 照常发出 = 状态照常提交）。  
→ **没有"拖出边界即断"这回事。** 根因：**Chrome 对 `mousedown` 所在的那个 frame 做了隐式鼠标捕获**  
—— 指针离开 iframe 可视盒之后，子文档**仍然**持续收到 `mousemove` 与 `mouseup`  
（`probe-lostcommit.cjs` 里指针在框外 page x=950 处，子文档仍收到 local x=1900 的 move，  
并在框外松手时正常发出 `ve:change`）。

⚠️ **原结论为什么错**：那次探针把一次 **resize**（只吃 `Δx`）的位移按 **2D 距离**去比  
—— 而它当时是**斜着**拖出边界的，于是"实际变化"永远小于"理论值"，看起来像卡住。  
（本轮我自己先犯了**同一个错**，见 `probe-handle-capture.cjs` 第一次运行的汇总表，9 项全报"未跟手"；  
换成 `Δx` 口径后 9/9 通过。）**这是量度口径错误，不是产品缺陷。**

**结论：`setPointerCapture` 不是"修 bug"，而是"把隐式行为变成显式行为"**（顺带消掉跨 frame 的隐式捕获，  
让坐标与生命周期全在父侧一处可推理）。M1 覆盖层上仍然照常 `setPointerCapture`，但理由变了：  
~~修 §1.6~~ → **契约清晰**。§5.2 的收益表已同步更正。

---

## 二、为什么"不专业" —— 三个结构性问题

1. **编辑器没有自己的层**。逻辑被劈成三份：图上操作在 351 行注入字符串里、参数编辑在 React 组件里、  
   状态在 `App.tsx`（1223 行）里。**没有单一入口、没有工具状态机、没有命令栈。**
2. **`PreviewPanel` 身兼三职** —— 纯预览 / 画布视口（zoom·pan）/ 编辑器宿主。三者互相污染，  
   想换任何一个都必须动同一个文件。
3. **能力上限被 DOM 锁死**。笔刷、液化、蒙版、通道都需要**像素访问**，而 `contentDocument` 里的  
   DOM 没有像素。

---

## 三、目标：类 PS（用户 2026-10-10 明确）

- **真 PS 级别**，不是"长得像 PS 的 UI"。
- 编辑器是**核心功能**，不是附属小工具。
- 目标能力：撤销/重做、工具状态机、图层分组/顺序/锁定、吸附对齐、多选、笔刷、液化。
- **硬约束（用户要求）**：编辑器只能作用于**子文档**，**不得修改父页面**。

---

## 四、已用实验 / 探针固化的判断

### 4.1 iframe vs Shadow DOM（**2026-10-11 重测，原结论部分更正**）

先给结论：**iframe 是对的，但当初给的理由里有一条站不住、有一条已经自然消失，  
真正承重的那条本轮才测出来。**

|                  | iframe                                     | Shadow DOM                     |
| ---------------- | ------------------------------------------ | ------------------------------ |
| 文档               | **独立 document**                            | 同一个 document                   |
| JS 环境            | **独立 window**（但 `allow-same-origin` 下父可访问） | **共享 window**                  |
| 样式隔离             | 天然完全隔离                                     | 作用域隔离，但**继承仍穿透**               |
| 尺寸               | 两套坐标系（父 / 子）                               | 单一坐标系（← 它唯一比 iframe 强的地方）      |
| `<base>` 支持      | 生效                                         | ⚠️ **被忽略**（相对路径按宿主 baseURI 解析） |
| **`@font-face`** | **生效**                                     | ⚠️⚠️ **不生效**（下面实测）             |

#### 当初三条理由的复核

| # | 当初说的                                                                                 | 复核                                                                                                                                                                                                        |
| - | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ① | 父脚本访问不到 shadow 内容，只有 iframe 才隔离得住                                                    | **已自然消失**。10-10 拍板「去注入」后，父侧本来就要直接读写子文档（§4.4）——**隔离不是需求**。且现状 `allow-same-origin` 下本来就零隔离，探针 10/10 项可访问 `contentDocument`                                                                                  |
| ② | `<base>` 在 shadow root 里被忽略                                                          | **成立**，但**可绕**（路径绝对化）。重测：iframe `baseURI→/SUB/`、`img.src→/SUB/pic.png`；shadow 宿主 `baseURI` 不变、`img.src→/pic.png`                                                                                          |
| ③ | shadow 里没有 `html`/`body` → 产物样式表的 `html,body{width/height}`、`body{font-family}` 静默失效 | **不成立。** 三臂（iframe / shadow 原样 / shadow + `:host` 兜底）实测**图层几何逐层逐值完全一致**，`.canvas{position:relative;width:1440px;height:2160px}` 自己撑尺寸，`html,body{...}` 是冗余的；而 5 个文字层的 `font-family` 由自身内联声明，不依赖 `body` 继承 |

#### 真正承重的理由（本轮新测出来）

> **shadow root 里的 `@font-face` 不注册、不生效。**

产物把 3 条 woff2 **以 data URL 内联**在自己的 `<style>` 里（`render.ts`，刻意不依赖外部文件 / CDN）。  
把**同一份** `<style>` 放进三种宿主，用同段文字分别量 `'Bitter',serif` 与裸 `serif` 的 advance 宽度  
（**两者相等 ⇒ 自定义字体没生效**）：

| arm                       | `'Bitter'` 宽 | 裸 `serif` 宽 | `document.fonts.size`                                         | 判定                       |
| ------------------------- | ------------ | ----------- | ------------------------------------------------------------- | ------------------------ |
| A) iframe `srcdoc`        | **1119.922** | 1040        | 0（父页看不到子页字体集）                                                 | ✅ 生效                     |
| B) **shadow root**        | **1040**     | 1040        | **0**                                                         | ❌ **三条 face 全部没加载，静默回退** |
| C) 宿主 `document.head`（对照） | **1119.922** | 1040        | **3**（`Bitter:loaded` / `Bitter:unloaded` / `Baloo 2:loaded`） | ✅ 生效                     |

⚠️ 顺带一条方法论：`document.fonts.check('16px Bitter')` 在 A、B 两臂**都返回 `true`**  
—— 它**不能**用来判断字体是否真的可用（族名不在集合里时它按"可能是系统字体"算可用）。  
上面的 advance 宽度对比才是可判别的量度。


用**真实产物 POSTER01**（1440×2160 · 10 层）挂 A / B 两臂截图逐像素比对，代价是**肉眼可见的**：

| 指标     | A(iframe) vs B(shadow 原样)        | A vs C(shadow + `:host` 兜底)      |
| ------ | -------------------------------- | -------------------------------- |
| 完全相同像素 | 96.7822 %                        | 96.7822 %                        |
| 差异 > 8 | **1.9976 %**（62,132 px）          | **1.9976 %**（62,132 px，**逐位相同**） |
| 最大差    | **186 / 255**                    | **186 / 255**                    |
| 首个差异点  | (670, 1285) —— 正在 `title_cn` 文字上 | 同上                               |

**>8 差异的空间分布**（按图层包围盒归属）：

| 图层          | 类型   | 差异像素   | 占该层面积   |
| ----------- | ---- | ------ | ------- |
| `title_cn`  | text | 22,324 | 9.78 %  |
| `slogan`    | text | 15,131 | 17.26 % |
| `release`   | text | 10,527 | 12.70 % |
| `credits`   | text | 9,960  | 15.95 % |
| `title_en`  | text | 4,190  | 4.25 %  |
| **层外 / 空白** | —    | **0**  | —       |

→ **100.00 % 的差异落在文字层内，背景 / 图片 / 空白区零差异**。即：不是"差一点点"，  
是**整张海报的文字换了一套字体**。

⚠️ **加 `:host` 兜底救不回来**（A vs C 的数字与 A vs B 逐位相同）——  
丢的不是"继承来的 `font-family`"，是 `@font-face` 本身压根没进字体集。

#### 三条逃生口都要"改父页面"，直接违反硬约束

| 逃生口                                               | 代价                                               |
| ------------------------------------------------- | ------------------------------------------------ |
| 把 `@font-face` 从 shadow 里**提**到宿主 `document.head` | **修改父文档**（违反 §三 硬约束）+ 还得把产物自带 CSS 再解析一遍          |
| 宿主 `document.fonts.add(new FontFace(...))`        | 同上                                               |
| 给每个文字节点补内联字体                                      | 等于把 `@font-face` 的 data URL 复制 N 份，且**永远和产物源漂移** |

三条的本质都一样：**把产物「自带字体、自包含」这条设计拆掉**。

#### 一条次要但同向的差异

**shadow 边界只挡样式规则，不挡继承。** 实测 shadow 臂里 `.canvas` 的  
`getComputedStyle().fontFamily` 变成了宿主页面的 `"Courier New", monospace`  
（探针故意给宿主 `body` 设了这个当探针）。  
本产物恰好**每个文字元素都自己声明了 `font-family`**，所以这条这次没造成像素差；  
但**只要有一个文字节点漏声明，就会静默套用宿主的字体**。

#### 结论

**保留 iframe。** 但理由必须改写：

> 不是"为了隔离"，而是——**产物必须被当作一个完整 document 来渲染**。  
> 它自带 `@font-face`、自带 `html/body` 规则、自带 `<base>` 语义，  
> 这三样**只在真 document 里成立**。

iframe（`allow-same-origin`）给的正是**一个完整的、可被父侧直接读写的 document**，零损失。

反过来说，Shadow DOM 唯一比 iframe 强的地方是**单坐标系**，  
而这一点已在 §4.4 / §4.5 用**父侧覆盖层**解决（父侧坐标只算一次）——**不值当拿字体去换**。

### 4.2 DOM → spec 反向推导不可靠

HTML 是 spec 的**有损投影**：文字自适应走了"实测两遍回填 `fits` 系数"、`{{KEY}}` 占位符替换、  
强调词丢失"是哪几个词"的信息。  
→ **保存时从活 DOM 反推 spec 会丢信息**，不能作为主路径（可作为校验 / 兜底）。

### 4.3 分层栅格化 vs 整体渲染（本轮实验，2026-10-10）

样本：真实产物 **POSTER01**（1440×2160 · 10 层）。  
方法：整体截图 **vs** 「每层单独截图 → 按序 `drawImage` 叠到 canvas」，逐像素比对（RGBA 四通道最大差）。

| 指标              | 逐层叠加 vs 整体    | 反例：`title_cn` 加 `mix-blend-mode: difference` |
| --------------- | ------------- | -------------------------------------------- |
| 完全相同像素          | **98.7906 %** | 97.9059 %                                    |
| 差异 > 8          | **0.2150 %**  | **0.9940 %**                                 |
| 平均绝对差           | 0.0583 / 255  | 1.0459 / 255                                 |
| 最大差             | 44            | **176**                                      |
| > 8 的差异落在文字层矩形内 | **100.0 %**   | —                                            |

- **自检**（排除"是不是 canvas 往返本身有损"）：整体图与半透明单层分别经  
  `getImageData → putImageData → toDataURL` 往返 = **两次都 100.0000 % identical、max diff 0**。  
  → **canvas 往返无损**，那 0.2 % 是**真实合成差异**，不是探针噪声。
- **空间分布**：差异**全部**落在文字抗锯齿边缘（差异热力图里背景照片 / 人物立绘区**零红点**）；  
  2× 放大并排看**肉眼分不出**。
- **根因**：文字边缘是半透明像素，分层后先与透明混合成 PNG 再叠加，**预乘 alpha 的舍入位置**不同。

**性能**：

| 阶段                  | 实测                                |
| ------------------- | --------------------------------- |
| 整体渲染 1 张（1440×2160） | 664 ms                            |
| 逐层截图 × 10           | 1947 ms（其中纯 DOM 显示/隐藏仅 **17 ms**） |
| **合成 10 层到 canvas** | **23.4 ms**                       |
| 跨进程搬运 + 解码 10 张 PNG | 627 ms（解码 355 / 搬运 248）           |
| 按层包围盒裁剪截图           | 仅省 **18 %**（`bg` 本就铺满）            |

- **合成几乎免费（23 ms）**，成本全在 **PNG 编解码**；每层截图有 **~30–80 ms 固定下限，与层内容无关**  
  （`rule_side` 14×656 也要 37 ms；`panel_dark` 7.6 KB 也要 64 ms）。
- **DOM 显示/隐藏一层只要 1–3 ms** —— 在 DOM 里做这件事是免费的。

> ### 结论与边界
>
> **分层成立 ⟺ 层间只有「叠加」关系，没有「互相读取」关系。**  
> `mix-blend-mode` / `backdrop-filter` / 依赖下层的滤镜是**例外**（分层截图时下层根本不在场）。
>
> **★★ 关键补充：这条边界项目里早就写好了 —— 就是契约规则 3。**  
> `src/workflow/design-sketch/README.md` §3.5 规则 3 原文：  
> 「节点不得依赖父容器来实现自身效果。不能让某个节点的外观靠父级的  
> `background` / `opacity` / `mix-blend-mode` / `filter`。每个节点必须能被单独截出来而不变样。」  
> —— **判据与实验结论逐字吻合**（连例外清单都一样）。  
> 实验的意义因此不是"发现了新风险"，而是**把一条既有的设计约定量化坐实了**：  
> 它不是纸面原则，实测差异只有 0.215%。
>
> ⚠️ **但实测发现：这条目前是"文档约定"，没有被机器强制** ——  
> `validate.ts` 里**没有任何** `mix-blend` / `backdrop` / `filter` / `opacity` 的检查；  
> 渲染器 `render.ts` 也**不产出**这些属性。  
> → 所以"扫描 34 个版式"仍是必要的前置调查（约定可能被绕过），  
> 但更划算的做法是**把规则 3 变成 `checkAppearance` 的一条硬校验**。
>
> **并且：分层不是编辑器的渲染机制，而是状态转换（vector → raster）。**  
> 编辑器里层应保持**活体 DOM**（拖拽 / 缩放 / 旋转只是 CSS transform，浏览器合成器直接干，**零栅格化成本**）；  
> **只在"该层要被像素操作"时才栅格化它**（等价 PS 里"文字图层必须栅格化才能用笔刷"的同一个动作）；  
> **导出 / 交接 PS 时才全量**（~2 s 截图 + 0.6 s 解码合成，一次性）。
>
> → 因此"**合成 A · 全 canvas**"与"**合成 B · 浏览器真叠**"**不是二选一**：  
> B 是默认态，A 是"部分层已栅格化"之后的态，**同一张时间轴上的两个阶段**。

### 4.4 坐标系统：跨文档的坐标换算**是多余的**（决定"要不要去注入"）

**实测（5 个场景：scale=1 / 0.5 / 0.3 / 0.4，含生产 `sandbox`）**：  
父级 `.canvas-wrapper` 的 `transform: scale(zoom)` **不影响** iframe 内部事件的 `clientX/clientY`  
—— 里面拿到的已经是 **local 坐标**（iframe 自身 CSS px）。  
→ **所以 `ve:viewport` 这条消息没有任何存在理由**，`/ZOOM` 是纯负担（见 §1.5）。

**同时实测**：`sandbox="allow-scripts allow-same-origin"` 下，  
**父页面可直接拿到 `iframe.contentDocument` 并改它**（5/5 通过）。  
→ **"要在子文档里跑代码"这个前提本身不成立。**

#### ⚠️ 这是一个二选一，现状两头不占

| 路线                              | 隔离                                       | 编辑器形态                            | 代价              |
| ------------------------------- | ---------------------------------------- | -------------------------------- | --------------- |
| **同源**（现状 sandbox）              | 无 JS 隔离（本来就没有）                           | **父侧编辑器**：直接操作 `contentDocument` | 需要架构约束保证"不碰父页面" |
| **真隔离**（去掉 `allow-same-origin`） | opaque origin，`contentDocument === null` | **只能**注入脚本 / postMessage         | 字符串地狱、协议、不可调试   |

**现状是"选了同源、却还在用注入"** —— 隔离没换来，字符串地狱全吃了。  
→ **去掉注入 = 把这一条路线走干净**，不是引入新风险。

#### 保留 iframe（**不要趁机换 Shadow DOM**）

⚠️ **这一节的原始论证已于 2026-10-11 更正**（详见 §4.1）：  
当初写的"`html,body` 规则静默失效"**已被实测否掉**（三臂图层几何完全一致）。  
真正撑住这条结论的是**另一条**：

> **shadow root 里的 `@font-face` 不注册、不生效。**  
> 产物自带 3 条 data-URL woff2；塞进 shadow root 后**全部回退**，  
> 真实产物逐像素比对 **1.9976 % 像素差、最大差 186、且 100 % 落在文字层**。

逃生口（提到宿主 `head` / `document.fonts.add`）都要**改父文档** → 违反硬约束。

→ **iframe 的角色收敛为「一个完整 document 的渲染宿主 + CSS 沙箱」**，  
它唯一残留的代价是父级 transform 那一层缩放 —— 而我们现在知道怎么正确处理了。

#### 隐藏收益：覆盖层可以搬出子文档

现在注入脚本把 overlay（选中框 / 四角手柄 / 旋转柄）`document.body.appendChild(ov)`  
**插进子文档**。今天无害（导出走服务端 `render_design`），  
但 **PS 化之后要分层截图时，子文档里多一个覆盖层 = 直接污染像素**。  
→ 父侧编辑器可以把它放在**父文档**里、覆盖在 iframe 上方。

---

### 4.5 「父侧覆盖层接管交互」与「sandbox 收紧」—— 两条承重假设已实测（2026-10-10）

**假设 A：iframe 退化为纯渲染器，交互由父文档覆盖层接管。**  
实测 `%TEMP%\vinart-coord\probe-overlay.cjs`（`pointer-events: auto` / `none` 两组对照）：

| 断言                                                              | 结果                              |
| --------------------------------------------------------------- | ------------------------------- |
| 覆盖层收到 `pointerdown` / `move` / `up`                             | ✓                               |
| **子文档收到指针事件次数**                                                 | **0**（覆盖层完全接管）                  |
| 覆盖层上 `setPointerCapture`                                        | ✓ 成功                            |
| 指针移到 wrap 之外（x=500，画布仅 400）仍持续收到 `move`                         | ✓ → **修掉 §1.6 的边界断裂**           |
| 子文档 `elementFromPoint()` 命中                                     | ✓ 返回最上层元素，**自动考虑遮挡与 transform** |
| `elementFromPoint` 遇 `pointer-events:none` 的子元素                 | ✓ 正确跳过                          |
| iframe 自身设 `pointer-events:none` 后，子文档 `elementFromPoint` 是否受影响 | ✓ **不受影响**                      |

> 最后两条的推论：**覆盖层绝不能留在子文档** —— 它一旦带上 `pointer-events:none`（或挡住某层），  
> `elementFromPoint` 就会跳过/命中错误。这是"覆盖层必须搬父文档"的又一硬理由。

**假设 B：sandbox 可从 `allow-scripts allow-same-origin` 收紧到只留 `allow-same-origin`。**  
实测 `probe-sandbox.cjs`：

| 配置                                    | 父侧 `contentDocument` | 子文档脚本   |
| ------------------------------------- | -------------------- | ------- |
| `allow-scripts allow-same-origin`（现状） | 可访问                  | **会执行** |
| `allow-same-origin`（建议）               | **仍可访问**             | **不执行** |

> ⚠️ **浏览器自己对现状发了告警**（实测捕获）：  
> `An iframe which has both allow-scripts and allow-same-origin for its sandbox attribute can escape its sandboxing.`  
> 收紧后告警变为 `Blocked script execution … 'allow-scripts' permission is not set` —— 保护性告警。  
> → 收紧 = 消除一个安全反模式 **且**把「产物 HTML 永不含脚本」从约定升级为**机器保证**。

**就地改字不受影响**：实测父侧可聚焦子文档的 `contentEditable`，  
`keyboard.type('HELLO')` 确实写进了子文档（覆盖层不吃键盘）。

---

## 五、编辑器改造方案（`src/editor/` 重构 · 尚未实现）

### 5.0 一句话

把编辑器从「**一段注入进子文档的字符串**」改成「**住在父文档、只把子文档当被操作对象的一层**」：  
**iframe 退化为纯渲染器**（不收事件、不含脚本），交互由**父文档的覆盖层**接管。

### 5.1 目标结构

```
父文档（React / TS）
├── .preview-canvas                    ← 视口：滚轮缩放 / 空白处（灰底）平移
│   └── .canvas-wrapper                  transform: scale(zoom)
│       ├── <iframe pointer-events:none>       ← 只渲染，sandbox="allow-same-origin"
│       └── <div data-ve-overlay>              ← 覆盖层（在父文档里）
│              选中框 / 四角手柄 / 旋转柄 / setPointerCapture
│
src/editor/                            ← 纯 TS 模块，host/wrap/root 全部由参数流入
└── types · geometry · hit-test · target ⭐ · overlay · index
```

**两条不变量**（都可用 grep / 探针机器断言）：

1. **子文档内 `<script>` 数恒为 0**（收紧 sandbox 后，即便有也不会执行）
2. **`src/editor/` 内不引用任何全局网页对象**（宿主 / 挂载点 / 子文档全部注入）

### 5.2 为什么这么改 —— 收益清单（**2026-10-11 按新证据重排**）

> ⚠️ 原表第一条「**拖拽不再卡在画布边界**」**已作废** —— §1.6 被实测否掉（9/9 场景跟手，  
> Chrome 对 mousedown 所在 frame 有隐式鼠标捕获）。`setPointerCapture` 改为**显式化契约**，不再是修 bug。

| 收益                   | 依据                                                                                                                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **覆盖层不污染像素**（**最硬**） | PS 化要**逐层截图**；覆盖层留在子文档 = 每层截图都多一块橙色虚线框/白手柄。这是搬去父文档的**根本理由**                                                                                                                         |
| **覆盖层不破坏命中测试**       | 实测（`probe-overlay-hit.cjs`）：子文档的 `elementFromPoint` 在 `se` 柄上返回 `HANDLE:se`、在选中框**边线上返回一个裸 `DIV`**（无 `data-layer`）→ `closest('[data-layer]')` 归零 ⇒ **点选中框边线会变成"取消选中"**。搬到父侧这一整类问题消失 |
| **单坐标系**             | 事件全在父侧 → 屏幕坐标 → 画布 local 只在一处算（§4.4 已证 iframe 内坐标本来就是 local，所以这是**简化**不是修复）                                                                                                         |
| **显式指针生命周期**         | `setPointerCapture` 把"隐式跨 frame 捕获"变成写在代码里的契约：`pointerdown/up/cancel` 全在父侧一处可推理，不再依赖浏览器隐式行为                                                                                         |
| **逻辑可测**             | 不再是一坨字符串：几何 / 命中 / 命令都能被 `vitest` 直接单测（项目已装）                                                                                                                                        |

### 5.3 模块划分

```
src/editor/                        ← M1 已实现（✅）+ 后续（⏳）
├── index.ts          ✅ 公开入口 createEditor(host, wrap, root, opts) → EditorHandle
├── types.ts          ✅ 契约：EditorTarget / Viewport / Hit / LayerPatch / 手势会话
├── target.ts         ⭐✅目标适配器 —— **唯一**接触 Document 的地方
├── hit-test.ts       ✅ 点 → 命中哪个 layer（两段式）
├── geometry.ts       ✅ 纯函数：rect / transform / 手柄位 / 缩放解算（vitest 直测）
├── overlay.ts        ✅ 父文档覆盖层（选中框 / 手柄 / 旋转柄）
└── commands.ts / state.ts / tools/   ⏳ M2/M3：命令栈 · 工具状态机 · 图层管理
```

⭐ **`target.ts` 是架构约束的落点**：它把"目标是谁"抽象掉 —— `Document` / `ShadowRoot` /  
未来的 canvas 容器都实现同一组方法，编辑器其余部分**不知道差别**。  
这就是"编辑器只能改子文档"的结构性保证（不是沙箱强制，见 §4.4）。

⚠️ **但注意（2026-10-11）**：`ShadowRoot` 只作为**接口上的可能性**保留 ——  
**不要**把产物渲染到 shadow root 上，理由是实测的（§4.1）：那里的 `@font-face` 不生效。  
当前唯一真实目标是 `iframe.contentDocument`。

**与预研方案的一处偏离**：原计划把 `commands.ts` / `state.ts` / `tools/` 也放进 M1。  
实际 M1 只做到"手势状态机 + 编排"（`index.ts` 内部就是那台状态机），
**命令栈与工具枚举留给 M2/M3** —— 理由是 M1 的验收判据里没有撤销，
把事务边界先钉死（D2）比先搭空壳更值。

### 5.4 三个必须拍的设计决策（**2026-10-11 补实测证据**）

#### D1 · 真源是 state，DOM 只是投影 —— **建议：拍**

**先排除一个曾经的猜测**：不是因为"会丢编辑"。实测（`probe-lostcommit.cjs`）  
连"拖出框外松手"都能正常发出 `ve:change`、宿主 state 与 DOM **差 0.0 px**（§1.6 更正）。  
所以 **D1 不是 bug 修复，是 M2（撤销）的前置条件**。

**真正的、可在代码里指出的问题：几何的"下一次输入"是从 DOM 读回来的。**

| 位置    | 代码                                                                                 | 后果                                                               |
| ----- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 移动起点  | `layout-editor-script.ts:215` `ox: parseFloat(selected.style.left)`                | 从**渲染产物**读回数值                                                    |
| 缩放起点  | `:210` `w: selected.offsetWidth, h: selected.offsetHeight`                         | ⚠️ **`offsetWidth/offsetHeight` 是四舍五入的整数** → 每次拖手柄都把亚像素尺寸**量化掉** |
| 面板改参数 | `App.tsx:497` `handleLayerPatch` → state + `ve:patch` → 子文档 `applyPatch` 写 `style` | 下一次拖拽又从 `style` 读回 ⇒ **state → DOM → state 往返**                  |

即"真源"实际是一个**渲染出来的 DOM**：它量化、且与渲染实现耦合。  
`applyResize` 里 `/ spec.canvas.width` 用的还是**子文档自己那份** canvas 尺寸镜像（宿主另有一份）。

→ **改法**：手势期间为性能直接写 `style`（绕过 React）；`pointerup` 时**提交进 state**；  
提交后由统一的 `applyState(state) → DOM` 幂等应用，**此后任何计算都不再从 DOM 读几何**。

- 收益：撤销/重做 = 换一份 state；量化消失；可序列化
- 代价：一层"state → DOM 增量应用"（`applyPatch` 的逻辑可直接移植）

#### D2 · 撤销以「手势」为粒度（事务）—— **建议：拍**


现状**完全没有撤销机制**（`grep -rn "undo|redo|history|commandStack" src/ui src/editor` → 0 命中），  
而参数面板是**每 `input` 事件就提交一次**：

| 控件                                     | 位置                           | 触发频率              |
| -------------------------------------- | ---------------------------- | ----------------- |
| `SliderField`（`<input type="range">`）  | `primitives.tsx:160`         | **持续**（拖一次几十~几百条） |
| `NumberInput`（`<input type="number">`） | `primitives.tsx:125`         | 每按键 / 长按箭头重复      |
| 透明度滑块、颜色滑块                             | `LayerInspector.tsx:245/328` | 持续                |

而每次 `onPatch` → `handleLayerPatch` → `commitLayout(...)` + `scheduleAutoSave()`  
—— **一次滑块拖拽 = 几十次 state 提交**。不做事务的话，"撤销一次"要按几十下。

→ **改法**：`beginTransaction() / commit() / abort()`。  
边界来源（都已有对应 DOM 事件，无需新状态）：

| 场景         | begin                      | commit                          |
| ---------- | -------------------------- | ------------------------------- |
| 画布拖拽/缩放/旋转 | 覆盖层 `pointerdown`          | `pointerup`（`Escape` → `abort`） |
| 滑块         | `pointerdown` / 首次 `input` | `pointerup` 或空闲防抖               |
| 数字输入       | `focus`                    | `blur` 或空闲防抖                    |
| 就地改字       | `dblclick` 进入编辑            | `blur`（`Escape` → `abort`）      |

**外加兜底**：连续同层 + 同键的 patch 做**合并**，即使某处漏了事务边界也不会把栈撑爆。

#### D3 · 命中测试用子文档 `elementFromPoint` —— **建议：拍，但必须是两段式**

实测它自动考虑 transform（`rotate` / `skewX`）、遮挡、形状，与用户看到的天生一致。  
本轮又补了两条**决定实现形状**的实测（`probe-overlay-hit.cjs`，真实产物 + 真实编辑脚本）：

| 取样点        | `childDoc.elementFromPoint` 返回 | 含义                                |
| ---------- | ------------------------------ | --------------------------------- |
| `se` 柄正中   | `HANDLE:se`                    | 覆盖层会**截胡**命中                      |
| 图层内部       | **`IMG`**（不是 `.dl`）            | ⇒ 必须 `closest('[data-layer]')` 收口 |
| 选中框**边线上** | **`DIV`**（无 `data-layer`）      | ⇒ 归零 = **点选中框边线变成取消选中**           |
| 另一图层       | `IMG`                          | 正常                                |

→ **两段式**（M1 之后指针全在父侧）：

1. **父侧覆盖层**先判：`e.target.closest('[data-ve-handle],[data-ve-rot]')` → 装饰件优先，命中即返回；
2. 否则换算 local 坐标 → `childDoc.elementFromPoint(lx, ly)?.closest('[data-layer]')`。

坐标换算不需要额外的 `zoom` 变量，从**量到的** frame 矩形自洽推出：  
`lx = (clientX − frameRect.left) × childDoc.documentElement.clientWidth / frameRect.width`。

- 备选（不采纳）：自己按 `rect` 做多边形命中 —— 纯函数、可单测，但要复刻浏览器的变换语义，**容易与渲染不一致**
- **几何换算仍是纯函数**（可测），只有"点 → 哪个 layer"这一步用浏览器
- 备选：自己按 `rect` 做多边形命中 —— 纯函数、可单测，但要复刻浏览器的变换语义，**容易与渲染不一致**
- 建议：`elementFromPoint` 为主 + `closest('[data-layer]')` 校验；**几何换算仍是纯函数**（可测）

### 5.5 分阶段（每步单独可跑、单独可看输出）

| 里程碑                       | 内容                                                                                                                                                                                     | 验收                                                                                                |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **M0 清场** ✅               | 删 `htmlCode` 世代：`interaction-script.ts` / `extract-elements.ts` / `layout-editor-script.ts` + `App.tsx` 的 `htmlCode`/`selectedElements`/`handleExport`                                       | `tsc --noEmit` 0 错；编辑功能不回退（**已随 M1 一起做，2026-10-11**）                                                  |
| **M1 去注入 + 父侧接管**（**地基**）✅ | 新增 `src/editor/{types,geometry,hit-test,target,overlay,index}`；`PreviewPanel` 改为 iframe `pointer-events:none` + 父侧覆盖层；删两个数据块 / 全部 `ve:*` / postMessage；**sandbox 收紧到 `allow-same-origin`** | **2026-10-11 全绿**：行为契约 20/20、M1 不变量 19/19、几何单测 33/33；① 子文档 `<script>`=0 ② `src/editor/` grep 0 命中 ③ zoom 0.3005/0.2504/0.2087 三档 move+resize 精确 ④ 两段式命中 + 点边线不取消选中 ⑤ 拖出画布仍跟手 |
| **M2 命令栈**                | `commands.ts` + 事务 + `Cmd/Ctrl+Z` / `Shift+Z`                                                                                                                                          | 拖一次 → 撤销一次回原位；redo 复原；跨工具混用不乱                                                                     |
| **M3 工具状态机 + 图层管理**       | 显式工具枚举 + 光标/快捷键；图层顺序（上移/下移/置顶/置底）、锁定                                                                                                                                                   | 每个工具一条几何断言；图层顺序改动能被导出保留                                                                           |
| **M4 为 PS 化铺路**           | 层模型加 `backend: 'dom' \| 'raster'`（默认 `dom`）；覆盖层已在父侧                                                                                                                                    | 标记为 raster 的层仍可选中/移动（只是不能改文字）                                                                     |

> **M1 已完成**（2026-10-11）；M2/M3 是"PS 级"的必要件；M4 不做像素编辑，只铺接口。
> §5.4 的 D1/D2/D3 已在 M1 中落地：**D1** 手势起点读内部工作副本（不再读 `offsetWidth`，
> 实测位移从"±1px 量化"变成精确值）；**D2** 一次 `pointerdown…pointerup` 恰好一条 `onChange`
> （原地单击不发提交）；**D3** `hit-test.ts` 两段式。

### 5.6 风险与未决

1. **React StrictMode / HMR 会重复 attach** → `target` 必须幂等，`dispose()` 要完整清理。  
   ✅ 已按此实现：`createEditor` 的 `dispose()` 摘掉全部监听 + `overlay.remove()` + `target.dispose()`；
   `PreviewPanel` 用**稳定的 `bind()`**（全部数据走 ref）保证只在 `srcdoc` 变化时重挂。
2. **iframe 重载（换版式）** → 现状靠 `srcdoc` 重建 + `onLoad` 重放 hidden；父侧后要在 `onLoad` 重新 bind target。  
   ✅ 已实现：`onLoad → bind()` 重新 `createEditor`（新 `contentDocument`）+ `setHidden(整集)`。
   实测（`_probe-eye-visibility.ts` §7/§9）：重载后隐藏态保留、面板选中描边照常生效。
   仍**待定**：继续"重载 iframe"还是改成"不重载、只换内容"。
3. **就地改字**是唯一必须把变更写进子文档**内容**的操作 —— 已实测与"父侧接管"不冲突（§4.5），  
   但要确保不夹带脚本。✅ 子文档 `<script>` 恒 0（无注入），改字只走 `target.setText`（innerHTML + `<br>`）。
   代价：改字期间要把 `pointer-events` **临时还给 iframe**（否则鼠标点不到光标位置），
   由 `onEditingChange` 通知 `PreviewPanel` 切换。
4. **`src/preview/` 的去向** —— ✅ 已删（三个文件全空转）。
5. **🆕 「拖拽末尾的那次 click」**（M1 实测踩到，已修）：浏览器在 down/up 落回同一元素时补发
   `click`，坐标是**松手处**。旋转柄拖完松手在层外 40px，那次 click 会把选中改成松手处的
   **另一层**（实测：旋转 `title_cn` 后面板跳到了 `panel_dark`）。  
   旧实现没这问题纯属巧合 —— 覆盖层当时在子文档里，拖到 iframe 外松手不会在子文档里产生 `click`。  
   修法：有位移或有手势的那次 click 直接吃掉（`gestureRan || pointerMoved`）。
6. **🆕 每次提交都会把 zoom/pan 打回 fit**（既有 bug，M1 顺手修掉）：`[layoutData]` 里
   `setCanvasSize({...})` 每次给新对象 ⇒ `canvasSize` 身份变 ⇒ `fitToCanvas` 身份变 ⇒
   "自适应"effect 重跑。实测：改之前连点两次缩小停在同一个值（0.2504），改后是 0.3005 / 0.2504 / 0.2087。
   修法：尺寸没变就 `return prev`。

---

## 六、未决问题（需要拍板）

### 6.1 **动 M1 之前必须拍**（它们决定 M1 的接口形状）

| # | 问题                            | 结论（2026-10-11 M1 已按此实现）                                   |
| - | ----------------------------- | --------------------------------------------------------- |
| 1 | **D1 真源**（§5.4）               | ✅ **state 真源** —— 编辑器持内部工作副本，手势起点不从渲染产物读回                 |
| 2 | **D2 撤销粒度**（§5.4）             | ✅ **事务** —— 一次 `pointerdown…pointerup` 恰好一条 `onChange`；原地单击不发提交 |
| 3 | **D3 命中测试**（§5.4）             | ✅ **两段式** —— 先装饰件、再子文档 `elementFromPoint`                 |
| 4 | **iframe 重载策略**（§5.6-2）       | ✅ 暂定**继续重载** + `onLoad` 重新 bind；"不重载、只换内容"仍待定           |
| 5 | **`src/preview/` 去向**（§5.6-4） | ✅ **已删**                                                  |

### 6.2 更远的（M4 之前）

1. **栅格化的触发条件** —— 用户显式（"转为位图"按钮）还是操作隐式（第一次用笔刷）？
2. **栅格化后能否回退** —— PS 的"智能对象"思路（编辑时临时激活 DOM 层、改完再栅格化）？  
   这决定要不要做"活体 DOM ↔ 位图"**双向**转换，还是单向不可逆。
3. **多选整体变换的坐标系** —— 单坐标系（§4.4）之后，这条是否已自然消解？（待确认，可能已不是问题）
4. **34 个版式的跨层效果普查** —— 或更划算的：把契约规则 3 做成 `checkAppearance` 硬校验（§4.3 ★★）。

### 6.3 待清的小尾巴

1. `ve:canvas-size` 宿主当前不处理 —— 很可能属 §1.4 的 `htmlCode` 世代，**M0 清场时一并确认**。
2. ~~§1.5 的 zoom bug~~ → **✅ 已修（2026-10-10）**
3. ~~覆盖层何时搬父文档~~ → **已定：M1 就搬**（§4.5 的实测把必要性坐实了）
4. ~~§1.6 pointer capture 缺失~~ → **已定：M1 由「父侧覆盖层 + `setPointerCapture`」修掉**（§4.5 已验证）

---

## 七、证据索引

| 结论                                              | 证据                                                                                                                                                                                  |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M1 已落地：功能无回退**（2026-10-11）                    | `scripts/_probe-editor-behaviour.ts` **20/20**（真实 app + 真实产物 POSTER01）。基线数值见 `.workbuddy/memory/DETAILS.md §14.6`                                                                    |
| **M1 已落地：四条不变量**                                | `scripts/_probe-m1-invariants.ts` **19/19**：子文档 `<script>`=0、无覆盖层残留、`src/editor/` grep 0 命中、三档 zoom 位移精确、两段式命中、点边线不取消选中、拖出画布仍跟手                                              |
| **几何层可脱离浏览器验证**                                  | `npm test` → `test/editor-geometry.test.ts` **33/33**（坐标换算 / 比例↔px / move·resize·rotate 解算 / 命中两段式，用最小假 DOM）                                                                            |
| 拖拽末尾的 `click` 会误改选中（**已修**）                      | 同上一支探针：修之前第 5 组 patch 落到 `panel_dark`（面板被旋转拖拽末尾的 click 改选中了）；修后 20/20                                                                                                            |
| 每次提交把 zoom 打回 fit（**既有 bug，已修**）                 | 同上一支探针第 ③ 组：修前连点两次缩小都停在 `0.2504`；修后 `0.3005 / 0.2504 / 0.2087` 三档                                                                                                          |
| **父页面可直接操作 iframe `contentDocument`**               | 探针 10/10 通过（临时目录，已清理）                                                                                                                                                               |
| **Shadow DOM 忽略 `<base>`**（重测 · 真实 origin）      | `%TEMP%\vinart-coord\probe-fontface-base.cjs`：iframe `baseURI=http://127.0.0.1:P/SUB/`、`img→/SUB/pic.png`；shadow 宿主仍为 `/`、`img→/pic.png`（对照：把 `<base>` 放进宿主 head 才变成 `/SUB/`）       |
| **shadow root 里的 `@font-face` 不生效**（承重结论）       | 同上：`'Bitter'` advance 宽 iframe=**1119.922** / shadow=**1040**（= 裸 serif，即回退）；`document.fonts.size` iframe 0 / shadow **0** / 宿主 head 3。⚠️ `document.fonts.check()` 两臂都 true，**不可用** |
| **shadow 渲染真实产物 → 可见像素差**                       | `%TEMP%\vinart-coord\probe-shadow-vs-iframe.cjs`：A/B = 96.7822 % 同、>8 差 1.9976 %（62,132 px）、max 186；`:host` 兜底无效（A/C 与 A/B 逐位相同）；产物图 `arm-iframe.png` / `arm-shadow.png`            |
| **差异在标题区肉眼可辨**（iframe 是 Bitter 粗体，shadow 掉成细衬线） | `%TEMP%\vinart-coord\crop-compare.cjs` → `crop-title-compare.png`（`title_cn` 区域上下拼）                                                                                                 |
| **差异空间分布 100 % 在文字层**                           | `%TEMP%\vinart-coord\diff-spatial.cjs`：`title_cn` 22,324 / `slogan` 15,131 / `release` 10,527 / `credits` 9,960 / `title_en` 4,190；**层外 0 px**                                      |
| **产物 `html,body` 规则对画布是冗余的**（否掉旧理由）             | `probe-shadow-vs-iframe.cjs` 三臂 `.canvas` 盒子均为 `1440×2160`、10 层几何逐值相同 → `html,body{width,height}` 不影响渲染                                                                             |
| 产物 HTML 含 **0 个 `<script>`**                    | `layout.json` 实测：`<script>`×0、`<style>`×1、`data-layer`×40                                                                                                                           |
| `htmlCode` 世代不可达                                | `App.tsx:106` 只赋初值；`:1114` 恒传 `undefined`                                                                                                                                           |
| 分层栅格化保真度 98.79 %                                | `%TEMP%\vinart-layer-exp\`：`probe.cjs`、`diff-map.png`、`zoom-compare.png`                                                                                                            |
| 分层性能数据                                          | 同上：`timing2.cjs`、`timing3.cjs`                                                                                                                                                      |
| 契约规则 3 未被机器强制                                   | `grep mix-blend\|backdrop\|filter\|opacity src/workflow/design-sketch/validate.ts` → 无匹配                                                                                            |
| 渲染器不产出跨层效果                                      | `grep -rn "mix-blend\|backdrop-filter" src/workflow/ src/ui/ src/editor/` → 仅注释                                                                                                    |
| **iframe 内 clientX 是 local 坐标**                 | `%TEMP%\vinart-coord\probe.cjs`（5 场景：scale 1/0.5/0.3/0.4 + 生产 sandbox，全一致）                                                                                                          |
| **拖拽位移随 zoom 放大 1/zoom 倍**                      | `%TEMP%\vinart-coord\e2e-edit.cjs`（真实脚本 + 真实产物；修前 zoom=0.3 时 Δ=333.3 应为 100，修后 Δ=100）                                                                                               |
| **修复在真实 app 上验证通过**                             | `%TEMP%\vinart-coord\real-app-e2e.cjs`：真实 zoom=0.300463，拖 24 屏幕 px → Δ=80（理论 79.9；修复前会是 266）                                                                                        |
| 拖出 iframe 边界即停止（无 pointer capture）              | `e2e-edit.cjs` 里 `se` 手柄向外拖 Δ≡0，向内拖正常                                                                                                                                               |
| **父侧覆盖层可完全接管交互**                                | `%TEMP%\vinart-coord\probe-overlay.cjs`：子文档收事件 **0** 次；`setPointerCapture` 后指针到 x=500（画布 400）仍收 move；子文档 `elementFromPoint` 不受 iframe `pointer-events:none` 影响                      |
| **sandbox 可收紧到 `allow-same-origin`**            | `%TEMP%\vinart-coord\probe-sandbox.cjs`：父侧仍可访问 `contentDocument`，子文档脚本**不执行**；现状配置浏览器自报警"can escape its sandboxing"                                                                 |
| **就地改字与父侧接管不冲突**                                | 同上：父侧聚焦子文档 `contentEditable` 后 `keyboard.type('HELLO')` 写入成功                                                                                                                        |
| 产物 CSS 里有 `html,body` 规则（**但已证其为冗余**）           | `render.ts:385-386`；产物样式表实测匹配到 2 条；渲染影响见 §4.1 三臂实测                                                                                                                                  |
| 渲染真源                                            | `src/workflow/design-sketch/render.ts`（`renderDesign`，425 行）                                                                                                                        |

---

## 八、相关文档

| 文档                                                    | 关系                                     |
| ----------------------------------------------------- | -------------------------------------- |
| `CLAUDE.md`                                           | 项目总览（✅ 已于 2026-10-10 全量重写，与本文一致）       |
| `src/workflow/design-sketch/README.md`                | 渲染真源所在阶段（spec → HTML，纯函数）。**改那里之前先读它** |
| `src/workflow/{briefgen,compose,assetsgen}/README.md` | 链路上的其它阶段                               |
| `src/designharness/SESSIONS.md`                       | 会话层设计（同类"带状态横幅的设计文档"，格式参照）             |
| `scripts/_probe-*.ts`                                 | 项目探针惯例；本文实验探针**尚未移植进来**（见 §7 ⚠️）       |

> ⚠️ **实测遗留的文档过时项**：`src/workflow/design-sketch/README.md` §七 仍写  
> 「`src/schema/` 只剩 `asset-order.ts`」——实际 `src/schema/` **已空**，  
> `asset-order.ts` 在 `workflow/assetsgen/`。另：`src/schema/` 与 `src/designharness/memory/`  
> 是**空目录**，用途待定。
