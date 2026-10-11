# CLAUDE.md

本文件为在此仓库中工作的 AI 助手提供指引。

> **状态：2026-10-10 全量重写。** 旧版的 Core Pipeline / Architecture / UI Layout Plan 三节
> 描述的是**早已不存在的结构**（`src/agent/`、`src/template/` 已删除，`gateway`/`context`/`session`
> 已迁走，以及一份**被推翻的旧 UI 方案**）。
> **若发现本文件与代码不符，以代码为准，并顺手修正本文件。**

---

## 项目概览

Vinart 是一个 **AI 驱动的设计出图 agent**，TypeScript 实现。

与"直接操作图形"的传统设计 agent 不同，Vinart 把**版式与元素组合当作 HTML+CSS 代码**，
借 Blink 引擎的亚秒级渲染产出成品图。

### ⚠️ 术语：「渲染」与「方案生成」是两件不同的事

| 叫法 | 谁干 | 干什么 | 调模型？ |
|---|---|---|---|
| **渲染** | `render.ts` / `sketch.ts` | spec(JSON) → HTML，**纯函数** | **零** —— 确定性、可复现、零成本 |
| **方案生成**（旧称"编译"） | 对话链路（主 AI + 子 agent） | 创意方案 → spec(JSON) | **调** —— 非确定性、烧钱 |

`render.ts` 的 import 里**没有任何 gateway**，它永远不碰模型。
（这两个概念曾混叫过一次，把"哪一步是确定性的"说岔了，别再混。）

---

## 核心链路（现状）

```
产品照 + 卖点
  │
  ▼ ① 内容创作 —— 对话技能 `amazon-listing`（主 AI 加载手册后自己完成四步）
  │     事实锁定 → 卖点审计 → 套图规划 → 逐槽 brief
  │     ⚠️ 原 `src/workflow/briefgen/`（perceive/claims/plan/draft 四步纯逻辑）已于
  │        2026-10-11 删除——它由 CLI 驱动，CLI 于 10-09 删除后成了零引用死代码；
  │        其规则精华已并入 skill
  │
  ▼ ② 方案生成（对话链路 · 调模型）—— 主 AI + 子 agent
  │     工具 spawn_design_agents → save_spec → validate_sketch → render_sketch
  │     另一步 compile_appearance 产出外观（颜色 / 描边）
  │     产物 design-sketch.json · design-appearance.json · sketch.png
  │
  ▼ ③ assetsgen —— 素材生成（调生图模型）
  │     工具 generate_assets。产物 assets.json（素材订单）+ 素材 PNG
  │
  ▼ ④ compose —— 组装出图（**零模型调用**）
  │     工具 render_design → assembleFinal()
  │     内部：缺素材检查 → 文字自适应（实测两遍）→ 自包含 HTML → 渲 PNG
  │
  ▼ final.png —— 交付 Amazon
```

⚠️ **整条链没有生产 CLI。** 历史上曾有 `src/workflow/steps/`（step-01..04）+
`design-sketch/compile.ts`，**2026-10-09 整层删除**。
**不要再重建 `step-*` 或 CLI 入口**——历史文档/记忆里的
`npm run step scripts/step-0*.ts`、`scripts/step-layout.ts` **全部作废，别照抄**。

> `npm run step <任意.ts>` 仍可用，但它只是**通用 TS 脚本运行器**（esbuild 打包后执行），
> **不是某条固定 pipeline 的入口**。用途是跑探针 / 一次性脚本。

---

## 架构（实际目录 · 2026-10-11 实测）

```
src/
├── config.ts              配置 / 密钥（keys.json 与环境变量）
├── main.tsx               前端入口
├── server/                HTTP 面 —— /api/layout/* · /api/sessions/* · /api/models · /api/fs/* · /api/workdirs
├── ui/                    前端（四栏，见下）
├── editor/                ⭐编辑器（父侧覆盖层 + 工具层，**核心功能**）
│   ├── index.ts           createEditor(host, wrap, target, opts) → EditorHandle（手势状态机）
│   ├── target.ts          ⭐目标适配器 —— 唯一接触子文档的地方
│   ├── overlay.ts         父文档覆盖层（选中框 / 四角手柄 / 旋转柄）
│   ├── hit-test.ts        命中测试两段式（先装饰件，再问子文档）
│   ├── geometry.ts        纯函数几何（可 vitest 直测）
│   ├── types.ts           契约
│   └── README.md          两条可机器断言的不变量
├── designharness/         设计运行时（模型接入 + 上下文 + 会话 + 技能 + 工具）
│   ├── context/           上下文（chat-context · compaction · image-context）
│   ├── gateway/           模型接入（client · provider · registry · fallback · resilience · type · util）
│   ├── memory/            ⚠️ 空
│   ├── session/           会话（chat-session · chat-store · manager · transcript）
│   ├── skills/            技能（registry 三层来源 · skill-tool · types）
│   ├── subagent/          子 agent（agent-loop · runner · spawn-tool · design-system）
│   ├── tools/             工具集（见下表）
│   ├── SESSIONS.md        会话层设计文档
│   └── SKILLS.md          技能层设计文档（三层来源 + 优先级 bundled>project>user）
├── render/                Blink 渲染（blink-renderer · embed-images · index）
├── schema/                ⚠️ 空（`asset-order.ts` 已移至 workflow/assetsgen/）
└── workflow/              一条工作流一个目录
    ├── design-sketch/     版式规格 + **渲染真源 render.ts** ← 改这里之前先读它的 README
    ├── appearance/        外观编译（compile.ts）
    ├── assetsgen/         素材生成（asset-order · order · image · cutout）
    └── compose/           组装出图（assemble · emit-html）
```

**逻辑真源分布**（改之前先定位）：

| 环节 | 真源 |
|---|---|
| 出图阶段 | `design-sketch/runtime.ts` + `assetsgen/{order,image}.ts` + `compose/assemble.ts` |
| 校验 | `design-sketch/validate.ts` |

### 工具集（`src/designharness/tools/`）

| 工具 | 作用 |
|---|---|
| `spawn_design_agents` | 派子 agent（`subagent/spawn-tool.ts`） |
| `save_spec` / `validate_sketch` / `render_sketch` | 版式：落盘 / 校验 / 渲草图 |
| `compile_appearance` | 外观编译（颜色 / 描边） |
| `generate_assets` | 素材生成（生图模型） |
| `render_design` | 组装成品 `final.png` |
| `read_spec` / `edit_spec` | **AI 侧编辑通路**（set/add/remove，与前端 `mergePatch` 语义对齐） |
| `read_file` | 读文本文件（**拒二进制**） |

---

## 关键设计决策

### 版式契约（`src/workflow/design-sketch/`）

- **三类节点**：`image` / `text` / `shape`。三类都必须有 `id` 与 `rect`。
- **★「框」是独立节点**，不是内容的属性：`image` 与 `shape` **位置重叠**，
  谁在上面由 `layers` 数组顺序定（前 = 底板，后 = 相框）。
  > 独立节点能被单独截出来，属性不能。
- **★ `transform` 不参与布局计算**：对齐 / 网格 / 溢出检测全按 `rect`。
  转过、斜切过的矩形**没有"边"**只有角点。因此 `transform` 与 `rect` 是两个字段。
- **形状只有 4 种枚举**：`rect` / `ellipse` / `arch` / `triangle`。
  朝向用 `rotate`、斜切用 `skewX`——**不要新增形状**；有机形状（飘带、水花）归**素材图**。
- **主次靠尺寸自然表达**，数据里不写"这是主图"。
- **坐标系**：一律 0–1 画布比例，**永远相对画布**（节点间平级，没有嵌套）。
- **分层安全（两条契约规则）**：
  - 规则 2：每个节点在 HTML 里必须落成带 `data-layer` 的容器。
  - 规则 3：节点外观**不得**依赖父级的 `background` / `opacity` / `mix-blend-mode` / `filter`。
    → 每个节点必须能被**单独截出来而不变样**（这是「DOM → 分层 canvas」的前提）。
  - ⚠️ **实测：目前是"文档约定"，`validate.ts` 并不强制**；渲染器也不产出这些属性。
- **版式 vs 外观，判据只有一条**：**改它会不会让别的东西挪位置？** 会 → 版式；不会 → 外观。
  （所以 `fontScale` / `weight` 属版式；`fill` / `color` / `stroke` 属外观。）
- **一条贯穿全局的原则**：**把「给数值」变成「选位置」**——无限坐标空间（随手 `0.37`）模型掌握不好，
  有限几档的选项（选第 3 列 / 选 group 间距档 / 选一个形状名）它就稳得住。

### 渲染实现的三条硬约束

1. 渲染必须用**替换占位符后**的 HTML（`emit-html.ts` 产出自包含字符串）。
2. 文字自适应必须**实测两遍**（回填 `fits` 系数）——纯 CSS 做不到"字号自动缩到装得下"。
   相关标记 `data-fit`（外层）+ `.btfit`（内层）**不能丢**，丢了自适应会**静默失效**
   （永远显示"全部装得下"）。
3. 形状填充色加在**容器自身**的 `background`——`border-radius` 只裁自身背景、不裁子元素
   （否则铺 div 时 `ellipse` / `arch` 会渲成方框）。

### 产物渲染宿主：**必须是真 document（iframe）**

- 产物 HTML 自带 3 条 **data-URL 内联 `@font-face`**（不用 CDN，为了可复现）、
  自带 `html,body{width/height}`、自带 `<base>` 语义 —— **这三样只在真 document 里成立**。
- ⚠️ **实测（2026-10-11）：`@font-face` 放进 shadow root 不注册、不生效。**
  真实产物挂 shadow root 后 3 条 face 全部回退，逐像素比对 **1.9976 % 像素差、最大差 186、
  且 100 % 落在文字层**。`:host` 兜底无效；提 `@font-face` 到宿主 `head` 会**改父页面**
  （违反「编辑器不得修改父页面」硬约束）。
- 而 `html,body{...}` 那条**是冗余的**（`.canvas` 自己撑尺寸，三臂图层几何完全一致）
  —— 它曾被当成"不能用 Shadow DOM"的理由，**已被否掉**。
- → **不要**为了"单坐标系"把产物换成 Shadow DOM。单坐标系用**父侧覆盖层**解决。
  详见 `docs/EDITOR-EVOLUTION.md` §4.1 / §4.4。

### 编辑器的落位：**住在父文档，iframe 只当渲染器**（2026-10-11 已实施，M1）

- `src/editor/` = 编辑器全部实现（`createEditor(host, wrap, target, opts)`）；
  **iframe 不再注入任何脚本**，`sandbox="allow-same-origin"`、`pointer-events:none`。
- **不要**把编辑器写回"注入进子文档的字符串"。旧实现（`src/preview/layout-editor-script.ts`、
  351 行）已删；覆盖层若留在子文档，PS 化要做的**逐层截图**会被橙色虚线框污染。
- **两条可机器断言的不变量**（断言命令在 `src/editor/README.md`）：
  ① 子文档 `<script>` 数恒 0 ② `src/editor/` 不引用任何全局网页对象
  （文档对象一律从参数流入 —— 这就是"编辑器改不到父页面"的结构性保证）。
- 验收：`npm test`（几何 33 条）+ `npm run step scripts/_probe-editor-behaviour.ts`（行为 20 条）
  + `npm run step scripts/_probe-m1-invariants.ts`（M1 不变量 19 条）。

### 模型接入（`src/designharness/gateway/`）

**【核心约定】协议中立 vs 供应商专有** —— 写类型 / 常量前先问「换一家模型，这段还成立吗？」：

- `gateway/type/chat.ts`：**只放协议中立**（`ChatMessage` / `TokenUsage` / `ChatChunk` / `ContentPart`）。
- `gateway/type/deepseek-chat.ts`：**供应商专有**（图像档位枚举、Files API、实测限制与成本）。

### 会话与存储

- **会话跟着工作目录走**：数据落 `<工作目录>/.vinart/sessions/`；
  中央注册表 `~/.vinart/workdirs.json` **只存目录路径**。删工作目录 = 会话一起消失，零清理逻辑。
- **一个工作目录就是一个项目**（`project.json` / `set_project` / `/api/projects` 已全部拆除）。
- **产物落点**：`<工作目录>/designs/<版式名>/`（**没有 `<project>` 那层**）。
  素材订单是同目录的 `assets.json`；统一入口 `tools/project-paths.ts` 的 `resolveDesignDir(sessionId, name)`。

---

## 前端（`src/ui/`）

**四栏**（`.main`），每栏可拖宽 + 可收起：

```
[ 会话列表 .session-list ] [ 画布 .preview-panel ] [ 检查器 .inspector-col ] [ 对话 .right-col ]
```

- **UI 基元层** `src/ui/primitives.tsx`（15 个基元）：样式落 `index.css` 的 `.ui-*` 类，
  由设计 token 驱动。**不引入 CSS-in-JS**；**别给面板写内联硬编码颜色**
  （全站强调色 `--accent: #6c5ce7`）；**弹窗一律用 `Dialog`**。
- **对话气泡 Markdown**：`Markdown.tsx`（react-markdown + remark-gfm + remark-breaks），
  **只用于助手的普通消息**；用户输入与 `kind:'log'` 保持纯文本。
  ⚠️ 日志的 class 是 `chat-msg assistant log`（role 仍是 assistant）——选择器必须 `:not(.log)`。
- **素材路由**：iframe / 编辑器素材一律 `/api/sessions/<sid>/file/<rel...>`。
  `<base href>` **禁用 `?rel=` 查询串**（RFC 3986 §5.2.2 会丢 base path 末段，实测双 404）。
- **顶栏** `Header.tsx` 只剩 logo；新建对话入口只有左栏 `.session-new-btn`。

---

## 命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | Vite 前端（5173）；插件会自动拉起 API（8787） |
| `npm run dev:api` | 单独跑 API 服务（8787） |
| `npm run test` | vitest |
| `npm run build` | `tsc -b && vite build` |
| `npm run step <file.ts>` | 跑任意 TS 脚本（探针 / 一次性脚本） |

---

## 开发规则

- **禁止自行提交代码**：除非用户明确要求，不要执行 `git commit`。代码写完后，
  等用户测试通过再由用户决定是否提交。
- **提交流程**：用户测试通过 → 用户要求提交 → 才执行 `git add` + `git commit`。commit message 使用中文。
- **编译检查**：提交前必须确保 `npx tsc --noEmit` 零错误（当前保持 0 错误）。

## 工作约定（硬经验 · 踩过的坑）

- **判定问题只认硬证据**：`tsc --noEmit` / `git diff` / `cat -A` / 运行时 DOM。
  肉眼读工具转录会连续误判（实测 3 次全被 `tsc` 证伪）。
- **不要凭印象断言，先查文档 / 实测**；图形类问题不要靠想象迭代——放大渲染出来对比，零 API 成本。
- **⚠️ 删任何入口层之前先 grep 调用方**：`src/workflow/steps` 代码 0 引用，
  却有大量文档/注释写着它的命令。「文档里的命令」必须当引用点一起清。
- **⚠️ "有 import 引用" ≠ "活着"**：注意**入口被掐断**的情况，例如 `htmlCode` 世代
  （`App.tsx:106` 只赋初值从不更新，文件仍被 import 却运行时不可达）。
- **探针要断言、不要打印**：`ok(cond, msg)` 不成立即抛错 + 非 0 退出。
  项目惯例 `scripts/_probe-*.ts`，跑完自清理（临时目录 + 还原注册表）。
- **⚠️ CSS 里没有 `//` 注释**：`decl; // 说明` 触发 bad-declaration，
  浏览器会**吞掉紧随其后的那条声明**。只用 `/* */`。
- **⚠️ UI 冒烟必须断言几何**：`boundingBox()` 拖拽时**元素飘到屏幕另一端也照样"拖成功"**，
  "变宽 ✓" 是假绿。
- **改完前端必须真的加载一次页面**：`tsc` + API 冒烟都过 ≠ 页面能跑。
- **输出文件体积突变是最便宜的异常信号**（PNG 3.9MB → 122KB 就是断图）。

---

## 文档地图

| 文档 | 内容 |
|---|---|
| **`docs/EDITOR-EVOLUTION.md`** | **项目级**：编辑器现状 + 类 PS 演进方案 + 分阶段验收 + 未决问题。**动编辑器前先读。** |
| `src/workflow/design-sketch/README.md` | 版式阶段完整规范（契约 / 校验 / 渲染）。**改这里之前先读。** |
| `src/workflow/compose/README.md` | 组装出图 + 文字自适应 |
| `src/workflow/assetsgen/README.md` | 素材订单与生成 |
| `src/designharness/SESSIONS.md` | 会话层设计 |
| `src/editor/README.md` | 指路桩（指向 `docs/EDITOR-EVOLUTION.md`） |

---

## 已知的文档过时项（待清）

- `src/workflow/design-sketch/README.md` §七 仍写「`src/schema/` 只剩 `asset-order.ts`」——
  实际 `src/schema/` **已空**，`asset-order.ts` 在 `workflow/assetsgen/`。
- `src/schema/` 与 `src/designharness/memory/` 是**空目录**，用途待定。
- 编辑器层尚未实现（见 `docs/EDITOR-EVOLUTION.md` §5）。
