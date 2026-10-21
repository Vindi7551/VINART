# 技能层设计（SKILLS.md）

> **状态：已实施。** 本文档描述**当前**实现（三层来源 + 优先级决策）。
> **真源**：`src/designharness/skills/registry.ts`（来源合并 + 目录渲染）
> + `skills/types.ts`（类型）+ `skills/skill-tool.ts`（模型加载工具）。
> **消费方**：`src/server/index.ts` 的 `buildSystemNote()` 注入目录；`session/chat-store.ts` 挂 `skill` 工具。

## 0. 语义：skill = 「指令文档 + 附属资产 + 工具面声明」的可插拔领域包

与 chat 工具（`AgentTool`）的分工：

- **工具 = 能力（手）**：模型调用的函数，宿主执行，返回产物。
- **skill = 知识（脑）**：模型加载的领域指令，读后自己组织**既有工具**完成任务。

skill **不注册**新的模型工具 schema——它授权/编排工具表里已有的工具。这决定了它的存在形态：
**一份 markdown 指令**，而不是一段代码逻辑。

## 1. 三层来源

skill 从三个地方来，合并后暴露给模型：

| 来源 | 位置 | 全局可用 | 载体 | 谁维护 |
|---|---|---|---|---|
| `bundled` | `<repo>/src/designharness/skills/bundled/<name>/SKILL.md` | ✅ | 文件（随代码发布） | 产品开发者 |
| `project` | `<workDir>/skills/<name>/SKILL.md` | ❌ 按工作目录隔离 | 文件 | 用户（某项目） |
| `user` | `~/.vinart/skills/<name>/SKILL.md` | ✅ | 文件 | 用户（全局） |

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
  此代价实际很小——内置只放少量说明书、名字独特（如 `vinart-render-guide`），几乎不撞名。
- **`project > user` = 就近优先。** 越靠近当前任务（具体项目）越优先，符合「我专门为这个项目
  写的就该生效」；`user` 是全局兜底，同名时让位给更具体的 `project`。

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
description: 亚马逊 listing 套图全流程：产品照+五点描述 → 结构化分析 → … → spawn 出草案
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

## 7. 已知缺口

- 无 `/name` 手动触发（`user-invocable` 等字段已声明未启用）。
- 无 skills 的 HTTP 接口——前端看不到、也管不了 skill 列表（`server/index.ts` 只有注入用的 `renderSkillCatalog`）。
