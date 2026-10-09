/**
 * Skill 类型 —— 对齐 claude-code / harness 的 Agent Skills 概念：
 * skill = 「指令文档 + 附属资产 + 工具面声明」的可插拔领域包。
 *
 * 与 chat 工具（AgentTool）的分工：
 * - 工具 = 能力（手）：模型调用的函数，宿主执行，返回产物
 * - skill = 知识（脑）：模型加载的领域指令，读后自己组织既有工具完成任务
 * skill 不注册新的模型工具 schema——它授权/编排工具表里已有的工具。
 */

/** 目录摘要（模型路由用：判断任务是否匹配某 skill） */
export interface SkillSummary {
  /** kebab-case 标识（加载与 /name 手势的地址） */
  name: string;
  /** 一句话路由描述（进 <available_skills> 目录） */
  description: string;
  /** 何时使用的补充路由提示（可选） */
  whenToUse?: string;
  /** 来源：bundled = 代码内置；project = <workDir>/skills/ 下用户/项目自建 */
  source: 'bundled' | 'project';
  /** project 来源的 SKILL.md 绝对路径 */
  path?: string;
}

/** 完整定义 = 摘要 + 正文指令（skill 工具加载的内容） */
export interface SkillDefinition extends SkillSummary {
  content: string;
}

/** SKILL.md frontmatter（行式解析：name/description/whenToUse 必填或部分可选） */
export interface SkillFrontmatter {
  name?: string;
  description?: string;
  whenToUse?: string;
  /** false = 不进模型目录，仅用户 /name 手势（V1 预留字段，解析但暂无手势通道） */
  'disable-model-invocation'?: boolean;
  'user-invocable'?: boolean;
}
