# 待决策：harness 与词表 / emit / 编辑器接线（AI 读当前 doc）

> **状态：只记录，未实现（2026-10-18）。**
> 用户明确说"先记下来几个方案，不是现在必须解决"。这份文档钉住现状和三种读当前 doc 的方案，
> 下次动 harness 时不用重新推。

## 1. 现状：harness 与设计层是割裂的

- **主 AI 只有一个工具**：`src/designharness/session/chat-store.ts` 里
  ```ts
  tools: [createSkillTool({ sessionId })]
  ```
  旧契约的 `read_spec` / `render_design` / `generate_assets` / `spawn_design_agents` /
  `compile_appearance` 已随旧契约删除；要"重新对着词汇表长"。
- **唯一的桥**：`src/server/index.ts` 的 `buildLayoutNote()`：
  - 读 `<workDir>/designs/<layout>/doc.json`；
  - 拼一段文本摘要（画布尺寸、图层 id、元素 id/type、文字前 40 字）进 systemNote；
  - 主 AI 只能看到**已保存 doc.json 的摘要**，看不到完整/最新 doc，也拿不到编辑器的选中项。
- **词汇表 / emit / 编辑器**都是本地纯函数或前端状态，没有被暴露成工具；
  AI 不能读完整 doc、不能写、不能校验、不能渲染、不能 apply 到编辑器。
- **编辑器的当前 doc** 在 `src/ui/App.tsx` 的 `layoutRef.current`；
  自动保存是 `scheduleAutoSave()`：**1500ms 防抖** → `POST /api/layout/<name>/save`，body `{doc}`；
  手动保存走同一接口。自动保存失败是静默的（`catch {}`），没有 `beforeunload` flush，后台标签页还会被节流。

## 2. 问题

AI 的上下文和未来工具都建立在"当前 doc"上，但现在：

- `buildLayoutNote` 读的是**磁盘**，最多比编辑器内存旧 1.5s（或更久，如果保存失败/后台节流）；
- 它只有**摘要**，没有完整 JSON，也没有当前选中图层/元素；
- 未来 `read_doc` / `validate_doc` / `apply_doc` / `render_design` 都会遇到同一个问题：
  **读哪份 doc？**

## 3. 三种方案（AI 读当前 doc）

### A. 服务端维护当前 doc 的内存副本（推荐）

- 编辑器每次改 → 同步给服务端（离散操作立即同步，连续输入可 100–200ms 防抖）；
- 服务端内存保存当前 doc；磁盘仍按 1.5s 异步落盘；
- AI 的 `read_doc` / `buildLayoutNote` / `apply_doc` / `render_design` 全部读**内存副本**；
- AI 的 `apply_doc` 写内存副本 → 推事件给前端 → 前端走编辑器的 apply/撤销通道 → 磁盘异步落。

代价：多一条"编辑器 → 服务端内存"的同步通道；要定义多标签页/多客户端谁覆盖谁。

### B. `/chat` 请求直接带当前 doc

- 前端发 `/chat` 时带 `layoutRef.current.doc`；
- 服务端的 `buildLayoutNote` 和工具直接用请求里的 doc，不读磁盘；
- 不需要服务端常驻内存；但请求体变大（doc 可能几十 KB），工具执行期间要用这份请求 doc；
- AI 的 `apply_doc` 仍要把结果送回前端。

### C. 发消息前 flush 自动保存

- `await autoSaveNow()` 后再发 `/chat`，AI 继续读 `doc.json`；
- 最省事；只解决"发消息那一刻"的延迟；
- 不解决工具多轮执行期间前端又改了的情况。

## 4. 倾向

**A**：服务端内存副本作为"当前 doc"的唯一读源，磁盘只负责持久化。这样：

- 1.5s 防抖只影响落盘，不影响 AI；
- AI 的读/校验/渲染/apply 都在同一份内存 doc 上；
- 以后 AI 改动也能和编辑器共享同一份状态，而不是"改盘 → 等前端重载"。

## 5. 需要先定的

1. 同步通道：编辑器每次改动就同步（100–200ms 防抖），还是只在聊天前同步？
2. 内存副本归属：按 `sessionId + layout` 存，还是只存当前打开的那一份？
3. AI 的 `apply_doc`：写内存后，前端是**重载 layout**，还是走编辑器的 apply/撤销通道？
4. 多标签页/多客户端：以哪个客户端为准，还是服务端内存为唯一真源？
5. 落盘策略：保留 1.5s 防抖，还是离散操作立即落盘 + 连续输入短防抖？
6. 自动保存失败：是否要暴露给用户 / chat 前强制 flush？

## 6. 之后（本次不展开）

- `read_doc` / `validate_doc` / `apply_doc` / `render_design` / `list_designs` 等工具；
- AI 改动进编辑器撤销栈；
- 渲染结果（PNG / `unsupported` / `notes`）回喂给 AI；
- `amazon-listing` / `generate_assets` / `spawn_design_agents` 的重新接线。

## 7. 相关文件

- `src/designharness/session/chat-store.ts`（工具表 / system prompt）
- `src/server/index.ts`（`buildLayoutNote`、`/chat`）
- `src/ui/App.tsx`（`scheduleAutoSave` / `autoSaveNow` / `handleLayerChanged` / `handleTypingChanged`）
- `src/document/vocabulary.ts`、`src/render/vocabulary/emit.ts`、`src/editor/vocab-editor.ts`

## 8. 追加约束：AI 只拿受限语义计划 + 翻译器（2026-10-18）

用户明确了两条前提：

- **不会把完整词汇表暴露给 AI**，只暴露一个受限子集；
- **AI 不产出精准 px**；
- 旧设计里还有一层**解析层 / 翻译器**，负责把语义计划落到 `DesignDocument`（px）。

因此工具层不应是 `read_doc` / `patch_doc` 这种全量词汇接口，而应是：

- **AI 侧**：`get_design`（当前设计的语义视图）/ `apply_plan`（语义计划）/ `render_preview` /
  `list_layouts` 等；
- **翻译器**（确定性、无模型）：语义计划 + 布局模板 + 设计 token + 当前 doc
  → 完整 `DesignDocument` / 补丁；
- 之后才 `emit` / 编辑器 apply / 撤销。

旧翻译器（`design-sketch` / `design-appearance` / `compile_appearance`）已随旧契约删除；
新的要**对着 `vocabulary.ts` 重建**，不要复活旧契约。

> ⚠️ **但 0–1 → px 的翻译器其实还在**：`src/workflow/translate/translate.ts`
> （`DesignIntent` 0–1 → `DesignDocument` px，带 `issues` 校验和 35 条探针）。
> 它吃的是**完整 `DesignIntent`**（完整词汇的 0–1 版），不是 AI 的受限 plan。
> 缺的是 **AI plan（受限）→ `DesignIntent`（补默认样式 / 字号）** 的适配层，
> **不是第二个 0–1 → px 翻译器**。不要再写一个 `planToDoc` 去重复它。

待定：

1. 语义计划的 schema（角色 / 槽位 / 主题 / 内容 / 布局模板）；
2. 布局模板与设计 token 放在哪、谁维护；
3. 当前 doc → 语义视图的反向映射（手工改过 px 之后怎么办）；
4. AI 的 `apply_plan` 如何落到编辑器并进撤销栈；
5. 第一步先做语义计划 + 翻译器，还是先做工具壳。

## 9. 子 agent / agent loop 现状（2026-10-18 追加）

用户问：`runner.ts` 是不是锁死的？harness 到底有没有 agent loop？

**有 agent loop，而且是两个：**

| 层 | 文件 | 现状 |
|---|---|---|
| 主对话 loop | `session/chat-session.ts` | 真实 tool loop：流 → `tool_calls` → `execute` → 回喂；`MAX_TOOL_ROUNDS = 6`；当前 `tools` 只有 `skill` |
| 子 agent loop | `subagent/agent-loop.ts` | `runAgentLoop`：model ↔ tools；内置 `finish`；`maxTurns` 默认 12；子 transcript |
| 批量调度 | `subagent/runner.ts` | `runAgentBatch`：并发池 / 父账本 / 批次取消；**没有任何调用方** |

所以：

- `runner.ts` **不是写死了任务**：`system` / `seed` / 批次 `tools` 由宿主传，`jobs[].brief` 才是各任务差异；
- 它"锁死"的感觉来自：**没有 spawn 工具**把主 AI 接进来（旧 `spawn_design_agents` 已随旧契约删除）；
  `runAgentBatch` 目前无 import，子 agent loop 实际是**未接线**状态；
- 要"随心派发"需要：**spawn 工具** + 设计工具集（语义计划 / 翻译器）+ 宿主提供的 system/seed/tools；
  不是把 raw runner 暴露给 AI。

待定：

1. 主对话 loop 与子 agent loop 是否统一（现在两套实现）；
2. spawn 工具的参数：`brief` / `tools` 子集 / `dir` / `maxTurns`，以及哪些由宿主固定；
3. 子 agent 的 `system` / `seed` 用哪份设计系统/语义计划；
4. 子 agent 工具集是否与主 AI 共用同一套语义工具；
5. 第一步先做 spawn 工具，还是先做设计工具集。

## 10. AI 词表分阶段（草案，2026-10-18）

用户方向：图层 / 文字 / 图片 / svg / 形状都可以暴露，但**不一次性全给**；
第一阶段是**草图**——AI 决定"要多少东西、怎么摆"，所以主要暴露**位置 / 结构**。

⚠️ 这里的"位置"必须是**语义位置**，不是 raw px：

- AI 不写 `rect.x = 123`；写 `box / size / name`（`name` 当角色/槽位）；
- 翻译器把锚点、相对盒子、token 落到 `DesignDocument` 的 px；
- raw `rect` / `frame` / points 只给翻译器和编辑器。

### 草图阶段（结构 / 位置）

- canvas **ratio**（不是 width/height 的 raw px）；
- layer：创建 / 顺序 / `name`；element：`type` / `name`、属于哪个 layer；
- **group 不进草图**（组结构后置）；
- position：**0–1 归一化 rect**（x/y/w/h）、rotate、align；
- z-order（层内顺序）；
- `shape.kind`（**只 rect/ellipse**，polygon/path 后置）；`image.fit`；`text.frame` / `align`
  （文字高度仍由排版决定）；
- **可以带可读占位文案 / 占位图**（真实内容后置）；
- **不暴露**：fill / stroke / shadow / font / color / effects / group。

> ✅ **已定（2026-10-18）**：词汇表没有 `role` / `slot`，**不改词表**；
> 用 `name` 当元素的可读角色/槽位约定（如 `hero` / `title` / `cta`）。
> `name` 是显示名，翻译器/模板按它对上角色；AI 不需要额外 role 字段。

### 文字大小（已定 A）

- AI 只给 `name`/角色 + 0–1 rect；**文字只用 x/y/w，`h` 忽略**（高度由排版决定）；
- 字号由角色/模板决定，AI 不写 px；后续你可以在编辑器里把字号调大/调小；
- 最后走 fit/测量，避免溢出。
- B（AI 选 S/M/L）/ C（相对字号）作为以后可选项，第一版不做。

`name` 由 AI **直接写**，**只是自由标签**（`title` / `hero` / `主标题` 都可以）；
**翻译器不解析 name、不做角色→字阶映射**，也没有兜底表。
字号/样式由模板 / element type / 0–1 盒子决定；你后面可以在编辑器里调。

### 占位可读示例

可以给到：

- **文案**：角色合适的短样例（标题 1 行、价格、CTA），不写最终卖点；
- **图**：**内置通用占位图标**（用户给的样子：picture frame + sun + mountains），
  **灰色（#9AA0A6）+ 半透明（opacity .45）**，背景透明，`contain` 不拉伸；
  作为保留 asset id（如 `@placeholder`）注入 assets，plan 的 `image.asset` 用它；
- plan/UI 标“占位”，内容阶段再替换。

`placeholder: true` **不需要**：图片用保留 asset id（`@placeholder`）标记，文案本身就是可读占位；
内容阶段直接把 `image.asset` 换掉即可。

### 内容阶段

- `text.runs`（文案）、`image.asset` / `svg.asset`、素材引用。

### 样式阶段

- fill / stroke / shadow / opacity / radius / fontSize / fontFamily / weight / italic /
  letterSpacing / decoration / 字阶 / 色板。

### 高级阶段

- gradient / multi-layer fill、path text、dropCap、writingMode、blend / filter /
  mask / clip / variations 等。

待定：

1. 占位图标的具体灰/透明度（`#9AA0A6` / `.45` 起步）与背景（透明 / 棋盘格）；
2. 保留 asset id 与放置位置（如 `@placeholder` / `designassets/builtin`）；
3. 文字默认字号/样式由哪份模板 / `type` 决定（**不是由 `name`**）；
4. 草图阶段字段表定稿。

### 已落地（2026-10-18）

- `src/schema/intent.ts`：`DesignIntent` / `Intent*`（从 `workflow/translate` 移出）；
- `src/schema/plan.ts`：`SketchPlan` + `sketchPlanJsonSchema` + `planToIntent()`；
- `src/workflow/translate/translate.ts`：只保留 `translate()`（旧类型 re-export 兼容）；
- `test/schema-plan.test.ts`：6 条（canvas / 图层名 / z-order / text frame / 占位 / schema）；
- 默认：`ratio` 固定基准画布、文字 `fontScale 0.045`、图片/svg `@placeholder`、形状 `#E5E7EB`。
  这些只是第一版默认，后续由模板/设计 token 接管。

### 1+2 已落地（2026-10-18）

- `designassets/builtin/placeholder.svg`：picture frame + sun + mountains；
  `#9AA0A6` + `opacity .45` + 透明背景；
- `server/index.ts` 的 `resolveAssets` 注入 `@placeholder`（data URL，预览/出图通用）；
- `scripts/_probe-sketch-render.ts`：plan → intent → doc → HTML → PNG；
  断言图层名 / 文字 54px / 占位 SVG / object-fit contain，截图 `.tmp-sketch-render-white.png`；
- 结果：探针通过；`tsc` 0 / `vitest` 70；
- ⚠️ `server/index.ts` 改了 ⇒ 需要重启 API；前端不用刷新。
- **2026-10-18 修**：灰底不是占位图——是示例 plan 里一个铺满画布的 shape，默认 `#E5E7EB`。
  `SketchCanvas` 增加 `background`（默认 `#ffffff`）；示例 plan 不再用全画布 shape 当背景。
  占位 SVG 的背景本来就是透明的；现在画布白色、占位图标灰色半透明。

### 3. sketch_plan 工具已落地（2026-10-18）

- `src/designharness/tools/sketch-plan.ts`：
  - 工具 `sketch_plan(plan)`；`layout` 不传，由 `ctx.activeLayout` 决定；
  - `writeSketchPlan()` 纯函数：版式名校验 → `planToIntent` → `translate` → 有 error 不写盘 →
    写 `designs/<layout>/doc.json`；
  - 返回 `{ ok, layout, canvas, layers, issues }`，error 时 `isError`。
- `AgentToolContext.activeLayout` + `ChatSession.send` 的 `activeLayout`：
  `/chat` 的 `activeLayout` → `session.send` → 工具上下文。
- `chat-store.ts` 工具表：`skill` + `sketch_plan`。
- `test/sketch-tool.test.ts`：4 条（正常写盘 / 非法版式 / translate error 不写 / plan 不完整）。
- **不落 `plan.json`**：doc 是可演进产物；颜色/素材阶段 patch doc。
- ⚠️ `subagent-system.md` 仍是旧契约口径；`assistant-system.md` 已于 2026-10-18 重写。

### 4. fontScale + TextFrame（2026-10-18）

- `SketchText.fontScale?`：**模型自由给**的 0–1（相对画布宽），不做 xs/sm/md 枚举；不写默认 `0.022`；
- `IntentTextNode.frame: TextFrame01`（0–1，无 h）；`translate` 把 frame 换成 px；
  **doc 的 text 不再产出 `rect`**（`rectOf` 只给 image/svg/shape）；
- `translate` 的 `fontScale > 0.5` note 保留（不拒绝，只提醒）；
- `assistant-system.md` **只写字段**，不教“怎么设计字号”；设计判断放后续 skill；
- tests 77；probe 的示例文字 26px（0.022 × 1200）。

### 5. AI 上下文 + patch_doc（2026-10-18）

- `buildLayoutNote()` 增加 `layer.name` / `element.name`（摘要里能看出“谁是标题/按钮”）；
- `get_design` 工具：当前 doc 的语义视图（id / name / type / text / frame/rect / fill / stroke / font）；
  按需调用，不每轮塞完整 doc；
- `patch_doc` 工具：元素级、**批量**、**全部合法才写**（有错整批不写）；
  白名单：`fill` / `stroke.paint` / `fontFamily` / `fontSizePx` / `weight` / `italic` /
  `letterSpacing` / `lineHeight`；group 拒绝；
- `chat-store` 工具表：`skill` + `sketch_plan` + `get_design` + `patch_doc`；
- `assistant-system.md` 更新工具/白名单；设计判断仍留 skill；
- tests 81；
- 下一步 C：**画布选中元素 + 用户风格想法 → AI 局部调整**（下一轮）。

### 6. 画廊 DesignThumb（2026-10-18）

- `/artifacts` 每个 design 读 `doc.json` + `resolveAssets`，下发 `doc` / `assets`；
- 新增 `ui/DesignThumb.tsx`：`emitDocument(doc, { assets })` + 只读 iframe + `scale`；
  加载中/失败显示占位 SVG（**不是** `final.png`）；
- `ArtifactGallery`：只有 hover / pinned（`open`）时才挂卡片和 iframe；折叠 = 0 个 iframe；
  卡片沿用 96×72；doc-only 设计也能显示；
- `final.png` 只用于“出图”导出，不再做缩略图/兜底；
- tests 81。

### 7. set-active / active 恢复（2026-10-18）

- `transcript`：新增 `active-layout` 事件 + `setActiveLayout()` / `getActiveLayout()`；
  **`setActiveLayout` 只在 session 文件已存在时写**，不会为了打开旧图创建 session；
- `GET /api/sessions/:id` 返回 `activeLayout`；新增 `POST /api/sessions/:id/active`；
  session 不存在 → `{ ok:false, noSession:true }`，客户端只存内存，首次 `/chat` 再落；
- `/chat` 时把本轮 `activeLayout` 写进 session meta；
- `buildLayoutNote`：系列名字 + 当前 active 摘要；没有 active 时只给系列名字 / 空；
- `get_design` 增加可选 `layout`（默认 active，传了读系列另一张）；
- App：`loadSessionMessages` 按服务端 `activeLayout` 恢复（有就打开，没有就空预览）；
  切会话/刷新同样；打开版式时 POST `set-active`；新会话/改 workdir 清空；
  **不自动打开最近/唯一**；
- tests 81。

### 8. generate_assets（2026-10-18）

- 新增 `designharness/tools/generate-assets.ts`：
  - `images`：商品/场景，走 `assetsgen` 的生图模型（PNG）；临时 `createBlinkRenderer` 作为候图 host；
  - `icons`：主 AI 直接写的**线框 SVG**，`sanitizeSvg` 检查（script/on*/javascript:/foreignObject/外链）后落盘；
  - **只写文件，不改 doc、不发 artifacts**；
- `patch_doc` 白名单加 `asset`（仅 `image` / `svg`）；AI 生成后用 `patch_doc` 把节点指向文件；
- `chat-store` 注册；`assistant-system.md` 写清用法与“不要重跑 sketch_plan”；
- 素材库兜底/子 agent 暂不做；
- tests 85。

### 9. doc-patch / artifacts.open（第一拍，2026-10-18）

- `sketch_plan`：
  - 新建 layout → `artifacts { layout, created, open: !hadActive }`；
  - 已有版式更新 → `doc-patch { layout, doc }`；
- `patch_doc`：**写盘**（同一轮 `get_design` 立刻一致）+ 发 `doc-patch { patches }`；
  App 把 patches 应用到**当前内存 doc**（保留用户尚未自动保存的改动）+ `commitLayout` +
  自动保存；`PreviewPanel` 就地更新 DOM，不重挂编辑器；
- `artifacts.open=false` 只刷画廊，不抢预览；`open=true` 才 `openLayoutByName`；
- `VocabEditorHandle.applyExternalDoc(next, label)` 用 `pushCommand` 追加进撤销栈
  （不 reset）；`PreviewPanel` 外部 doc 改走它，DOM 仍整层重发。AI 修改可 Ctrl+Z；
- tests 85。

### 10. 工具可选 layout（2026-10-19）

- `patch_doc` / `generate_assets` 增加可选 `layout`（默认 active）；`get_design` 已有；
- active 仍是用户当前预览，系列图不抢 active；`sketch_plan` 新建返回 `layout`，
  同一轮后续工具用它，不假设 active 已切；
- 错误分两种：没有 active 且没传 layout；传了但版式不存在；
- tests 85。








