# 参考研究：Editable-Design（Editable Visual Design）

> 对象：`D:\desktop\Editable-Design-main`（GitHub: `yejy53/Editable-Design`，Apache-2.0，技术报告 arXiv 2609.04034）
> 方法：只读通读该项目**全部文档与脚本**（SKILL.md / references / starter / 17 个工具脚本 / 编辑器 1929 行 JS /
> 回放模板 / 两个兄弟技能 / 仓库基础设施），我自己直读关键文件，长脚本由 4 个并行子代理交叉复核。
> **未做视觉评审**（当前模型无图像输入能力），成品质量结论只引自项目自有说明。
> 本文里凡"实测/测得"字样，均为**项目自己写在其文档里的数据**，不是我复现的。

---

## 0. 一句话结论

这不是一个"出图工具"，而是**一套把「agent 写 HTML 海报」变成可验收、可交付、可复核的工程协议的 Skill 包**：
三份 Codex Skill（`editable-design` / `html-to-pptx` / `paper-fig`）+ 一套**自带浏览器验收的确定性脚本**
+ 一份**证据回放（Agent Design Replay）**。它最值得 Vinart 借的不是设计技巧，而是
**"确定性判定 / 反向验证 / 证据留痕 / 失败可修"这四条工程纪律**，以及 38 条用真金白银踩出来的 DOM 固化陷阱表。

---

## 1. 它是什么：定位与血缘

- **形态**：Codex（及 Claude Code 一类宿主）的 **Skill 仓库**，不是应用、不是库、无构建产物。
  用户侧交互是自然语言（"Use \$editable-design to create ..."），安装是 `cp -R skills/editable-design ~/.codex/skills/`。
- **主张**：Visual Code（HTML/CSS/SVG）作为内容创作的新载体 —— 交付物不是一个像素终稿，
  而是**文字真实、图层独立、可继续修改的稿件**；再配 PNG 预览、鼠标编辑器、分层拆解稿、agent 工作过程回放。
- **研究背景（`site/content/blog/genclaw-next.zh.md`，项目自述）**：
  - 观感差异的主因不是"模型没审美"，而是**素材缺口** —— HTML/CSS 擅长结构排版，不擅长画电影感背景/3D 主视觉/插画；
  - 只挂工具没用，模型不会主动"停下来想这里该有张图"，于是加一步 `design.md`（先规划画面要什么，再写代码）；
  - 进一步把设计行为**蒸馏**进模型（context distillation，靠激活 Unsplash ID 记忆；Qwen-3.6 27B SFT 后相对分数 +209，数据来自其自建简化模拟）；
  - **"先想象，后行动"**：把图像模型前置成 Coding Agent 的"视觉世界模拟器" —— 先出一张概念参考图定构图/光影/氛围，再写真实内容与可编辑结构（海报两两比较偏好 63% vs 37%）。
  → **本项目所有的工程机制，都是为了让这条"参考图 → 计划 → 素材 → 代码 → 验收 → 回放"链路可复现。**

---

## 2. 仓库地图

```
Editable-Design-main/
├── skills/editable-design/     ⭐ 主技能（约 40 个文件；本篇 90% 内容）
│   ├── SKILL.md                628 行 · agent 操作手册（流程 + 判据 + 交付契约）
│   ├── references/             7 篇按需阅读的参考（排版/素材/字体/素材架构/编辑器/回放）
│   ├── assets/                 poster-starter（起始工程）+ editor（编辑器运行时）+ replay（回放模板）
│   ├── scripts/                17 个确定性脚本（bash + mjs + py）
│   └── font-kit/               Fontsource 字体套件（按需拷贝 WOFF2）
├── skills/html-to-pptx/        HTML → 可编辑 PPTX（Python + Playwright）
├── skills/paper-fig/           论文方法图 → 可编辑 PPTX（含多个"反造假" gate 脚本）
├── gallery/                    案例素材（实测 20 个目录 / 17 个 prompt.md；README 只列 13 个）
│                               final.png + preview.webp + prompt.md + agent-replay-poster.webp
├── site/                       Next.js 双语文档站 + 博客（含 5 张统计图）
├── tools/blog-charts/          统计图生成（HTML → PNG）
├── docs/paper-fig.md · NEWS.md · TOOLKIT.md · README.md（40KB 展示页）
├── notes/                      agent 自己写的图表核对/评审笔记（blog-chart-audit · blog-chart-review）
└── pack.sh                     打包三个 Skill 的源码 tar（白名单式，排除 node_modules / pycache / .venv）
```

**注意**：仓库里**没有任何一个真实生成工程的完整产物**（没有 `editor.html` / `layers.html` / `replay/index.html` 样例，
也没有样例 `index.html`）—— 只有 starter 与 gallery 的成品图。想看真实产物必须自己跑一次。

---

## 3. 主链路：15 步一次的 poster build（`SKILL.md`）

交付物（固定 5 件，术语是固定的英文标签）：

| 标签 | 文件 | 性质 |
|---|---|---|
| Final Design | `out/poster.png` | 渲染终稿 |
| Editable Source | `index.html` | **唯一真源**：单文件、CSS 内联、零外部请求 |
| Visual Editor | `editor.html` | 由 `wire-editor.mjs` 注入运行时生成，**不改 index.html** |
| Layer Breakdown | `layers.html` | 独立分层拆解动画页，由 `verify.mjs` 在验收通过时顺带产出 |
| Agent Design Replay | `replay/index.html` | 七个阶段的证据回放页 |

流程（`SKILL.md` §One-shot build 编号 1–15，与证据阶段 id 绑定）：

1. 读 starter 的三件（`index.html` / `poster.json` / `README.md` 里的契约）
2. **定画布**并写进 `poster.json`；根元素 `width/height` 必须等于 `data-canvas-*` → `trace decision canvas`
3. **参考图阶段**（`art-directed` 默认开）：增强 prompt → 生成 → 存 `reference/` → 读图 → 记 `P02_reference`
4. **一次成型的整合设计决策**：文案、层级、素材拓扑、图层顺序、配色角色、字体栈、区域几何 →
   `design-plan.md`（≥2 个素材时另写 `asset-plan.json`）→ `P11_asset_plan`
5. **批量生成素材**（≤10 并发、all-settled、失败只重试失败项）→ `import-asset.sh` → `prompts.md` → `P12_generate_imagery`
6. **一次完整布局补丁**：单文件、CSS 内联、绝对定位、**每个承担版式的尺寸都是固定 px**、`:root` 声明配色与字体栈、**不写注释**
7. `check-fonts.sh index.html`（字体没装**不会报错**，只会静默回落 → 必须显式查）
8. 清脚手架（删 `.preview-*`、删 `poster-preview` meta、删未引用素材）→ `cleanup-checklist.json`
9. `check-poster.sh index.html`（纯 shell 静态契约）
10. `check-contract.mjs`（真浏览器量测契约）→ `P14_contract`
11. `render-poster.sh index.html out/poster.png` → **回读 PNG 真实像素尺寸**比对 → `P15_render`
12. **自己读渲染图**（逐行念出所有文字、查遮挡/占位字/对比度）→ `render-review.md` → `P16_read_render`
13. `wire-editor.mjs index.html` → `editor.html` → `P17_editor`
14. `verify.mjs index.html`（几何+像素零漂移、编辑/导出往返、拆解视图全验收，通过才落 `layers.html`）→ `P17_layers`
15. `build-replay.mjs .` + `verify-replay.mjs replay/index.html` → `P18_replay` → `trace finish ok`

**证据文件**（全部是"真产物副本"，不是回忆）：`brief.md`（用户原话，逐字）、`design-plan.md`、
`asset-plan.json`、`prompts.md`、`render-review.md`、`cleanup-checklist.json`、`reference/`、
`.trace/`（manifest.json + events.jsonl + steps/exec-*.{stdout,stderr,json} + artifacts/）。

---

## 4. Agent 行为规约里最"硬"的几条（可直接迁移到 Vinart 的 skill/system prompt）

1. **你是设计师，不是顾问**：不许给选项、不许停下来等用户挑；拿不定就选一个并说明理由。
2. **只有"事实"必须问**：价格、日期时间、地点、联系方式、品牌/产品准确名称、法律声明。
   编一个就发出了一条假信息，比留空更糟。**其余全是判断，判断是你的活。**
3. **沟通预算**：每个用户可见阶段最多一条短更新（准备/设计/交付）；恢复得了的技术问题一律自己咽下去。
   面向非技术用户，术语（工具、命令、路径、退出码、渲染器）不出现在给用户的话里。
4. **参考图三条铁律**：① 参考图**永远不是素材**（存 `reference/` 不存 `assets/`，绝不裁进画面）；
   ② 参考图的**像素永不交付**（每个字都在 HTML 里重排；但它的**文案**可以采纳，会被点名致谢；
   **事实除外** —— 价格/日期/地点/品牌仍来自用户）；③ 素材架构在读图**之后**定。
5. **不要模型自绘 SVG 插画**：图形内容要么是生成的栅格素材，要么是排版与几何。
6. **素材拓扑按"视觉拓扑"选，没有默认**：slot matrix / code-native modular field / continuous scene /
   cutout stack / layered collage。共享光照透视的元素别拆（缝会露），语义独立的元素别合。
7. **文字压图必须显式做对比度处理**（实色面板 / scrim / 定向渐变）；scrim 的硬边要么通到画布边，要么淡出。
8. **交付时逐行念出渲染图上的所有文字**；读不出来的都是缺陷，无论标记看起来多正确。
   "看着差不多但没读图"= 没完成。
9. **同一个问题两次修不好，说明你的诊断错了**：停下、再看图、改假设，而不是改措辞。

---

## 5. 素材生成：用数据写下来的经验（`references/imagery.md`）

这是全仓最"反直觉但被量化"的部分：

- **预留文字区，只能描述外观，不能提占用者**。
  `WRONG: "leave clean dark negative space at the top for the headline"` →
  `RIGHT: "the top third is a continuous, low-detail, darker sky with no objects, symbols, borders, or high-contrast marks in it"`。
  项目自述实测：**提占用者 10/10 出伪影（画出真字、空椭圆或色条）；只描述外观 0/13**。
  触发词是 "for the headline" / "space for the logo" / "room for the price"。
- **负向指令无效**：`"no text, no lettering"` 实测零效果。原因是当前后端多不是扩散模型（多模态模型生成图像时
  **没有负嵌入通道**，否定只是多几个 token，而模型本来就处理不好否定）。能起作用的是"描述外观"。
- **你写的比例是意图不是契约**：同一后端两次实测，要"右侧干净 16%"得到 22%，要 34% **得到 11%**。
  所以**不许按你要求的数字排版**，要么先用条带扫描实测素材的墨迹边界，要么留远超需求的余量。
- **尺寸优先用参数**（确定性），少用散文描述画幅（概率性）；比例不对就 `object-fit` + `object-position`
  有意识地裁，**绝不拉伸**，并**朝"不承载文字的带"裁**。
- **全出血背景用"横带"写法**：每带一句，给四件事 —— 位置与高度占比、材质、明暗、细节密度。
- **prompt 一律写英文**，即使海报是中文（模型更稳，且 prompt 不会出现在成品上）。
- **透明是输出控制，不是风格提示**：能传 `background=transparent` 就传，用 PNG/WebP；
  导入前**验证 alpha 通道存在且四角透明**（RGB 文件里画着棋盘格 = 已经烘焙进像素了）。
- **一次调用只能产出一个可独立编辑的文件**，别指望"一张图里几个分离主体"变成几个透明素材。

---

## 6. 契约与校验：四道门，逐层变贵

| 门 | 工具 | 成本 | 抓什么 |
|---|---|---|---|
| ① 静态契约 | `check-poster.sh`（纯 shell/sed/grep） | ~0 | 打包级错误：画布声明与 poster.json 不一致、缺 `position:relative`/`overflow:hidden`、残留 starter 占位、`<script>`、`@media`、vw/vh/%、外链、`data:` URL、重复 `data-layer-id`、素材相对路径不存在 |
| ② 量测契约 | `check-contract.mjs`（真浏览器） | 一次启动 | 声明 vs 实际尺寸 ≤1px；`data-layer-id` 唯一/非空/**不嵌套**；`data-explode-group` 唯一/非嵌套/≥2 成员/role 合法；**文字命中区不被遮挡**；**改视口坐标不变**；字体已加载；零控制台报错 |
| ③ 固化验收 | `bake.mjs`（真浏览器） | 两次启动 | 文档流 → 纯绝对定位，**逐层坐标 |Δleft|,|Δtop| ≤ 1px**，残留 `hf-`/`layer-editor` 则拒 |
| ④ 交付验收 | `verify.mjs`（真浏览器，最多跑 4 个页面） | 分钟级 | **几何 + 像素双门**零漂移、拖拽/缩放手势、文本编辑、undo/草稿、拆解视图、导出往返，全过才落 `layers.html` |

两个特别值得抄的判定设计：

- **C2-viewport 用"改视口再量"代替"正则查 vh"**：`check-contract.mjs` 先按 1400×1000 量一遍，
  再 `setViewport(1000×1500)` + 双 rAF 再量，要求所有图层漂移 ≤ **0.5px**。`%` / `vmin` / `calc()` 混用全都跑不掉 ——
  **行为判定 > 文本判定**。
- **C5-text-hit 用 `elementFromPoint` 判"能不能真的双击到文字"**：对每个文字叶（递归取"无子元素或自身含非空文本节点"的节点，
  剪掉 SVG 子树）先 `scrollIntoView({block:'center'})`，取中心点做命中测试，`closest('[data-layer-id]')` 不等于所属图层即报错。
  **像素没重叠 ≠ 交互框没重叠** —— 这条是"看起来点中了文字、永远进不去编辑态"的根治手段。
- **像素门必须配双阈值**：`changedRatio ≤ 0.5%` **且** `meanAbs ≤ 0.05`（每通道容忍 2）。
  只看比例会放过"少量像素巨差"，只看均值会放过局部错层。并且先做 `Buffer.compare(pngA,pngB)===0` 的**字节快路径**。
- **`verify.mjs` 只在 `fails===0` 时才写 `layers.html`** —— 刻意不落地未验收的产物。

`_browser.mjs` 的测量纪律（复制这条能省掉一类玄学 bug）：
`networkidle0` → 可选等 `html[data-hf-ready]` → `document.fonts.ready` → 等所有未完成 `<img>` 的 `load`/`error`
→ **静置 350ms** → 才量。并且截图刻意不用 `ElementHandle.screenshot()`（它会先滚动到可见区，竖版海报在部分 Chrome 上会卡住），
改用 `page.screenshot({clip})` 顺序截。

`check-poster.sh` / `check-contract.mjs` / `verify.mjs` **互不调用**，串联它们的是 SKILL.md 的流程 ——
即"编排在提示词里，判定在脚本里"，脚本本身保持单一职责与可单独运行。

---

## 7. 字体：一个"沉默失败"的专用闸门（`check-fonts.sh` + `font-kit.mjs`）

**问题**：字体没装**不会报错**——浏览器静默回落、渲染成功、尺寸校验通过，只有字悄悄错了。

**解法（很巧）**：起一个临时 headless Chrome，在页面里用 canvas `measureText` 对每个 family 取
**双字号（48/73px）× 五个度量（width + ascent/descent/left/right 包围盒）** 的"度量签名"，
与 `serif` / `sans-serif` / `monospace` 三个基线分别比对；**只要与任一基线不同**即认为该 family 真实存在。
- 为什么不用"不存在的哨兵字体"：`PingFang SC` 恰好是 macOS 的默认 CJK sans，叠在哨兵上度量字节相同 → 会被误判缺失。
- 同时分别用拉丁样本 `AWmgQ019jil` 与中文样本 `晨雾高山茶永` 探测，输出 `ok cjk + latin` / `ok latin only` / `MISSING`，
  并明确警告：**标 `latin only` 的 family 不得用于排中文**。

**字体套件**：10 个角色化 ID（`editorial-serif` / `luxury-serif` / `clean-sans` / `geometric-sans` / `condensed-sans` /
`experimental-display` / `cjk-sans` / `cjk-serif` / `cjk-calligraphy` / `cjk-display` → 对应 Fraunces / Bodoni Moda /
Instrument Sans / Space Grotesk / Roboto Condensed / Unbounded / Noto Sans SC / Noto Serif SC / Ma Shan Zheng / ZCOOL XiaoWei）。
`font-kit.mjs add <id> index.html` 会：只拷该设计用到的 WOFF2 到 `assets/fonts/<id>/`、**连带拷 LICENSE**、
把 `@font-face` 注入 `<style>` 开头、在 `:root` 注入 `--font-kit-<id>`（供编辑器当"可选字体栈"切换）。
一条产品级洞见：**排版用的字体数量（2–3）与编辑器暴露给用户的字体角色数量（3–5）是两件事，不要混。**

---

## 8. 渲染出图（`render-poster.sh`）

- 直接调**宿主浏览器**的 headless `--screenshot`，`--force-device-scale-factor=<scale>`、`--window-size=W,H`；
  `scale` 来自 `poster.json`（默认 2），`--dpi N` 时 `scale = N/96`（印刷 300dpi ⇒ 3.125×）。
- **每次都新建临时 profile**（避免占用用户已开的浏览器、避免并发抢锁、保证 localStorage 干净），
  并且**按 `--user-data-dir` 反查 pid 组来 kill**（含 SIGKILL 兜底），因为 headless 有时不自己退出。
- **回读产物真实尺寸**：不依赖任何图像库，直接按 PNG 的 IHDR 规范读字节 16..23（`od -An -tu1 -j16 -N8` 后大端拼装），
  与 `width*scale` 比对，不符即 exit 3。理由写得很直白：**画布与窗口不一致时浏览器会静默给出另一个尺寸，图看起来完全正常。
  信产物，别信渲染器的退出码。**
- 脚本末尾把话交给 agent：**"接下来读这张图，逐行念出上面每一个字。"** —— 明确声明"DOM 检查看不到这些"。

---

## 9. 可编辑性的代价：固化（bake）与 38 条陷阱（`editor-pitfalls.md`）

这是全仓最"贵"的知识。核心矛盾：**agent 手写的是文档流 HTML（弹性、好写、好看），
而编辑器要的是绝对定位图层（可拖、可量、可导出）**。`bake.mjs` 就干这件事：挂上编辑器跑一次固化导出，
再把导出物**放回浏览器量一遍**，逐层比对 ≤1px，不达标就**丢弃产物**。

为此付出的代价是 T1–T38 一整套陷阱与对策，挑最能迁移的几类（原文编号保留）：

**固化阶段（T1–T11）**
- **T1 严格两趟**：先全量测量并缓存，再统一写入（边量边改会让后续元素上跳）。
- **T2 容器塌陷**：抽走子图层后容器高度塌了，`bottom` 定位的容器整体上移，容器内**没被抽走**的元素（如分隔线）跟着跑位
  → 测量阶段就记录所有"含图层的祖先容器"，抽离前把 `width/height` 钉死。
- **T3 margin 残留**：转 absolute 后 `margin-top` 仍生效 → 写入时统一 `margin:0`。
- **T4 不是清掉 transform 就完事**：清了能解决 `translateX(-50%)` 的重复偏移，但会抹掉邮戳/回形针/手写贴纸的设计旋转
  → 分别保存"未变换布局尺寸 / computed transform / transform-origin"，提升后重施矩阵，再用可见包围盒差值反算 `left/top`。
- **T6 上下文样式丢失**：元素移出原容器后 `.dark-card .label` 不再命中，绘制次序也可能翻转
  → 提升前保存发生变化的 computed/pseudo 样式并最小化内联，按顶层 stacking 顺序分配 z 段。
- **T7 宽度塌缩**：文档流元素宽度由父容器给定，转 absolute 后塌成 `fit-content`，**文字重新换行** → 写入测得的 width。
- **T8/T9 测量前提**：字体没 loaded 量到的是 fallback 的坐标（整版偏移）；图片没加载完高度为 0，
  且**加载失败也必须放行**（否则一张坏图卡死整个编辑器）。
- **T10 DOM 提升顺序会反转**（依次插入同一锚点）→ 每组维护滚动锚点。
- **T11 被抽空的容器仍会捕获 pointer 事件**挡住下层 → 锁尺寸时一并 `pointer-events:none`。

**交互阶段（T12–T19）**
- **T12 `pointerdown` 里 `preventDefault()` 会抑制后续 `click`/`dblclick`**（Pointer Events 规范），表现为**双击根本进不去文本编辑**
  → 不在 pointerdown 阻止默认；防误选文字改为"移动超过阈值后再 `user-select:none`"。
- **T13 `setPointerCapture` 会把后续 click/dblclick 的 target 重定向到捕获元素** → 指针捕获推迟到确认拖拽之后；
  `dblclick` 不信任 `e.target`，改用 `document.elementFromPoint()` 重新命中。
- **T14 画布整体 `scale` 后**：`dx = (e.clientX - startX) / scale`（不换算就不跟手）。
- **T16 中文输入法**：组字期间 Esc 是"取消候选词"、Enter 是"上屏"
  → 按键处理第一行就 `if (e.isComposing || e.keyCode === 229) return;`。
- **T17 文本编辑粒度下沉到"文本槽"**：整层 contenteditable 会让多字号拼排（价格 `杯/数字/元` 三个 span）一退格就崩
  → 编辑单元 = 图层内只承载文字的叶子；图文混排节点整体算一个槽；SVG 子树排除。
- **T18 `contenteditable="plaintext-only"`**（外带格式会污染海报）。
- **T19 手动宽度锁定**：默认提交时按需扩宽且**不主动收窄**；一旦用户用过宽度手柄，就标记手动宽度，
  后续文字/字号编辑保留该宽度。

**测试与环境（T20–T38，摘）**
- **T20 Puppeteer 的 `clickCount: 2` 不产生 `dblclick`**（`detail` 恒为 1）→ 手动发两轮 down/up，第二轮 `clickCount:2`。
  （这条直接是"假红/假绿"的来源，写 UI 测试必踩。）
- **T21 headless 被用户已开的实例干扰** → 每次全新临时 `--user-data-dir`。
- **T24/T25 字体断言**：`document.fonts` 含所有声明的 `@font-face`，未使用的一直 `unloaded`（正常）；
  中文字体被切成上百个 `unicode-range` 分片，**只有"没有任何分片被加载"才算这个 family 真没用上**。
- **T31 只比 `getBoundingClientRect()` 会把"坐标没变、底色/伪元素/图片/层级已丢"的稿件误判为零偏差**
  → A 类验收**同时**做几何比较与像素比较：**几何负责定位，像素负责视觉真值**。
- **T28 拆解动画必须确定性**：终态只由 `left/top` 决定；动画只叠加 WAAPI 的 `transform/opacity/filter`，
  播完取消动画回到 CSS 终态；支持 `prefers-reduced-motion` 与 `?motion=0`。
- **T29/T33/T36 拆解舞台几何**：平衡舞台 `max(1.7×画布宽, 1.275×画布高)`；终态 2–5 列；
  中央不留常驻完整成稿或大空背景；一级有效组件 <5 个时把"组内有文字的叶子"提升为同级补充 tile（**一级密度回退，不做二级钻取**）。
- **T37 缩放手柄不能画在已 `scale()` 的画布内**（命中区会随之变小）→ 在未缩放舞台维护独立选框，
  显示坐标乘 `scale`、指针位移除 `scale`，手柄用 ~32px 透明命中区包住 12px 可见标记。
- **T38 手势必须有出口**：真正拖拽前还没有 pointer capture，此时指针在画布外松开/失焦/浏览器取消手势，
  `pointerup` 可能永远不到达，旧手势保持 armed → window capture 阶段兜底 `pointerup/pointercancel`，
  监听 `lostpointercapture`、窗口失焦、页面隐藏；`pointermove` 发现主键已松开立即结束；Esc 取消并恢复。

**另有一条通用陷阱写在 `references/layout-typography.md` 里，值得单独记住**：
**带 `letter-spacing` 的单行块必须配 `white-space: nowrap` 或显式宽度** ——
CSS 会给最后一个字符之后也加字距，量出来的宽度比字形宽一点点；任何"把量到的宽度写回去"的环节
（例如编辑器把布局转成绝对定位）都会把最后一个字挤到第二行，**块高翻倍且不报任何错**。
同理：**`* { box-sizing: border-box }` 永远要有** —— `getBoundingClientRect()` 报的是含 padding 的视觉宽度，
content-box 下把量到的宽度写回 `width`，一个 `padding: 20px 44px` 的胶囊标签**每往返一轮就宽 88px**。

---

## 10. 编辑器运行时（`assets/editor/layer-editor.js`，1929 行，零依赖 IIFE）

**边界（与本项目路线相反的取舍，先看这条）**：它**不注入 iframe、不用 shadow root**，
被编辑的文档就是宿主页面本身 —— 脚本直接取 `[data-canvas-width]`，**把画布搬进自己新建的 `.hf-stage`**，
导出时克隆 `document.documentElement`。全套 UI 动态创建（海报 HTML 里不留痕迹）、`hf-` 前缀隔离、
`data-hf-*` 属性只作运行时标记并在导出时全部剥掉。

**架构**：没有 store、没有订阅，只有一个可变对象 `state`
（`scale / sel / layers / undo[] / initial / removed[] / ui / exploded / spread / spreadGeometry / groups / motion / transitioning`）。
**几何真值就是 DOM 内联 style**（`left/top/width/height` + `data-hf-width-locked` / `height-locked`），
`state` 只存元素引用。初始化 `ready()`：`document.fonts.ready` → 等所有未完成 `img` 的 `load`/`error`（坏图放行）
→ `bake → markSlots → buildUI → buildFontSelect → buildStage → wire → loadDraft → rebuildPanel`
→ 挂 `window.__layerEditor` + `html[data-hf-ready]`（**这是所有自动化脚本的锚点**）。
缩放只压在 canvas 上（`transform: scale(s)`），**覆盖层活在未缩放的 stage 坐标系**，
所以手柄命中区恒为屏幕 32px（与 T37 对应）。

**层识别**：唯一标识 `[data-layer-id]`（任意深度，bake 时提升为画布直属子节点）；
**背景排除不靠白名单，靠补集** —— 从克隆里删掉所有 `[data-layer-id]` 与已注册的 `[data-explode-group]`，
剩下的就是"背景基底"tile（未标 layer-id 的全幅底图/纹理/scrim/固定画框天然不进图层列表）。
分组 `data-explode-group` / `data-explode-label`，成员由嵌套或显式 `data-explode-parent=<id>` 声明，**成员 < 2 的组被丢弃**；
`data-explode-role ∈ {surface,image,copy,icon,decoration}` 只影响 z 段与筛选。

**手势**：全用 Pointer Events；`pointerdown` **刻意不 preventDefault、也不 capture**（T12/T13），
越过 `hypot > 2px` 才真正开拖：此时才 `setPointerCapture`、`userSelect:none`、清选区、`pushUndo`。
换算 `dx = (clientX - sx) / state.scale`；写回 `left/top`（不是 transform）；作者原有 transform 在 bake 时保存并保留。
8 个手柄是静态模板 `data-hf-resize-dir="nw|n|ne|e|se|s|sw|w"`，32px 透明命中盒包 12px 可见点；
左右手柄 → `hf-width-locked`，上下 → `height-locked`；最小尺寸 24×16，夹在画布内。
**有吸附**（`SNAP=8`，比较 3 条竖边 × 画布 0/中/宽 + 每层左/中/右，`Alt` 临时关闭）与
**键盘微调**（方向键 1px / Shift 10px）；**无网格步进、无 redo**。
收尾在元素与 window capture 双保险 + `lostpointercapture` + blur + `visibilitychange`（T38 五重出口）。

**文本编辑**：`dblclick` 不信 `e.target`，用 `document.elementFromPoint()` 重命中 `.hf-slot`（T13）；
`resizeOverlay` 上另有一个 dblclick 处理器（临时隐藏选框再命中，解决手柄盖住窄文字层）。
进入编辑用 `contenteditable="plaintext-only"` + Range 全选；Enter 提交 / Esc 回滚；
**IME 保护在第一行**：`e.isComposing || keyCode === 229` 直接 return，并 `stopPropagation()` 防方向键被拿去挪层。
字号/字体作用于**图层内全部槽**；字号是**比例**步进（1.08×）；字体候选从可读样式表的 `:root` 规则里筛
"值含 serif/sans/mono/cursive/fantasy 的 `--*`"，**不注入 @font-face**。
**"用户框宽"用三件小事表达**：`data-hf-width-locked` 位 + 只用 `max-content` 量自然宽 + **只扩不缩**
（`min(max(当前宽, 自然宽), 画布宽 - left)`）。

**撤销 / 草稿 / 导出**：只有 undo（单数组，无上限、无 redo）；粒度 = 一次手势/一次按键/一次提交；
**取消手势时会 `discardGestureUndo()` 弹掉刚进栈的那条**（不留空条目）；
删除记 `{parent,next,idx}` 支持原位插回。
草稿 key = `hf-draft:${location.pathname}:${sourceRevision}:${runtimeRevision}` ——
`runtimeRevision` 由 `wire-editor.mjs` 写入 `sha256(css+js)` 前 10 位，`sourceRevision` 是源 HTML 的 sha256 前 12 位，
并作为 `?v=` 缓存串加到 link/script；`snapshot()` 序列化 `{removed, layers:[{id,left,top,width,height,manualWidth,manualHeight,slots:[{html,fs,ff}]}]}`，
500ms 防抖写 localStorage，启动自动恢复并可"丢弃草稿"。
**导出不内联任何资源**（没有 base64 / fetch / FileReader / toDataURL）—— 自包含性完全依赖原稿本身。

**拆解视图（scan / explode / collapse）**：终态**不是 grid/flex**，是手算的 2–5 列绝对定位
（`laneCount = clamp(ceil(records/5),2,5)`，贪心分道：权重最小者胜、代价项 `|i-desired|*0.16`，道内按 top 排序求公共 shrink）；
tile 内部用 `.hf-exploded-crop` 的 `transform: scale()` 缩放、靠 source 的负 left/top 裁切；
舞台 `max(1.7×画布宽, 1.275×画布高) × 画布高`。**"一层"是硬规则**：不做二级钻取；
一级内容 < 5 个时，把"组内有文字且 role 非 surface/image/icon/decoration"的叶子升为同级补充 tile。
动画全用 WAAPI（只动 `transform/opacity/filter`，终态由确定性 left/top 决定，`MOTION={scan:760, scanOverlap:.78, duration:780, reverse:620, stagger:58}`，
起点所有 tile 叠回成稿矩形 → 扫描束 → 错峰散开带 overshoot），
**collapse 就是同一个函数 `reverse=true`**；`prefers-reduced-motion` 与 `?motion=0` 直接切终态。
进拆解前**缓存 `spreadGeometry`**（T27：画布 `display:none` 后再量全是 0）。

---

## 11. Replay：把"agent 说它做了"变成"文件里确实有这次改动"

七个 **硬编码** story stage（`build-replay.mjs` 里的数组，`kind` 同时是图标名）：

| id | kind | phase | 标题 | 有证据 | 缺证据 |
|---|---|---|---|---|---|
| `input` | input | think | 需求输入 | 原始记录 | 记录缺失 |
| `reference` | reference | think | 视觉参考 | 已确定 | 证据不完整 |
| `plan` | plan | think | 设计规划 | 已决策 | 记录缺失 |
| `assets` | assets | make | 素材生成 | 已生成 | 无生成素材 |
| `html` | html | make | HTML 构建 | 已渲染 | 已编码 |
| `review` | review | prove | Review 反馈 | 已修正 | 记录缺失 |
| `layers` | layers | prove | 分层展示 | 已验证 | 未生成 |

⚠️ **`P0x` 不是 stage id，是 trace 的 step 名**（`P01_input` / `P02_reference` / `P09_canvas` / `P11_asset_plan` /
`P12_generate_imagery` / `P14_contract` / `P15_render` / `P15_html` / `P16_read_render` / `P17_editor` / `P17_verify` /
`P17_layers` / `P18_replay`）；`trace.sh` **不校验 step 名**（任意字符串），所以 P 号是约定而非 schema，
`P03–P08/P10/P13` 根本没有定义。其它内容（画布选择、字体检查、清理、命令日志）"remain in `.trace`"，
是阶段内的元数据而不是独立故事节点。

**采集侧（`trace.sh`，纯 bash，零依赖）**：`init / start / done / decision / note / artifact / run / finish`。
产物 `.trace/`：`manifest.json`（`schema:"runlog/v1"`、run_id、workspace、label、status）、
`events.jsonl`（逐行 `{seq,ts,type,...}`，`seq = wc -l + 1`）、
`steps/<step>/exec-NN.{json,stdout,stderr}`（记 command / exit_code / duration_s）、
`artifacts/<step>/`（**真复制字节**并记 `bytes`）。
三道"记录=事实"的硬闸：`artifact` 先 `test -e` 再复制（否则 exit 2）；
`run` 真执行、真重定向 stdio、真透传退出码；
`decision` 的 why **必填** —— 原话 `why is required — a decision without a reason is not worth recording`。
没有 trace 就 `exit 2`（"trace: no active trace. Run trace.sh init first"），杜绝事后补账。

**汇编侧（`build-replay.mjs`）**：归阶段**不看 events 的 step 字段**，靠"路径约定 + 硬编码七段"；
events 只提供四个派生量（`T+MM:SS` 时间标签、`P15_render` 执行次数、`render-review.md` 里 `## Pass` 计数、sources 里的 `.trace/events.jsonl`）。
产物是**目录**：4 个模板文件 + `icons/` + `data.js`（`window.__POSTER_REPLAY__ = {...}`）；
**图片与 HTML 都不内联**（`browserPath()` 给 `../相对路径`），只有**文本**证据进 `data.js`，
所以 `file://` 打开**不依赖 fetch**。有硬编码裁剪（`codeExcerpt` 5200 字符、`fullCode` 80k、viewer 侧再裁 520/880/…）。

**校验侧（`verify-replay.mjs`）**：`vm.runInNewContext` 读 `data.js`，断 schema、七个 stage id 顺序、
每段 `sources` 是数组、`layers.preview` 不含 `motion=0`；其余约 30 条断言几乎全是**模板源码字符串断言**
（离线无 `http(s)://`、无 `fetch(`；phase 卡 210×210 / 56px 图标 / 19px 标签；7 条 flow path id；
`INTRO_DURATION = 4700`；坐标 `2540px`；甚至还带**反断言**：旧的曲线路径字符串**必须不出现**）。
**缺失证据只 ⚠️ 警告，不算失败。**
⚠️ 它**不开浏览器、不加载图片、不解析 PNG** —— "配对/渲染/评审/层预览是否真的加载"是间接证明，
真正的"打开一次确认"写在 SKILL.md 步骤 15，是**人工动作**。

**有意为之的约束（原文）**：
`The Replay is a deterministic view of the actual run, not a second design task.` ·
`Do not ask the model to redesign the Replay, summarize the run from memory, add generic "why this was done" commentary, or reconstruct missing prompts.` ·
`It must never reconstruct a missing prompt or decision from memory. Missing evidence stays visibly missing.` ·
`Do not invent a pass merely to make the Replay look active.` ·
`The fixed template, not the agent, designs this page.` ·
`Replay is a local evidence artifact and may contain the original brief, prompts, attachment paths, and design decisions. Review it before sharing.`

**局限（我从代码读出）**：无内容哈希/签名（`artifact` 只记 bytes，文件被换无从发现）；
`init` 会覆盖 events ⇒ 它是**单次运行的顺序账本**，不是跨运行的复现证明；
归阶段靠路径约定，记错 step 会**静默降级**（没有 asset-plan 时 prompt↔result 退化为"按文件名排序对位"，可能错配）；
事件无因果 id，"这一步用了那一步的产物"无法证明；不记模型参数/重试/成本；
`T+MM:SS` 依赖本机时钟。**它保证的是"当次可复核"，不是"重跑可复现"。**

---

## 12. 两个兄弟技能（与主技能的设计哲学完全不同，值得对比着看）

### 12.1 `html-to-pptx`：**量测 HTML 后重建**，不截图了事

- **入口**：`scripts/run.sh`（自举：找 Python ≥3.10 → `venv` → 装 playwright / python-pptx / Pillow / numpy
  → `playwright install chromium` → `doctor.sh` → 写 `.setup-complete`），之后 `exec to_pptx.py "$@"`。
  **无 LLM**（`build_editable_pptx(..., use_llm=False)`）。
- **三种输入自动识别**（`CLASSIFY_JS`）：有 `__layerEditor.fullHTML` → `editor`（等价于编辑器里点"下载 HTML"）；
  有 `.hf-exploded-board` → `exploded`；有 `.hf-stage-wrap`+`.hf-bar` 但 API 没加载 → **直接报错**
  （拒绝把编辑器 UI 悄悄写进 PPTX）；否则 `plain`。
- **元素只分四类**（`classify_elements`，**没有表格、没有原生图表**）：
  `text`（`hasDirectText && !hasTextAncestor` → 可编辑文本框，自身底色另发一个形状垫在后面）、
  `shape`（原生圆角矩形；有 `_is_panel()` 与 `areaFrac < 0.9` 前置；渐变只接受单层线性、
  `|rotation| < 0.5°`、无伪元素，否则降级为 `picture`）、
  `picture`（`_ISOLATE_JS` 先把画布内全部元素 `visibility:hidden !important`，再只显示目标及其后代，**透明底单独截图**）、
  `image`（不重建，留进兜底背景）。
- **"可编辑"的保证方式很聪明**：兜底背景只装"没能重建的墨迹" ——
  `_NEUTRALIZE_JS` 按角色逐一让出墨迹（shape 去底/边框/阴影、text 去色、picture 整棵隐藏），
  剩下的才整页截图当背景，**因此永不丢像素**；`verify_pptx()` 断言 `pictures >= picture_count+1`、
  `text_boxes >= text_count`、`shapes >= shape_count`。
- **字体**用 canvas `measureText` 的字形宽度探测（`PROBE='mmmmmmmmmmlliWWWW@@@@国永'`），
  注释点明原因：**`document.fonts.check()` 永远返回 true**，不可用。
  字号 `Pt(seg_size × 累积缩放 × px_to_pt × fit_scale)`，其中 `fit_scale` 是把**将要写入 pptx 的那个 family**
  以 `!important` 打回元素、强制 reflow 后实测得到的 —— 这比按浏览器当前字体算准。
- **回读校验 `render_check.py`**：源 HTML 截图 ‖ PPTX→（soffice→PDF→PyMuPDF）渲回 ‖ 独立对象框线
  （picture 红 / text 蓝 / shape 绿，跳过整页兜底）‖ 误差热力图，四联成 `<pptx>.compare.png`；
  `DIFF_THRESHOLD=28`（平均通道差）、`DIFF_CELL=24`（池化格），BFS 合并后报**最大 5 个差异区域的坐标与两侧均值 RGB**。
  → **"四联图 + 差异区域坐标"这个范式，是跨"HTML 版式"与"另一种交付格式"做保真校验的通用解法，值得直接搬。**

### 12.2 `paper-fig`：**原生对象 + 事后 gate 审计**（反造假最狠的一套）

- 产物是可编辑 PPTX（默认单页）；**明确禁用 `python-pptx`**，只用 `@oai/artifact-tool` 的 JS API；
  第一次写操作前必须调 `mark_artifact_operation_started.mjs`（参数个数、count、format 都被脚本卡死）。
- 流程：内容规划 → **整页设计预览**（写 `work/preview-prompt.md` 再出图）→ 至多 3 条局部修正建议
  → 忠实重建（独立素材并行每批 ≤4）→ 导出草稿到私有目录 → `finalizePresentation(...)` →
  逐页渲染检查。**每次修订换新文件名，不覆盖**；校验回执写在输出目录之外。
- **"native evidence"= 必需的表格 / 数据图表 / 用户明确要求可编辑的图示，必须建成 slide 原生对象而不是截图。**
  四个 gate 各管一件事（全部**只读不改**、错误信息 content-free、显式声明 claim 边界）：
  1. `native_chart_title_gate.py`：遍历真实放映顺序里的每个 `c:chart`，校验关系必须是 internal 且指向 `c:chartSpace`；
     把标题状态分成 `present / default_placeholder（"Chart Title" 占位）/ linked_title_unresolved（有公式无缓存，
     **不算失败**）/ explicitly_suppressed / empty_title`；检查中被改动就报
     `"Presentation changed during chart-title inspection"`。
  2. `native_quantitative_chart_gate.py`：**"用图片冒充原生图表"的直接克星** ——
     原生 chart 数量不足且存在栅格 `p:pic` → `raster_picture_is_not_native_chart` +
     `required_native_chart_missing`；有例外但没披露 → `approved_source_figure_missing_noneditable_disclosure`
     （要求同页文字同时命中 `/non[ -]?editable|not editable|uneditable/i` **和** `/(source|figure|image)/i`）；
     原生校验链要求类型落在 16 种 `SUPPORTED_CHART_TYPES`、类别/数值点数一致、`ptCount` 与实物点数一致、
     带公式的缓存要解析到**内嵌 workbook 的单元格逐格比对**。
     返回里明确写 `claim_boundary: "OOXML/workbook structural validation only; source provenance and native
     PowerPoint opening remain separate checks."`
  3. `native_table_arithmetic_gate.py`：**"表格数字算错"的克星**。自动发现只产出 skip 理由
     （合并单元格 / 行数 <3 / 无数字 / 末行不是唯一 total / 语义歧义如 percent·ratio·net·margin / 非可加列头如 unit price），
     **只有显式 `--contract-json` 契约失败才算 findings**；容差是
     `Σ(10^-显示小数位 / 2)`（每个显示值半个末位单位累加），并把比较方式写成
     `"displayed_values_with_rounding_tolerance"`；claim 边界：
     `"Displayed-value arithmetic with rounding tolerance; not source-data verification."`
  4. `template_source_fidelity_gate.py`：拿 source 与 generated 逐页比
     "family =（layout 类型，placeholder (kind,index) 集合，master placeholder 集合）"与几何；
     ratio 与 reference slides **必须成对显式给出**（只给一个就报
     `minimum_ratio_requires_explicit_reference_slides`）；没启用任何要求时 `status="not_applicable"`。
  5. `validate_template_plan.mjs`：模板跟随计划的形状校验 —— outputSlide 必须严格 1..N；
     `action` 白名单 `{rewrite, rewrite-and-reposition, replace, delete, keep, fill-placeholder}`，
     **`add` 默认拒绝**（除非显式允许 + 不许重叠 + 有 reason + 给了几何）；内容角色页 `editTargets: []` 会被抓；
     占位符必须被处理（`keep`/`add` 不算）。
  6. `check_template_fidelity.mjs`：**直接扫工作区里的脚本与日志找造假** ——
     `.py` 里出现 `from pptx import` / `Presentation(...).save(*.pptx)` → `deck-affecting-python`；
     `zipfile` + 写 `ppt/slides/` → `direct-ooxml-mutation`；`soffice --convert-to pptx` → `libreoffice-pptx-mutation`；
     重开新 deck → `fresh-slide-rebuild`；并且必须找到 `PresentationFile.importPptx(` + `template-starter.pptx`
     （`missing-starter-import-evidence`）与 `exportPptx(`（`missing-artifact-export-evidence`）。
     几何级：新加的"够大且不透明"的面板若与 starter 元素 `IoU ≤ 0.92` 且覆盖某个继承内容 > 35% 面积，
     或中心落进继承框内 → `mask-cover-overlay`（"盖住"式造假）。
- **共同姿态**：所有 gate 只输出**结构结论**，并把"没验证的"写成显式 `false`
  （`native_powerpoint_verified: false` / `native_application_open_verified: false` / `source_attachments_accessed: false`）。
  → **"不声称自己验证不了的东西"这件事，被写进了返回值结构里**，这是全仓最值得学的工程表达之一。

### 12.3 仓库基础设施（一句话级）

- **发布两段式**：CI（`build-site.yml`）只做 `site/` 的 lint / `next build --webpack` / `tsc --noEmit` /
  `assemble-pages.mjs` / 上传 artifact；**真正推 `gh-pages` 由本地 `publish-pages.mjs` 手工执行**
  （先断言 remote 是 SSH 地址、`HEAD === origin/main`，再用临时 `GIT_DIR` + `read-tree --empty` + `commit-tree`
  造一棵树 push，不动工作区索引）。`assemble-pages.mjs` 会写空 `.nojekyll`（否则 Pages 的 Jekyll 会吞掉 `_next/`）。
- **`pack.sh` 是白名单打包**：只装 `LICENSE` / `THIRD_PARTY_NOTICES.md` / `.gitignore` / `pack.sh` /
  `TOOLKIT.md`→`README.md` / 三个 `skills/*`，排除 node_modules、`__pycache__`、`.venv`、`._*`、`.DS_Store`；
  `site/`、`gallery/`、`tools/`、`docs/`、媒体**从不入包**。
- **gallery 命名约定**：`final.png`（成品全分辨率，README 里点缩略图打开）、`preview.webp`（README 内嵌缩略图，
  paper-figures 的说明称其为"无损全分辨率重编码"）、`prompt.md`（`# <Case> — Original Prompt` + ```text 代码块，
  即**原始输入原文**）、`agent-replay-poster.webp`（Replay 视频封面帧）。
  **实测差异**：目录里实际 20 个案例、17 个 `prompt.md`，而 README 写 "Thirteen visual-design examples"；
  `gallery/placeholders/*.svg`（"VIDEO COMING SOON" 占位图）在仓库内**零引用**。
  → 又一次印证 §13.11：**这个仓库的文档与素材之间没有自动一致性检查。**

---

## 13. 批判性发现（我自己核出来的边界与薄弱点）

1. **没有任何样例产物**：仓库里没有一份真实生成的 `index.html` / `editor.html` / `layers.html` / `replay/index.html`。
   想验证 1900 行编辑器、`verify.mjs` 的 73 条断言、Replay 模板，**必须自己先跑一次完整流程**（还要装 puppeteer-core + font kit + Chrome）。
2. **回归 fixture 是孤儿**：`tests/fixtures/small-explode/index.html`（专门测"一级组件 < 5 时的文字补充"）**全仓零引用**，
   没有任何测试脚本或 CI 加载它 —— 也就是说**它守的那条规则实际上无人自动回归**。
3. **CI 不跑校验工具**：`.github/workflows/build-site.yml` 只对 `site/**` 做 lint / build / typecheck + 组装页面，
   **从不运行** `check-poster.sh` / `check-contract.mjs` / `verify.mjs` / `verify-replay.mjs`。
   所有"确定性验收"都是**宿主上的 agent 自律执行**的，缺一道强制。这是本项目最值得引以为戒的一点：
   **工具很硬，但没有强制点。**
4. **`verify-replay.mjs` 的断言是"模板源码字符串"**：约 30 条断言里有 `INTRO_DURATION = 4700`、`width: 2540px`、
   `min-height: 210px`、`object-fit: contain` 这类原文匹配，还有"旧曲线路径串不许出现"的反断言。
   好处是能防回归；代价是**每一处模板改动都要同步改断言**（30 个耦合点），且它**不开浏览器、不加载图片**——
   "图到底能不能显示"没被验证。
5. **两处已被我发现的确切缺陷**：`verify.mjs` 里编辑器页的 `errors` 只打印、**不入断言**（其它三个页面入了）；
   同一文件用宽正则 `!/hf-|layer-editor/` 判"导出物无编辑器残留"，**正文里出现 `hf-` 就会假红**。
6. **平台假设是 macOS/Linux + bash**：`ps -axo`、`od`、`sed -i.bak`、`cp -RX`、`which`、`awk`；
   Chrome 发现路径硬编码了 macOS 与 `/usr/bin/*`，**Windows 只能靠环境变量**。
   （代码里 `uname -s` / `darwin` 分支说明作者清楚这一点，但没有做 Windows 支持。）
7. **编辑器的能力边界是刻意画死的**：不能新增图层、不能导入图片、不能重排 z、不能旋转、不能改色、
   没有 redo、没有网格步进、没有 DPR 感知。文档写得很清楚：**"It is for human micro-adjustments after design,
   not for redesigning the poster."** 这不是缺陷，是产品判断 —— 但它也意味着"用户想大改"时必须回到 agent。
8. **编辑器运行时是"逐字手写"的 1900 行**：SKILL.md 明令 **"Keep the prebuilt editor runtime unchanged"**、
   **"do not patch the editor runtime around a poster-specific violation"**。好处是确定性与可验收性，
   代价是任何新需求都改这一份文件（以及 38 条陷阱表的维护成本）。
9. **参考图三条铁律的成本**：默认 `auto → art-directed` 意味着**每张新海报都多一次图像生成**（只为构图参考、不进成品），
   换来的是构图质量；在批量场景下这笔账要重新算。
10. **大量"实测结论"是自建简化模拟**：blog 与文档里的 +209 / 63% vs 37% / 10/10 vs 0/13 都带免责声明
    （"非官方评测、VLM 偏好不代表真实用户投票"）。引用这些数字时**必须带上它的限定条件**。
11. **文档与素材没有一致性检查**：README 写 "Thirteen visual-design examples"，gallery 里实际有 20 个案例目录、
    17 个 `prompt.md`；`gallery/placeholders/*.svg` 与 `tests/fixtures/` 都是零引用的孤儿。

---

## 14. 与 Vinart 的对照，以及我建议迁移的东西

### 14.1 四条结构性差异（先看清，再决定抄什么）

| 维度 | Editable-Design | Vinart（本工作区） |
|---|---|---|
| **真源方向** | **HTML 是唯一真源**；编辑器改 DOM；靠 `bake` 把文档流固化成绝对定位 | **`doc.json` 是唯一真源**；`emit.ts` 是纯函数投影；编辑器改数据 |
| **白拿的东西** | 浏览器排版（作者可随便写 flex/grid/文档流、伪元素、文字回流） | 绝对定位（`rect` 天生如此）、可校验的数据模型、确定性渲染（零模型调用） |
| **付出的代价** | `bake` + 38 条陷阱（T1–T38）+ 只能"微调"不能重排 + 溢出无自动机制 | 浏览器免费给的一切都得自己实现（文字换行/装填 `fit.ts`/伪元素…），且 **`fit.ts` 目前零调用** |
| **交付物** | 5 件：PNG / `index.html` / **`editor.html`（离线单文件）** / **`layers.html`** / **`replay/index.html`** | PNG + `doc.json` + **应用内**编辑器（要跑服务）；无分层拆解稿、无证据回放 |

→ **一句话**：Editable-Design 用"一整套陷阱表 + 固化"换来**一个能交给客户的离线编辑器**；
Vinart 用"数据模型"换来**确定性与可校验性**，但还没把这两样变成可交付物。

### 14.2 建议迁移（按"投入小 / 收益大"排序）

**A. 立即可做（各 < 半天，纯断言/纯提示词）**

1. **出图回读尺寸断言**。`render-poster.sh` 的原话：*"信产物，别信渲染器的退出码"* ——
   画布与窗口不一致时浏览器会静默给出另一个尺寸，图看起来完全正常。
   **实测 Vinart 现状**：`src/render/rasterize/blink-renderer.ts:351-363` 里 `outW/outH` 是
   `Math.round(box.width * dsf)` / `Math.round(width * dsf)` **算出来的**，**不是从 PNG 读回来的**；
   `src/server/index.ts:188-194` 拿到 `out` 后只用了 `out.imagePath`，尺寸根本没进判断。
   也就是说"产物尺寸对不对"这件事目前**没有任何人检查**。落点：出图后从产物读真实像素尺寸
   （PNG 直接读 IHDR 字节 16..23，零依赖）与 `doc.canvas × dsf` 比对，不符即失败。
   顺带一条同源风险：`locator.screenshot()` 会先把元素滚进可视区，Editable-Design 就是为这个
   在竖版长图上踩过坑，改用 `page.screenshot({ clip })` —— Vinart 的元素分支值得实测一次。
2. **把 `fit.ts` 接上**（CLAUDE.md 已记为已知缺口）。这是**反向对照**：Editable-Design 对文字溢出
   **完全没有自动机制**，只能靠"逐行念渲染图"；Vinart 已经写好了实测装填（29 条探针），接上它正好补上对方的短板。
3. **移植三条"行为判定"**（都比正则强）：
   - **改视口不漂移**：量 → `setViewport(1000×1500)` → 双 rAF → 再量，容差 0.5px（抓 `%` / `vh` / `calc` 漏网）；
   - **文字命中测试**：对每个文字叶取中心点 `elementFromPoint().closest(所属节点)`，不等即失败
     —— 与 Vinart 的 `editor/hit-test.ts` 天然契合，可做成交付级断言；
   - **像素双门**：`changedRatio ≤ 0.5%` **且** `meanAbs ≤ 0.05`（每通道容差 2）。
     Vinart 已有 `scripts/compare-images.ts`，把它升级成带**双阈值 + 字节快路径**的门即可用于
     "emit 重构前后 / 编辑器改动前后零漂移"回归。
4. **字体注册闸门**：把 Editable-Design 的 canvas 度量签名探针（双字号 × 五度量 × 三个基线 family，
   分别测拉丁与 CJK 样本）搬进 Vinart 的出图前检查，输出 `ok cjk+latin` / `ok latin only` / `MISSING`，
   并把"**标 latin only 的 family 不得排中文**"变成硬规则。
   （对应 Vinart 的 `scripts/_probe-fonts.ts` / `_fetch-fonts.py`，现在比较分散。）

**B. 高性价比（一次改动，长期受益）**

5. **把 `imagery.md` 的三条量化结论搬进 `workflow/assetsgen/` 与 `amazon-listing` 手册，并做一次自家 A/B**：
   ① 预留文字区**只能描述外观**（提"给标题留位"会画出东西；项目实测 10/10 出伪影 vs 0/13）；
   ② **负向指令无效**（"no text" 实测零效果，因为多模态后端没有负嵌入通道）；
   ③ **你写的比例是意图不是契约**（要 16% 得 22%、要 34% 得 11% ⇒ 要么实测素材边界，要么留超大余量）。
   这三条**全部是纯提示词改动**，在 Vinart 的图像后端上可以用 10 张对照图直接证伪或证实 —— 收益/成本比最高。
6. **证据链落地**：Vinart 已有 `designharness/session/transcript.ts`（会话事件流）。
   只需在关键步骤追加一份 `<工作目录>/designs/<版式>/trace.jsonl`（append-only，`{seq,ts,type,...}`），
   并把 `doc.json` / 素材订单 / 首图 / 评审结论按阶段挂上去，就能生成"这张图怎么来的"证据页。
   Editable-Design 的三道硬闸值得照抄：**artifact 先 `test -e` 再复制字节并记 bytes**、
   **run 真执行并记真 exit_code/耗时**、**decision 的 why 必填**（"没有理由的决策不值得记录"）。
   ⚠️ 别抄它没做到的部分：**无哈希** ⇒ 记 `sha256`，且**每次运行不要覆盖** events（它 `init` 会截断）。
7. **把 `editor.html` 纳入交付形态**：Vinart 的编辑器是应用内功能（要跑服务、走 `/api`）。
   Editable-Design 的编辑器是**离线单文件**（原稿 HTML + 就地 DOM 编辑 + 下载 `*.edited.html`）。
   如果 Amazon 场景需要"把稿子交给客户让他自己挪两行字"，这是**最直接的差异化**。
   代价：Vinart 的编辑器现在建在 `doc.json` 上，要离线化就得把 doc 内联进 HTML 并在浏览器里重跑一次 emit
   （emit 是纯函数，这件事在 Vinart 架构里反而**比在 Editable-Design 里更容易**）。

**C. 编辑器陷阱表：逐条对照自查（Vinart 的编辑器与它同构）**

Vinart 的编辑器同样是"父文档里的覆盖层 + Pointer 事件 + contentEditable + 缩放坐标换算 + 8 向手柄"，
所以下列条目**几乎逐条适用**，建议作为 checklist 打勾：

- **T12** `pointerdown` 里 `preventDefault()` 会**连带抑制 `click`/`dblclick`** ⇒ 双击进不去文字编辑；
- **T13** `setPointerCapture` 会把后续 `click`/`dblclick` 的 `target` **重定向到捕获元素** ⇒
  双击不要信 `e.target`，改用 `document.elementFromPoint()` 重命中；
- **T14** 画布整体 `scale` 后位移必须 `/scale`（Vinart 已修过同类问题，见 `docs/EDITOR-EVOLUTION.md` §1.5）；
- **T16** 中文输入法：`isComposing || keyCode === 229` 必须在按键处理第一行 return；
- **T19** "用户手动设过的宽度"要用一个显式标记位保住，且**只扩不缩**；
- **T23** 导出时 `data-*` 运行时标记会随 `cloneNode` 进产物 ⇒ 导出要显式剥；
- **T37** 手柄**不能画在已 `scale()` 的画布内**（命中区会随之缩小）⇒ 覆盖层活在未缩放坐标系；
- **T38** 手势必须有**五重出口**（window capture 的 up/cancel + `lostpointercapture` + blur + visibilitychange + Esc 恢复）；
- **T31** 只比 `getBoundingClientRect()` 会漏掉"坐标没动、底色/伪元素/层级已丢" ⇒ 验收要**几何 + 像素双轨**；
- `letter-spacing` 的单行块必须 `white-space: nowrap`；`* { box-sizing: border-box }` 永远要有。

**D. 不建议照搬**

- **工具链的 bash/ps/od/sed 依赖**（Windows 上只有 WSL/Git-Bash；Chrome 发现全靠环境变量）；
- **把 HTML 当真源**（Vinart 的 `doc.json` 在可控性、可校验性、零模型调用上更强，别为了抄"bake"而退回 DOM 真源）；
- **`verify-replay.mjs` 式的源码字符串断言**（30 个耦合点、不开浏览器）——Vinart 已经有真浏览器渲染路径，
  应该做**真加载断言**而不是字符串匹配；
- **"无强制点"的验收自律**：Editable-Design 的 CI 不跑任何校验脚本，fixture 也没人跑。
  Vinart 若照抄这套工具，务必把 `tsc --noEmit` 之外的那几道门（尺寸回读、零漂移、字体、命中测试）
  **挂到一个 `npm run verify` 上**，否则同样会退化成"文档里的命令"。

---

