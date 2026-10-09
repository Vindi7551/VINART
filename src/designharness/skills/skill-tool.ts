/**
 * skill 工具 —— 模型按 name 加载 skill 的完整指令。
 *
 * 对齐 claude-code / harness 的单工具加载模式：目录（systemNote 的
 * <available_skills>）只给摘要，正文按需加载——skill 不占常驻上下文。
 * 模型读完指令后自己组织工具表里的既有工具（spawn/render_design/…）行动。
 */
import { getSkill, listSkills } from '../skills/registry';
import type { AgentTool } from '../subagent/types';
import { getWorkDir } from '../session/transcript';

export function createSkillTool(config: { sessionId: string }): AgentTool {
  return {
    name: 'skill',
    description:
      '加载一个可用 skill 的完整指令。当用户任务与 <available_skills> 目录里某个 skill 的描述匹配时，' +
      '**先调用本工具加载全文，再按指令行动**——目录里只有摘要，不要凭摘要猜指令内容。',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'skill 的准确名字（来自 <available_skills> 目录）',
        },
      },
      required: ['name'],
    },
    async execute(args) {
      const name = args.name;
      if (typeof name !== 'string' || !name.trim()) {
        return { content: 'ERROR: 缺少 name（skill 名，来自 <available_skills> 目录）。', isError: true };
      }
      const workDir = await getWorkDir(config.sessionId);
      const skill = getSkill(workDir, name);
      if (!skill) {
        const available = listSkills(workDir).map((s) => s.name).join('、') || '（当前没有任何可用 skill）';
        return {
          content: `ERROR: skill "${name}" 不存在。可用：${available}`,
          isError: true,
        };
      }
      return {
        content: JSON.stringify({
          name: skill.name,
          source: skill.source,
          instructions: skill.content,
        }),
      };
    },
  };
}
