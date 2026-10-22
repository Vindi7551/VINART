# 技能层设计（SKILLS.md）

> **状态：已实施。** 本文档描述**当前**实现（三层来源 + 优先级决策）。
> **真源**：`src/designharness/skills/registry.ts`（来源合并 + 目录渲染）
> + `skills/types.ts`（类型）+ `skills/skill-tool.ts`（模型加载工具）。
> **消费方**：`src/server/index.ts` 的 `buildSystemNote()` 注入目录；`session/chat-store.ts` 挂 `skill` 工具。

## 0. 语义：skill = 领域知识包；工具面归宿主

**两类 skill，边界不同：**

- **capability skill（bundled）**：产品能力手册，可以写工具名、字段名、占位符、模型限制、文件约定；随代码发布，版本与工具一起走。
- **domain skill（project / user）**：领域知识，**必须工具无关**——只写设计判断与流程阶段，不写工具名、宿主字段名、资源名。判断标准：换一个宿主，这句话还成立吗？

与 chat 工具（`AgentTool`）的分工：

- **工具 = 能力（手）**：模型调用的函数，宿主执行，返回产物。
- **skill = 知识（脑）**：模型加载的领域指令；**工具选择由宿主/模型按 tool description 完成**，domain skill 不替宿主做路由。

skill **不注册**新的模型工具 schema——它不改变工具表。capability skill 可以说明工具怎么用；domain skill 只说明这个领域怎么做。

## 1. 三层来源

skill 从三个地方来，合并后暴露给模型：

| 来源 | 位置 | 全局可用 | 载体 | 谁维护 | 允许知道工具吗 |
|---|---|---|---|---|---|
| `bundled` | `<repo>/src/designharness/skills/bundled/<name>/SKILL.md` | ✅ | 文件（随代码发布） | 产品开发者 | ✅ 可以（能力手册） |
| `project` | `<workDir>/skills/<name>/SKILL.md` | ❌ 按工作目录隔离 | 文件 | 用户（某项目） | ❌ 不可以（领域知识） |
| `user` | `~/.vinart/skills/<name>/SKILL.md` | ✅ | 文件 | 用户（全局） | ❌ 不可以（领域知识） |

```
src/designharness/skills/bundled/<name>/SKILL.md   产品级——随代码发布（用户改不到）
<工作目录>/skills/<name>/SKILL.md                   项目级——只在该目录的会话里可见
~/.vinart/skills/<name>/SKILL.md                    用户全局——跨所有工作目录可用
```

> `~/.vinart/` 是既有的用户级目录（会话中央注册表 `~/.vinart/workdirs.json` 也在此），
> 技能全局层与它一致。

## 2. 优先级：**`bundled > project > user`**（决策 2026-10-11）

**「优先级」= 同名时谁的文件最终生效。** 只有**同名**才冲突；不同名时三层全部生效、互不干扰。

```
bundled  ── 最高，只读锁定层
project  ── 中间，就近优先
user     ── 最低，全局兜底
```

**为什么这样定：**

- **`bundled` 最高 = 只读锁定层。** `bundled` 装的是**产品能力说明书**（如渲染工具怎么用），
  这类内容是「**产品事实**」，用户拿一份写错的版本覆盖它只会误导模型 → 锁定不可覆盖。
  代价：内置技能永远改不了（想定制只能换名，代价是目录里并存两个）。
  此代价实际很小——内置只放少量说明书、名字独特（如 `layout-planning`），几乎不撞名。
- **`project > user` = 就近优先。** 越靠近当前任务（具体项目）越优先，符合「我专门为这个项目
  写的就该生效」；`user` 是全局兜底，同名时让位给更具体的 `project`。

> **耦合边界（2026-10-22）：** `bundled` 是产品能力手册，可以知道工具；`project` / `user`
> 是领域知识，**不得出现工具名、宿主字段名、资源名**。否则 skill 会绑死在某个宿主的工具表上，
> 工具一改就漂移——这类内容应放 `bundled` 或 tool description，不能放用户/项目 skill。

## 3. 加载链路（目录 + 按需，正文不常驻上下文）

```
listSkills(workDir)                 ← 三层合并（同名取高优先级）
   └─ renderSkillCatalog(workDir)   ← 渲染 <available_skills> 目录（只含 name + description）
        └─ server buildSystemNote() ← 注入 systemNote（目录稳定 → prompt cache 前缀命中）
             └─ 模型命中 → 调 skill 工具 getSkill(workDir, name) → 拉全文 instructions
```

**目录里只有摘要**，正文按需加载——这是 skill 不占常驻上下文的关键。目录块放 systemNote
**前段**（稳定段），易变的版式摘要放后段，保证前缀 cache 命中。

## 4. SKILL.md 规范

- 位置：`<root>/<name>/SKILL.md`（`<root>` 为 `skills/` 或 `~/.vinart/skills/`）。
- `name` 匹配 `^[a-z0-9]+(?:-[a-z0-9]+)*$`（kebab-case）。
- **必须有 frontmatter**（`---` 包裹）且含 `description`，否则 `console.warn` 跳过。
- frontmatter 为**行式解析**：仅支持 `key: value` 标量（`true`/`false` 转 bool），
  **不支持多行 / 嵌套**。
- 字段：`name` / `description` / `whenToUse`；
  `disable-model-invocation` / `user-invocable` 已解析但 **V1 无手势通道**（无 `/name` 手动触发）。

示例：

```markdown
---
name: amazon-listing
description: 亚马逊 listing 套图全流程：产品照+五点描述 → 结构化分析 → … → 输出内容方案
whenToUse: 用户要为亚马逊产品设计 listing 套图、提到五点描述/主图/副图/套图时
---

（正文指令……）
```

## 5. 目录内的其他文件（按路径读取 · 不预设结构）

一个 skill **是一个目录**（`<root>/<name>/`）。**目录结构完全自由**——嵌套几层、
叫什么名字都行；`SKILL.md` 只是那张「说明书」：

```
~/.vinart/skills/amazon-listing/
├── SKILL.md                                 说明书（「加载 skill」时返回的就是它）
├── contracts/production-contract.md         由 SKILL.md 用相对路径指向
└── refs/wood-care/care-notes.md             可嵌套任意层
```

- **不预设分类**：没有「入口 / 附件 / 案例」这种固定结构，也**不自动枚举**目录里的文件。
- **由 SKILL.md 说明路径**：正文里直接写清楚有哪些文件、路径是什么
  （如「参考 `contracts/production-contract.md`」）。
- **按路径取用**：`skill({name, file: 'contracts/production-contract.md'})` 只返回那一个
  文件的内容——多文档因此**不会一次性铺进上下文**。

**约束与安全：**

- 三层都支持（都有目录）；`bundled` 的目录随代码发布，打包后只读。
- `file` 路径**必须落在该 skill 目录内**——`../` 穿越会被拒（`readSkillFile` 做 resolve 前缀校验）。
- 单文件读取上限 **64 KiB**，超出返回错误（避免撑爆上下文）。

## 6. 如何新增一个 skill

- **用户全局（推荐给领域知识）**：`~/.vinart/skills/<name>/SKILL.md` —— 零改码、跨所有项目生效。
- **项目级**：`<workDir>/skills/<name>/SKILL.md` —— 零改码、只对该项目生效（同名可覆盖 `user`）。
- **内置（产品说明书）**：`<repo>/src/designharness/skills/bundled/<name>/SKILL.md` ——
  随代码发布，**同名时压过 project/user**（产品事实不该被覆盖）。

> 领域知识（Amazon listing / eBay / Etsy 方法论）应走**用户全局层**，不进 `bundled`——
> `bundled` 的正当用途是「产品自身能力说明书」，把业务领域知识塞进去是层次混淆。

**纯净规则（project / user）：**

- 不写工具名（如 `sketch_plan` / `patch_doc` / `generate_assets` / `get_design`）；
- 不写固定结构名 / 模板名（如 `type-led` / `full-bleed` / `split` / `grid`）——结构由内容推导，不枚举；
- 不写宿主字段名（如字号比例、画布底色、裁切方式等 schema 字段）；
- 不写宿主资源名（字体 family、占位符、素材文件约定、模型名、像素下限）；
- 用阶段语言：「落版 / 调外观 / 素材阶段」；具体用哪个工具由宿主决定。
- **探针**：`scripts/_probe-skill-purity.mjs` 会扫描 `skills/**/*.md` 的 denylist，命中即失败；
  `_probe-skill-links.mjs` 校验所有相对引用文件存在。

**不要手维护两份副本：** 同一个 skill 若同时在 `<workDir>/skills/` 与 `~/.vinart/skills/`
存在，`project` 会遮蔽 `user`——改一份，另一份不会变。以仓库的 `skills/` 为源，
用安装/同步流程复制到用户层；不要在两边分别手改。

## 7. 已知缺口

- 无 `/name` 手动触发（`user-invocable` 等字段已声明未启用）。
- 无 skills 的 HTTP 接口——前端看不到、也管不了 skill 列表（`server/index.ts` 只有注入用的 `renderSkillCatalog`）。
