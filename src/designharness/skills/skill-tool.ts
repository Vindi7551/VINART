/**
 * skill 工具 —— 模型按 name 加载 skill 的完整指令。
 *
 * 对齐 claude-code / harness 的单工具加载模式：目录（systemNote 的
 * <available_skills>）只给摘要，正文按需加载——skill 不占常驻上下文。
 * 模型读完指令后自己组织工具表里的既有工具行动；工具选择由宿主决定，
 * project/user 的 skill 正文不点名工具。
 *
 * 目录内的其他文件（file 参数）：**不预设结构、不自动枚举**。SKILL.md 正文自己
 * 说明目录里有哪些文件、路径是什么（如「参考 `contracts/production-contract.md`」），
 * 模型按该路径用 file 参数取用——目录可以嵌套任意层。（三层都有目录；bundled 随代码发布。）
 */
import { getSkill, listSkills, readSkillFile } from '../skills/registry';
import type { AgentTool } from '../subagent/types';
import { getWorkDir } from '../session/transcript';

export function createSkillTool(config: { sessionId: string }): AgentTool {
  return {
    name: 'skill',
    description:
      '加载一个可用 skill 的完整指令。当用户任务与 <available_skills> 目录里某个 skill 的描述匹配时，' +
      '**先调用本工具加载全文，再按指令行动**——目录里只有摘要，不要凭摘要猜指令内容。' +
      '若指令里提到 skill 目录内的其他文件（并给出相对路径），需要时用 file 参数按该路径读取，' +
      '不要臆造路径、也不要一次全读——只取当前任务要用的那份。',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'skill 的准确名字（来自 <available_skills> 目录）',
        },
        file: {
          type: 'string',
          description:
            '可选：读取该 skill 目录内某个文件的相对路径（路径取自指令正文里写明的，如 ' +
            '`contracts/production-contract.md`，可含子目录）。不传则只返回 SKILL.md 主指令。',
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

      // 按路径取目录内文件：只返回被点名的那个文件，其余不铺设
      const file = args.file;
      if (typeof file === 'string' && file.trim()) {
        const r = readSkillFile(skill, file.trim());
        if (!r.ok) return { content: `ERROR: ${r.error}`, isError: true };
        return {
          content: JSON.stringify({ name: skill.name, file: file.trim(), content: r.content }),
        };
      }

      // 无 file → 只返回 SKILL.md 主指令
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
