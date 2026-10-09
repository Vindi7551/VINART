import { registerBundledSkill } from '../registry';

/**
 * 内置 skill：亚马逊 Listing 套图流程手册。
 *
 * 内容源自 workflow/briefgen 四步流水线（perceive/claims/plan/draft）的
 * prompt 精华——聊天链的主 AI 加载本手册后，自己在对话内完成链 A 四步
 * （产物留对话内），执行环节交给既有工具（spawn/render_design/generate_assets）。
 * 产物落盘复用：把方案写成 md 落到工作目录（在对话里让主 AI 写即可）。
 * ⚠️ 项目已**没有 CLI**（唯一的 compile.ts 于 2026-10-09 删除）。
 */

const CONTENT = `## 亚马逊 Listing 套图流程

**适用**：用户要为亚马逊产品设计一套 listing 图片（主图 + 副图），并提供了产品照和/或五点描述。
**分工**：你负责内容创作四步（分析→审计→规划→写方案），执行交给工具
（spawn_design_agents 出草案 → compile_appearance 配色 → generate_assets 素材 → render_design 成品）。
分析产物留在对话内即可；需要方案落盘复用（后续据此重建版式）时，把它写成 md
存到工作目录即可（主 AI 写文件即可，不再需要命令行）。

### 第 1 步 · 产品结构化分析（用户贴产品照后）

看图产出「可见事实清单」，作为后续所有步骤的证据基座：
- 只写**画面可见**的事实（材质/颜色/尺寸比例/雕刻或印字内容/组件构成/使用场景/工艺细节…），**不推测、不脑补**
- 每条事实附带它出现在画面哪里（位置/特写角度），后续审计要引用它们
- 图上看不出来的信息（成分含量、尺寸数字）标注为「无数据」——不要编造

### 第 2 步 · 卖点要素级审计（用户给五点描述后）

对每条宣称：拆出**可验证要素**，逐要素标证据状态（三分法）：
- **已有证据**：引用第 1 步事实清单里的具体内容
- **可补证**：现有图没有、但套图可以补上的（说明哪类图能补）
- **无法证明**：数据缺口——**禁止编造数字**，列入待用户拍板的问题

副图需求清单从**要素**生成，不从宣称生成（一条宣称可能拆出多个要素）。

### 第 3 步 · 套图槽位规划

slot 语义：**MAIN** = 主图纯白底（无任何文字/图形叠加）；**PT01…PTn** = 副图。
每槽产出：buying_question（这张图回答买家哪句心里话，一句）、image_kind（主图白底/信息图/场景图/混合）、
layout_recipe（副图必填：detail-callouts / scene-compare / audience-badges / banner-note / plain-feature）、
must_show_facts（必须展示的事实，照抄审计要素）、title（listing 语言 2–6 词情绪钩子，主图 null）、
on_image_text（标签 2–4 词名词短语，0–4 条，主图空）、note（≤12 词服务信息，无则 null）、
scene_tag（环境标签，非场景图 null）、covers_elements（覆盖哪些审计要素）、evidence_note（补哪个缺口）、risk。

**覆盖纪律**：每个「可补证」要素至少被一张图覆盖；覆盖不了的进 open_questions（含数据缺口），不要硬塞。

### 第 4 步 · 逐槽写 brief（spawn_design_agents 的 jobs 参数）

每槽一份**自包含** brief——子 agent 看不到你们的对话，画面意图与逐字文案必须写全：
- 这张图的任务（回答什么购买问题）+ 必须展示的事实
- **三层图上文字逐字保留，一层不能丢**：标题（情绪钩子）/ 标签（名词短语列表）/ 注记
- 布局要求写清占比与位置关系（如「左 60% 产品特写，右 40% 要素标注」）
- 风格基调：短段落 + 列表，**不要 JSON**（对齐手写范本风格）
- **版式名硬规定：\`<项目名>-<slot>\`**（如 test_swimming_suit-PT03）——裸名（PT03）会与
  其他项目的版式混淆，不要裸名

### 派发纪律（spawn_design_agents）

- **一次调用 ≤3 个 job**——brief 都要完整写进参数，批次太大参数会被输出上限截断
  （实测 JSON 截断报 Unterminated string）。7 张图拆 3 次调用（3+3+1）
- 素材 asset 路径**统一写工作目录相对路径**（如 \`uploads/chat-x.jpg\` 或
  \`<项目名>/uploads/chat-x.jpg\`）——渲染器会按序在工作目录回退查找，两种都能渲；
  统一写法是为了子 agent 之间不漂移
- 引用用户贴的产品照时，asset 直接写它的 uploads 相对路径——贴图可以直接当素材，不必先生成
- **用户表示「你自己完成/全程不用问我」后**：generate_assets 直接带 confirm:true 执行，
  不再逐批确认；编译配色、渲染成品一路做完再汇报。除此之外素材必须两段式确认

### 第 5 步 · 执行编排

brief 写好 → spawn_design_agents（每个槽位一个 job）→ 草图给用户确认 →
compile_appearance（配色）→ generate_assets（生素材，两段式确认）→ render_design（成品）。
方案需要落盘复用时，如实告知当前对话内产物不落盘——要落盘复用让用户走 CLI。

### 何时跳过本流程

改图/看图/问答——不走本流程，直接用对应工具。`;

registerBundledSkill({
  name: 'amazon-listing',
  description:
    '亚马逊 listing 套图全流程：产品照+五点描述 → 结构化分析 → 要素级审计 → 套图槽位规划 → 逐槽 brief → spawn 出草案',
  whenToUse: '用户要为亚马逊产品设计 listing 套图、提到五点描述/主图/副图/套图时',
  content: CONTENT,
});
