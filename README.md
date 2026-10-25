# Vinart

**AI 驱动的通用视觉设计工具：用对话生成可继续编辑的版式，再确定性地渲染成图。**

Vinart 把设计稿表达成一份结构化的 `DesignDocument`（落盘为 `doc.json`）：**画布 → 图层 → 元素**。
AI 负责提出方案（会调模型，结果不唯一）；渲染器负责把文档变成 HTML/CSS（纯函数、零模型调用），
再交给 Chromium 出图。同一份文档既能在对话里被 AI 修改，也能在画布上被人直接拖拽、改字、调色；
产物不是一张不可回改的图片。

传统文生图把结果压成像素，改一个字就要重画；Vinart 保留结构，文字、图层和素材都可以单独替换，
同一套版式也能换素材复用。

---

## 主要特性

- **对话即设计** —— 主 AI 通过工具读写文档：`sketch_plan` 新建版式、`patch_doc` 改字段、
  `edit_structure` 增删图层/元素、`generate_assets` 生成素材；缺关键信息时用 `ask_user`
  结构化提问，而不是靠猜。
- **产物可编辑** —— `doc.json` 是唯一真源，HTML 每次现场生成、不落盘。AI 改完可以接着手调，
  手调完 AI 也能接着改。
- **确定性渲染** —— `emitDocument(doc)` 不读盘、不调模型、不开浏览器；同一份文档和同一组
  素材/字体永远得到同一份 HTML，之后才交给 Chromium 截图。
- **画布编辑器** —— 选择/移动/缩放/旋转、多边形顶点编辑、双击就地改字、选区级富文本样式、
  撤销/重做、图层管理、按工具分页的属性检查器。
- **素材生成** —— 图片走生图模型，图标可以由 AI 写线框 SVG；素材与文档只通过文件名关联，
  不维护 id 映射。
- **技能与子 agent** —— 技能是可分层加载的知识包（内置 / 项目 / 用户）；独立任务可以派给
  子 agent 并行处理。
- **项目即目录** —— 会话、版式、素材都写在所选工作目录里；换目录就是换项目，
  删目录就连会话一起消失。

---

## 它是怎么工作的

```text
用户对话
  │   skill（领域知识）· ask_user（缺信息先问）
  ▼
sketch_plan ──► SketchPlan（0–1 比例）
  │  translate()
  ▼
DesignDocument（doc.json，px）◄──── 编辑器：拖拽 / 改字 / 调属性
  │  patch_doc · edit_structure · generate_assets
  │
  ▼  emitDocument() —— 纯函数，零模型调用
HTML + CSS
  │  Chromium（Playwright）
  ▼
final.png
```

这不是一条写死的 CLI 流水线：每一步都由对话里的工具调用或编辑器动作触发。
`npm run step` 只是通用 TS 脚本运行器，不是某条固定 pipeline 的入口。

### 「方案生成」和「渲染」是两件事

| | 方案生成 | 渲染 |
|---|---|---|
| 谁做 | 对话链路：主 AI + 子 agent | `emit.ts`（文档 → HTML）+ `blink-renderer.ts`（HTML → PNG） |
| 调模型 | 是 | 否 |
| 确定性 | 非确定性，结果不唯一 | 确定性：`emit` 是纯函数，截图由浏览器完成 |
| 产物 | `doc.json` | HTML/CSS → PNG |

项目里说的「渲染」主要指 `emitDocument` 这一步；后面的 Chromium 截图是栅格化。
把这两步和「方案生成」混在一起，会说不清哪一步是确定性的、哪一步在烧钱。

---

## 核心概念

### 文档模型：画布 → 图层 → 元素

```ts
DesignDocument = { canvas, layers }
Layer          = { id, name?, ...效果, elements }          // 图层，不是元素
ElementNode    = TextNode | ImageNode | SvgNode | ShapeNode | GroupNode
```

| 元素 | 用来做 | 关键点 |
|---|---|---|
| `text` | 标题、正文、标签 | 内容按 `runs` 分段（多色/多字号）；高度由排版决定，不写死 |
| `image` | 照片、商品图、场景图 | `asset` 文件名 + `fit`（`cover` / `contain` / `fill`） |
| `svg` | 图标、徽标 | 引用外部 `.svg`，固定 `contain`，不裁切 |
| `shape` | 底板、色块、异形 | `rect` / `ellipse` / `polygon` / `path`；`polygon` 是唯一可逐点编辑的几何（矩形/椭圆拖顶点会升格为它） |
| `group` | 整组应用效果 | 没有自己的 `rect`；范围 = 子元素并集 |

**图层**是画布的孩子，永远和画布一样大，没有 `rect`、没有底色，只有效果字段、可见/锁定标记和
`elements`。因此**元素坐标永远是画布坐标**，不存在「层内坐标」这回事。

### 坐标：AI 写比例，文档存 px

- AI 的几何参数（`sketch_plan` / `patch_doc` / `edit_structure`）是 **0–1 画布比例**——
  模型不知道画布多大，写 `0.06` 比写 `54px` 稳。
- `translate()` 是**唯一**做「比例 → px」换算的地方；写进 `doc.json` 的 `rect` / `frame`
  已经是画布 px。
- 但不是所有 0–1 都除以画布：`polygon.points` / `path.d` 相对自己的盒子，`radius` /
  `shadow` 相对盒子短边，`letterSpacing` 相对字号。改字段之前先查
  [`src/document/README.md`](src/document/README.md) 的**分母表**。

### 版式还是外观？

判断只有一条：**改它会不会让别的东西挪位置？**

- 会 → **版式**：`rect`、字号、字重、字距、圆角、`transform`……
- 不会 → **外观**：`fill`、`stroke`、`shadow`、透明度、混合模式……

这条判据决定了字段该放在哪一层，也决定了编辑器改一个值时要不要重排。

### 编辑器与 iframe

画布是一个沙箱 iframe，但它**只是渲染器**：不注入任何脚本，平时 `pointer-events:none`。
选中框、手柄、文字选区、命中测试都在父文档完成，编辑器只把 iframe 当作被操作对象。
这样覆盖层不会污染渲染产物，编辑器也改不到父页面。

---

## 快速开始

### 环境要求

- **Node.js 22+**（开发环境使用 Node 24）
- npm
- 一个可用的 **chat 模型 API**；要生成图片素材还需要一个 **image 模型 API**

### 安装与配置

```bash
# 1. 安装依赖
npm install

# 2. 安装出图用的 Chromium（首次需要）
npx playwright install chromium

# 3. 从模板生成模型配置
cp keys.example.json keys.json
# Windows PowerShell 用：Copy-Item keys.example.json keys.json

# 4. 启动（前端 5173，API 8787 会自动拉起）
npm run dev
```

打开 <http://localhost:5173>（默认端口），第一次使用先选择一个**工作目录**。

`keys.json` 的 `providers` 是模型注册表，每项描述一家服务：

- `type`：`chat` 或 `image`；
- `protocol`：chat 用 `openai` / `anthropic`，image 用 `volcano-ark`；
- `apiKey` / `baseURL`：服务地址与密钥；
- `models[]`：`model` + `priority`（数字越小越优先），chat 模型建议再给 `contextWindow`。

至少要有一个 chat 模型才能对话；要生成素材还需要一个 image 模型。
`keys.json` 是启动前必须存在的实际配置，`keys.example.json` 只是模板；模板里的模型名只是示例，
按服务商当前可用的名字填写（示例以 DeepSeek + 火山方舟为例，换成已有协议的供应商只改这个文件）。
它已在 `.gitignore` 里，**不要提交**。对话和生图都会调用外部 API，按服务商计费。

### 字体

字体库在 `designassets/fonts/families/`，每个家族一个目录：`family.json` 描述可用字重和文件名，
字体文件按 `family.json` 的 `files` 命名。拉丁字体大多已入库；**两个中文字体
（`NotoSansSC` / `NotoSerifSC`）只跟踪了元数据与授权文件**，`.woff2` 被 `.gitignore` 排除，
需要自行放入对应目录，否则该家族会被字体注册表跳过，界面的字体下拉里也不会出现。
中文设计请至少准备一款中文字体。

---

## 使用流程

1. **选工作目录** —— 它就是项目；会话、版式、素材都写在这里。
2. **新建会话** —— 在右栏对话里描述需求，可以贴产品照或参考图。
3. **说清约束** —— 用途、画布比例（新建时可选 1:1 / 4:5 / 3:4 / 16:9 / 9:16）、
   必须出现的文案；缺信息时 AI 会弹结构化问题。
4. **生成版式** —— AI 加载技能、规划结构，用 `sketch_plan` 落出一份 `doc.json`，
   画廊里出现版式卡片。
5. **继续修改** —— 点开卡片：画布上拖拽/双击改字/调检查器；或者继续在对话里让 AI 改。
   需要真实素材时让 AI 生成，再把元素的 `asset` 指向文件名。
6. **出图** —— 点「出图」选择倍率、格式和导出目录；工作区始终保留一份 `final.png`。

---

## 命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | 启动 Vite 前端（5173），并自动拉起 API（8787） |
| `npm run dev:api` | 只启动 API（8787） |
| `npm test` | 运行 vitest 单测 |
| `npm run build` | `tsc -b && vite build` |
| `npm run preview` | 预览构建产物 |
| `npm run step <file.ts>` | 用 esbuild 打包后运行任意 TS 脚本（探针 / 一次性脚本；不是固定流水线入口） |

---

## 技术栈

- **前端**：React 18 · Vite 6 · TypeScript 5
- **服务端**：Node.js 原生 HTTP + SSE（无 Web 框架）
- **出图**：Playwright 驱动的 Chromium
- **存储**：JSON / JSONL 文件；没有数据库
- **HTTP 面**：`/api/sessions/*`（会话 / SSE 对话）、`/api/layout/<name>/*`（读取 / 保存 / 出图）、
  `/api/fonts/*`（字体）、`/api/fs/*`（目录浏览）

---

## 目录结构

```text
src/
├── ui/                 React 单页应用（工具栏 / 会话列表 / 画布 / 检查器 / 对话）
├── editor/             画布编辑器：手势、命中测试、就地改字、选区、撤销栈
├── document/           ⭐ 唯一文档模型（vocabulary.ts）+ patch / structure
├── schema/             AI 的 0–1 契约（DesignIntent / SketchPlan）
├── workflow/
│   ├── translate/      SketchPlan → DesignDocument（唯一的比例 → px 换算点）
│   └── assetsgen/      生图订单与生成
├── render/
│   ├── vocabulary/     emit.ts：文档 → HTML/CSS
│   └── rasterize/      Playwright / Chromium 截图
├── designharness/      模型网关 / 上下文 / 会话 / 技能 / 子 agent / 工具
├── fonts/              字体库读取与 @font-face
└── server/             dev API：会话、版式、渲染、字体、文件
designassets/           字体、图标、配色、纹理
skills/                 项目级技能（design-direction / design-style / source-analysis）
test/                   vitest 单测
docs/                   设计文档与待决策记录
scripts/                通用 TS 运行器与探针
```

---

## 数据与产物

```text
<工作目录>/
├── designs/
│   └── <版式名>/
│       ├── doc.json          # 唯一真源
│       ├── assets.json       # 素材订单（生成记录）
│       ├── final.png         # 工作区标准成品
│       └── *.png / *.svg     # 素材
├── uploads/                  # 对话里贴的图
└── .vinart/
    └── sessions/             # 会话事件流（JSONL）

~/.vinart/workdirs.json       # 中央注册表：只存工作目录路径
```

- **会话跟着工作目录走**：删掉工作目录，会话与子 agent 账本一并消失，没有额外清理逻辑。
- **`final.png` 是工作区里的标准成品**；「出图」导出的是副本，可以另选目录、格式和倍率。
- **会话事件流只追加、不改写**；索引只是缓存，坏了可以从事件流重建。

---

## 扩展点

- **换 / 加模型**：同一协议下只改 `keys.json`；只有新增协议才需要在
  `src/designharness/gateway/provider/` 里加实现。
- **加技能**：在 `<工作目录>/skills/<name>/SKILL.md` 或 `~/.vinart/skills/<name>/SKILL.md`
  放带 frontmatter 的目录；同名优先级为 `bundled > project > user`。详见
  [`src/designharness/SKILLS.md`](src/designharness/SKILLS.md)。
- **加工具**：在 `src/designharness/tools/` 实现 `AgentTool`，再到
  `src/designharness/session/chat-store.ts` 的 `tools` 数组注册。
- **改文档模型**：先读 [`src/document/README.md`](src/document/README.md)，然后同时更新
  `vocabulary.ts`、`emit.ts`、编辑器和工具。只改一处会出现「渲染支持、编辑器不支持」的静默陷阱。

---

## 文档地图

| 文档 | 内容 |
|---|---|
| [`src/document/README.md`](src/document/README.md) | ⭐ 文档模型、分母表、渲染契约。**改字段之前先读。** |
| [`src/editor/README.md`](src/editor/README.md) | 编辑器机制、文字编辑链路、两条不变量 |
| [`src/render/vocabulary/README.md`](src/render/vocabulary/README.md) | 渲染器支持 / 不支持的精确清单 |
| [`src/workflow/translate/README.md`](src/workflow/translate/README.md) | 比例 → px 的唯一换算点 |
| [`src/workflow/assetsgen/README.md`](src/workflow/assetsgen/README.md) | 素材订单、生图提示词规则 |
| [`src/designharness/SESSIONS.md`](src/designharness/SESSIONS.md) | 会话层：事件流、索引、惰性会话 |
| [`src/designharness/SKILLS.md`](src/designharness/SKILLS.md) | 技能三层来源与优先级 |
| [`docs/EDITOR-EVOLUTION.md`](docs/EDITOR-EVOLUTION.md) | 编辑器演进方向（类 PS 路线）与实测证据 |
| [`docs/PENDING-TEXT-SVG-UPGRADE.md`](docs/PENDING-TEXT-SVG-UPGRADE.md) | 待决策：普通文字渐变描边/装饰线升级 SVG |
| [`CLAUDE.md`](CLAUDE.md) | AI 工作约定（项目说明以本 README 为准） |

文档入口是这份 README。`docs/` 只保留当前设计（`EDITOR-EVOLUTION.md`）与待决策记录
（`PENDING-TEXT-SVG-UPGRADE.md`）；模块细节看上面的模块文档。
历史研究稿已清理，需要时从 git 历史找回；与代码不一致时以代码为准。

---

## 开发约定

- 提交前跑 `npx tsc --noEmit`，保持零错误；改动逻辑后跑 `npm test`。
- **不要提交** `keys.json`、新增字体二进制、`test_product/` 等本地产物（见 `.gitignore`）。
- 删入口、改字段之前先 grep 调用方；「有 import」不等于「还活着」。
- 文档与注释以中文为主；提交信息也用中文。

---

## 状态与已知限制

- 项目仍在活跃开发，字段、接口和界面都可能继续调整。
- 单行（`nowrap`）文字目前不会自动缩字号，可能冲出画框；需要时手动调小字号或加宽。
- 分层位图与自建合成器尚未实现；当前所有合成由 Chromium 一次截图完成。

---

## License

Vinart 以 **MIT License** 授权，完整条款见 [LICENSE](LICENSE)。

Copyright (c) 2026 Vinart contributors

> MIT 允许商用、修改、分发和闭源再发布，只需保留版权与许可声明。
> 第三方依赖与字体保留各自的许可证；分发时请一并保留
> `designassets/fonts/families/*/OFL.txt` 等授权文件。
>
> 以上是便于理解的摘要，以 [LICENSE](LICENSE) 原文为准。

---

> 如果这份 README 与代码不一致，以代码为准，并顺手修正这里。
