# CLAUDE.md

本文件为在此仓库中工作的 AI 助手提供指引。

> **状态：2026-10-15 全量重写。** 上一版描述的是**已被删除的旧契约链**。
> **若发现本文件与代码不符，以代码为准，并顺手修正本文件。**

---

## 项目概览

Vinart 是一个 **AI 驱动的设计出图 agent**，TypeScript 实现。

与"直接操作图形"的传统设计 agent 不同，Vinart 把**版式与元素组合当作 HTML+CSS 代码**，
借 Blink 引擎的亚秒级渲染产出成品图。

### ⚠️ 术语：「渲染」与「方案生成」是两件不同的事

| 叫法 | 谁干 | 干什么 | 调模型？ |
|---|---|---|---|
| **渲染** | `render/vocabulary/emit.ts` | 文档(JSON) → HTML，**纯函数** | **零** —— 确定性、可复现、零成本 |
| **方案生成**（旧称"编译"） | 对话链路（主 AI + 子 agent） | 创意方案 → 文档(JSON) | **调** —— 非确定性、烧钱 |

`emit.ts` 的 import 里**没有任何 gateway**，它永远不碰模型。
（这两个概念曾混叫过一次，把"哪一步是确定性的"说岔了，别再混。）

---

## 核心链路（现状 · 2026-10-15）

```
产品照 + 卖点
  │
  ▼ ① 内容创作 —— 对话技能 `amazon-listing`（主 AI 加载手册后自己完成四步）
  │     事实锁定 → 卖点审计 → 套图规划 → 逐槽 brief
  │
  ▼ ② 方案生成（对话链路 · 调模型）—— 主 AI + 子 agent
  │     ⚠️ **这一段目前是空的**：旧契约那批工具已随契约删除（见下），
  │        要**重新对着 `vocabulary.ts` 长**。产物应当是 doc.json。
  │
  ▼ ③ 素材生成（调生图模型）—— workflow/assetsgen/
  │     产物 assets.json（素材订单）+ 素材 PNG
  │
  ▼ ④ 组装出图（**零模型调用**）
  │     emitDocument(doc) → 自包含 HTML → blink 渲 PNG
  │     ⚠️ 文字自适应（fit.ts）**还没接**，见下
  │
  ▼ final.png —— 交付 Amazon
```

### ⚠️ 2026-10-15 删掉了什么（别再重建）

老契约整层删除：`document/design-sketch.ts`（+`.md`）· `document/design-appearance.ts` ·
`document/validate.ts` · `render/declarative/` · `render/runtime.ts` ·
`workflow/appearance/` · `workflow/compose/` · 以及 harness 里踩在它上面的 6 个工具
（`spawn_design_agents` / `render_design` / `generate_assets` / `compile_appearance` /
`read_spec` / `edit_spec`）与 `subagent/design-system.ts`。

**现在只有一个文档模型：`document/vocabulary.ts`。落盘只有一份：`doc.json`。**
历史文档里的 `design-sketch.json` / `design-appearance.json` / `compile_appearance` /
`assembleFinal` **全部作废，别照抄**。

⚠️ **整条链没有生产 CLI。** 历史上曾有 `src/workflow/steps/`（step-01..04），
**2026-10-09 整层删除**。不要再重建 `step-*` 或 CLI 入口。

> `npm run step <任意.ts>` 仍可用，但它只是**通用 TS 脚本运行器**（esbuild 打包后执行），
> **不是某条固定 pipeline 的入口**。用途是跑探针 / 一次性脚本。
> ⚠️ 本机沙箱里 esbuild 起子进程会 `spawn EPERM` ⇒ 探针改用 Node 原生类型剥离跑：
> `node --experimental-transform-types --import ./scripts/_ts-resolve.mjs <脚本>`。

---

## 架构（实际目录 · 2026-10-15 实测）

```
src/
├── config.ts              配置 / 密钥（keys.json 与环境变量）
├── main.tsx               前端入口
├── server/                HTTP 面 —— /api/layout/* · /api/sessions/* · /api/models · /api/fs/* · /api/workdirs
├── ui/                    前端五栏（工具栏 + 四栏，见下）
├── editor/                ⭐编辑器（**住在父文档**，iframe 只当渲染器）
│   ├── vocab-editor.ts    createVocabEditor(host, wrap, root, opts) → VocabEditorHandle
│   ├── text-session.ts    ⭐文字就地编辑（contentEditable + beforeinput + 光标/选区记账）
│   ├── inspector.ts       字段描述（节点级 + 选区级 18 项）—— **纯描述，不碰 DOM**
│   ├── editor-stack.ts    统一撤销栈（一次手势 = 一条）
│   ├── gesture-math.ts    纯函数几何（可 vitest 直测）
│   ├── points.ts          多边形顶点三层换算（纯函数）
│   ├── text-runs.ts       选区运算（纯函数）· text-edit.ts 插删字符（纯函数）
│   ├── text-selection.ts  浏览器选区 ⇄ 文档字符下标（纯函数）
│   ├── hit-test.ts        命中测试两段式（先装饰件，再问子文档）
│   ├── overlay.ts · point-overlay.ts   父侧覆盖层（选中框 / 手柄 / 顶点圆点）
│   ├── types.ts           契约
│   ├── target.ts          ⚠️ **孤儿**（旧链宿主适配器，`createTarget` 零调用）待清理
│   └── README.md          两条可机器断言的不变量
├── designharness/         设计运行时（模型接入 + 上下文 + 会话 + 技能 + 子 agent）
│   ├── context/           上下文（chat-context · compaction · image-context）
│   ├── gateway/           模型接入（client · provider · registry · fallback · resilience · type · util）
│   ├── memory/            ⚠️ 空
│   ├── session/           会话（chat-session · chat-store · manager · transcript）
│   ├── skills/            技能（registry 三层来源 · skill-tool · types）
│   ├── subagent/          子 agent（agent-loop · runner · types）⚠️ 工具已摘，见上
│   ├── tools/             sketch-plan.ts + get-design.ts + patch-doc.ts + generate-assets.ts + project-paths.ts
│   ├── SESSIONS.md        会话层设计文档
│   └── SKILLS.md          技能层设计文档（三层来源 + 优先级 bundled>project>user）
├── document/              ⭐**唯一文档模型**
│   ├── vocabulary.ts         契约：画布 / text / image / svg / shape / group
│   └── README.md             完整规范 + **⭐分母表** ← 改这里之前先读
├── schema/                0–1 契约层（DesignIntent / SketchPlan + planToIntent）
│   ├── intent.ts             DesignIntent / Intent*（翻译器的输入契约）
│   └── plan.ts               SketchPlan（AI 子集）+ JSON Schema + planToIntent()
├── render/                渲染流水线
│   ├── vocabulary/           ② 文档 → HTML（emit.ts）+ 文字实测（fit.ts）
│   ├── rasterize/            ③ HTML → 位图（blink-renderer）
│   └── composite/            ④ 合成（**今天空着**：由 Chromium 代劳）
├── bitmap/                ⚠️ 位图能力 —— 未实现，见 `docs/HYBRID-RENDERING.md`
└── workflow/              一条工作流一个目录
    └── assetsgen/         素材生成（asset-order · order · image · cutout）
```

**逻辑真源分布**（改之前先定位）：

| 环节 | 真源 |
|---|---|
| 文档模型 | `document/vocabulary.ts`（**唯一**） |
| 0–1 契约 / 草图 | `schema/intent.ts` + `schema/plan.ts` |
| 文档 → HTML | `render/vocabulary/emit.ts` 的 `emitDocument(doc, opts)` |
| 文字自适应 | `render/vocabulary/fit.ts` 的 `emitFitted(doc, page)` |
| 编辑器 | `editor/vocab-editor.ts` + `editor/text-session.ts` |
| 素材生成 | `workflow/assetsgen/{order,image}.ts` |
| 字体库 | `src/fonts/registry.ts` + `designassets/fonts/families/`（`/api/fonts/...` 供 URL） |

### 工具集（`src/designharness/tools/`）

当前主 AI 工具：`skill` + `sketch_plan`（**只新建**版式，`layout` 必填且不能已存在）
+ `get_design`（当前 doc 语义视图，含 `frame01`/`rect01`）
+ `patch_doc`（增量改：move / size（0–1）、rotate（仅 image/svg/shape）、opacity、
  颜色/字体/asset/text；元素级、批量、all-or-nothing）
+ `generate_assets`（`images` 生图 / `icons` 主 AI 线框 SVG；只落盘、不改 doc）。
`patch_doc` 不新增/删除节点；结构变 → 新 layout 或编辑器。
`sketch_plan` 不再读 `ctx.activeLayout`；新建时有 active 只刷画廊，没有 active 才自动打开。
其余设计工具（读改文档）待重写；`workflow/assetsgen/` 已吃 `DesignDocument`，可直接复用。

---

## 关键设计决策

### 版式契约（`src/document/vocabulary.ts`）

- **五类节点**：`text` / `image` / `svg` / `shape` / `group`。除 `group` 外都必须有 `id` 与 `rect`。
- **★「框」是独立节点**，不是内容的属性：`image` 与 `shape` **位置重叠**，
  谁在上面由 `layers` 数组顺序定（前 = 底板，后 = 相框）。
  > 独立节点能被单独截出来，属性不能。
- **形状只有 4 种几何**：`rect` / `ellipse` / `polygon`（点集，**唯一可逐点编辑**）/ `path`。
  朝向用 `rotate`、斜切用 `skewX`——**不要新增形状**；有机形状（飘带、水花）归**素材图**。
  ⚠️ 旧契约那套枚举（`arch` / `triangle`）**已作废**。
- **★ `transform` 不参与布局计算**：对齐 / 网格 / 溢出检测全按 `rect`。
  转过、斜切过的矩形**没有"边"**只有角点。因此 `transform` 与 `rect` 是两个字段。
- **主次靠尺寸自然表达**，数据里不写"这是主图"。
- **坐标系**：0–1 比例，但**分母不止一个** ——
  ⚠️ `rect` 相对**画布**、`polygon.points` 相对**自己的盒子**、`fontScale` 相对**画布宽**、
  `radius`/`shadow` 相对**盒子短边**、`letterSpacing` 相对**字号（em）**。
  **完整的「分母表」在 `src/document/README.md` §二 —— 改字段之前必须查。**
- **分层安全（两条契约规则）**：
  - 规则 2：每个节点在 HTML 里必须落成带 `data-layer` 的容器。
  - 规则 3：节点外观**不得**依赖父级的 `background` / `opacity` / `mix-blend-mode` / `filter`。
    → 每个节点必须能被**单独截出来而不变样**（这是「DOM → 分层 canvas」的前提）。
    ⚠️ **组是唯一例外**，且这是"组"的定义决定的：可截层单位 = **每个顶层节点**。
- **版式 vs 外观，判据只有一条**：**改它会不会让别的东西挪位置？** 会 → 版式；不会 → 外观。
  （所以 `fontScale` / `weight` 属版式；`fill` / `color` / `stroke` 属外观。）
- **一条贯穿全局的原则**：**把「给数值」变成「选位置」**——无限坐标空间（随手 `0.37`）模型掌握不好，
  有限几档的选项（选第 3 列 / 选 group 间距档 / 选一个形状名）它就稳得住。

### 渲染实现的硬约束

1. **shape 全部落成一个内嵌 `<svg>`**（2026-10-14 统一；原先 `rect`/`ellipse` 走 CSS）。
   圆角 / 填充 / 描边 / 阴影**都在 svg 那边**；容器 div 只管位置尺寸 ·
   `transform` · `opacity` · `blend` · `clip` · `mask` · `backdrop`。
2. **文字自适应必须"实测一遍再定"**（`fit.ts`）——纯 CSS 做不到"字号自动缩到装得下"。
   测量锚点是 `data-fit`（打**内层** `.vt`）**不能丢**，丢了会**静默失效**。
   ⚠️ 现状：`fit.ts` 写着但**零生产调用** ⇒ 长文字会冲出框。
3. **`emit.ts` 立的规矩是「绝不静默丢弃」**：翻不出的字段必须进 `unsupported` 报出来。
   复现违例：`node --import ./scripts/_ts-resolve.mjs scripts/_probe-vocab-coverage.mjs`

### 产物渲染宿主：**必须是真 document（iframe）**

- 产物 HTML **不导出**（只出 PNG）；字体由服务端生成的 `@font-face` URL 注入，
  预览/编辑器与出图共用同一套字体文件。
- ⚠️ **实测（2026-10-11）：`@font-face` 放进 shadow root 不注册、不生效。**
- ⚠️ 需求方（Amazon）的 `<base>` **禁用 `?rel=` 查询串**（RFC 3986 §5.2.2 会丢 base path 末段）。

### 编辑器的落位：**住在父文档，iframe 只当渲染器**

- 编辑器 = `editor/vocab-editor.ts`；**iframe 不注入任何脚本**，
  `sandbox="allow-same-origin"`、平时 `pointer-events:none`。
- **不注入脚本的两条硬理由**：① 分层截图会被覆盖层污染 ② `@font-face` 在 shadow root 里失效。
- **两条可机器断言的不变量**（断言命令在 `editor/README.md`）：
  ① 子文档 `<script>` 数恒 0 ② `editor/` 不引用任何全局网页对象
  （文档对象一律从参数流入 —— 这就是"编辑器改不到父页面"的结构性保证）。
- **归谁管**：编辑器管"改数据 + 写 DOM"；宿主只管两件它才知道的事 ——
  放开 iframe 的 `pointer-events`、以及 `flatten` 时重渲一份。

### 模型接入（`src/designharness/gateway/`）

**【核心约定】协议中立 vs 供应商专有** —— 写类型 / 常量前先问「换一家模型，这段还成立吗？」：

- `gateway/type/chat.ts`：**只放协议中立**（`ChatMessage` / `TokenUsage` / `ChatChunk` / `ContentPart`）。
- `gateway/type/deepseek-chat.ts`：**供应商专有**（图像档位枚举、Files API、实测限制与成本）。

### 会话与存储

- **会话跟着工作目录走**：数据落 `<工作目录>/.vinart/sessions/`；
  中央注册表 `~/.vinart/workdirs.json` **只存目录路径**。删工作目录 = 会话一起消失，零清理逻辑。
- **一个工作目录就是一个项目**（`project.json` / `set_project` / `/api/projects` 已全部拆除）。
- **产物落点**：`<工作目录>/designs/<版式名>/`（**没有 `<project>` 那层**）。
  文档是同目录的 `doc.json`；**HTML 不存**，每次现场 `emitDocument`。

---

## 前端（`src/ui/`）

**五栏**（`.main`）—— 最左是**主工具栏**（44px 固定宽、不参与拖拽），其余四栏可拖宽 + 可收起：

```
[ 工具栏 .toolbar ] [ 会话列表 .session-list ] [ 画布 .preview-panel ] [ 检查器 .inspector-col ] [ 对话 .right-col ]
```

- **工具栏**（`ToolBar.tsx` + `tools.tsx`）：上 6 个**工具**（单选、有高亮）· 下 4 个**动作**（撤销/重做/保存/出图，**动作只此一处入口**）。
  会话列表**默认收起**（`localStorage` 里没记过就是收起）。
- ⭐ **检查器是"页驱动"，不是手风琴**：左边选哪个工具，右边就**整块换成那一页**的字段
  （`tools.ts` 的 `GROUP_TOOL` 把 `Field.group` 映射到工具）。选中节点时**只在"当前页跟它毫无关系"**才自动跳页
  （`选择`/`图层` 是全局页，永不自动跳）。
  ⚠️ 这是 `docs/EDITOR-EVOLUTION.md` **M3（工具状态机 + 图层管理）的界面那一半**；
  "真模式"（每个工具一套指针行为 + 光标 + 快捷键）**还没做**。
- **字段控件只有一份实现**：`field-control.tsx` 的 `FieldControl` ——
  `EditPanel`（节点级）与 `SelectionStylePanel`（片段级）共用。**加控件只改这一处**。

- **UI 基元层** `src/ui/primitives.tsx`（15 个基元）：样式落 `index.css` 的 `.ui-*` 类，
  由设计 token 驱动。**不引入 CSS-in-JS**；**别给面板写内联硬编码颜色**
  （全站强调色 `--accent: #6c5ce7`）；**弹窗一律用 `Dialog`**。
- **属性面板由字段描述驱动**：`EditPanel`（节点级，`fieldsFor`）+ `SelectionStylePanel`
  （选区级，`selectionSnapshot()`）。取值一律走 `Field.get`，**不要自己拆 `path`**。
- **对话气泡 Markdown**：`Markdown.tsx`（react-markdown + remark-gfm + remark-breaks），
  **只用于助手的普通消息**；用户输入与 `kind:'log'` 保持纯文本。
  ⚠️ 日志的 class 是 `chat-msg assistant log`（role 仍是 assistant）——选择器必须 `:not(.log)`。
- **素材路由**：iframe / 编辑器素材一律 `/api/sessions/<sid>/file/<rel...>`。

---

## 命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | Vite 前端（5173）；插件会自动拉起 API（8787） |
| `npm run dev:api` | 单独跑 API 服务（8787） |
| `npm run test` | vitest |
| `npm run build` | `tsc -b && vite build` |
| `npm run step <file.ts>` | 跑任意 TS 脚本（探针 / 一次性脚本） |

⚠️ **本机沙箱下 `npm run dev` / `dev:api` / `vitest` 都可能因 esbuild `spawn EPERM` 起不来。**
绕过办法（已在用）：API 用 `node --experimental-transform-types --import ./scripts/_ts-resolve.mjs src/server/index.ts`；
探针同理，直接跑 `.mjs` / `.ts`。

⭐ **dev 服务（5173 / 8787）由用户自己启动，AI 不要挂后台任务去起。**
理由（用户 2026-10-17 明确）：AI 起的进程容易吃到旧 transform 缓存，且 AI 管不到"什么时候该重启"。
⇒ 改了 `emit.ts` / `vocabulary.ts` / `server/` 之后，**明确告诉用户"需要重启 API"**，不要自己起；
改了前端之后**明确说"刷新页面"**。AI 只做：`tsc --noEmit` · `vitest` · 直接跑脚本（`node ...`）·
以及**访问**用户已起的 5173/8787（Playwright / fetch，不是启动服务）。

---

## 开发规则

- **禁止自行提交代码**：除非用户明确要求，不要执行 `git commit`。
- **提交流程**：用户测试通过 → 用户要求提交 → 才执行 `git add` + `git commit`。commit message 用中文。
- **编译检查**：提交前必须 `npx tsc --noEmit` 零错误（当前保持 0 错误）。

## 工作约定（硬经验 · 踩过的坑）

- **判定问题只认硬证据**：`tsc --noEmit` / `git diff` / 运行时 DOM / 探针断言。
  肉眼读工具转录会连续误判（实测 3 次全被 `tsc` 证伪）。
- **不要凭印象断言，先查文档 / 实测**；图形类问题不要靠想象迭代。
- **⚠️ 删任何入口层之前先 grep 调用方**：代码 0 引用却有大量文档写着它的命令，
  「文档里的命令」必须当引用点一起清。
- **⚠️ "有 import 引用" ≠ "活着"**：注意**入口被掐断**的情况。
- **探针要断言、不要打印**：`ok(cond, msg)` 不成立即抛错 + 非 0 退出。
- **⚠️ 反向验证**：新写的探针要能证明"把修复退回去它就失败"，
  否则可能是假绿（范例：`scripts/_verify-polygon-fix.mjs`）。
- **⚠️ CSS 里没有 `//` 注释**：`decl; // 说明` 触发 bad-declaration，
  浏览器会**吞掉紧随其后的那条声明**。只用 `/* */`。
- **⚠️ UI 冒烟必须断言几何**：`boundingBox()` 拖拽时**元素飘到屏幕另一端也照样"拖成功"**。
- **⚠️ 改完前端必须真的加载一次页面**：`tsc` + API 冒烟都过 ≠ 页面能跑。
- **⚠️ 绝不用 PowerShell 改源文件**：`Set-Content` / `-replace` 会把 UTF-8 中文写成乱码
  （实测两次，第二次直接把探针写挂）。改文件只用编辑工具。
- **⚠️ 输出文件体积突变是最便宜的异常信号**（PNG 3.9MB → 122KB 就是断图）。

---

## 文档地图

| 文档 | 内容 |
|---|---|
| `src/document/README.md` | ⭐**文档模型 + 分母表**。**改字段之前先读。** |
| `src/editor/README.md` | 编辑器机制 · 打字链路 · 两条不变量 |
| `src/render/vocabulary/README.md` | 词汇渲染器（支持的 / 不支持的 / 待办） |
| `docs/EDITOR-EVOLUTION.md` | **项目级**：编辑器现状 + 类 PS 演进方案 + 分阶段验收 |
| `src/workflow/assetsgen/README.md` | 素材订单与生成 |
| `src/designharness/SESSIONS.md` | 会话层设计 |
| `src/designharness/SKILLS.md` | 技能层设计（三层来源 + 优先级 bundled>project>user） |

⚠️ **已知过时文档（待清）**：`docs/CODE-TOUR.md`（2026-10-16 已加"已过期"横幅 + 就地标注，
但正文仍是旧契约口径）、`docs/LISTING-QUALITY-ALIGNMENT.md` / `docs/PHOTOSHOP-CAPABILITIES.md` /
`docs/HYBRID-RENDERING.md`（提到已删除的 `render_sketch` / `generate_assets` / `compile_appearance`）、
`src/designharness/subagent/subagent-system.md`（整篇按旧契约写）。
`docs/MIGRATION.md` / `docs/DOCUMENT-MODEL.md` **已不存在**（此前这里列着它们）。
`src/bitmap/` 与 `designharness/memory/` 是空目录。

⚠️ **`test_product/vocab-points/vector-demo.html`** 是一份**手写死的旧模型快照**（141KB，内联着一整份
旧 `emit` + 旧扁平 `Layer[]`），**仓库里没有任何脚本生成它** ⇒ 别拿它当"当前渲染/DOM/模型"的参照。
