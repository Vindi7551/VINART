/**
 * set_project 工具 —— 主 AI 建/切项目（本地零成本，写 meta + 索引）。
 *
 * 场景：用户在聊天里说「这是新产品，叫黑T恤」「接着给砧板也出一套」——
 * 主 AI 直接 set_project，不用让用户去前端下拉里手动切。
 * 项目名做目录名（英文连字符），displayName 承载中文展示名。
 */
import { join, resolve } from 'node:path';
import { getProject, getWorkDir, setProject } from '../session/transcript';
import { listProjects, registerProject } from '../session/projects';
import type { AgentTool } from '../subagent/types';

export function createSetProjectTool(config: { sessionId: string }): AgentTool {
  return {
    name: 'set_project',
    description:
      '建立并/或切换**当前项目**（产物一级分组：<工作目录>/<项目名>/designs/…、briefs/、uploads/ 都归它）。' +
      '用户提到新产品、要求换产品时用它；name 是目录名（英文/数字/连字符），displayName 给中文展示名。' +
      '已存在的项目只切换；新名字会自动创建目录并注册。之后所有 spawn_design_agents / render_design 等' +
      '工具的产物都落在这个项目下，直到再次切换。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '项目目录名：英文/数字/点/下划线/连字符，如 "schneidebrett-40"' },
        displayName: { type: 'string', description: '展示名（可中文），如 "40岁生日砧板"。省略则展示名 = name' },
      },
      required: ['name'],
    },
    async execute(args) {
      const name = args.name;
      if (typeof name !== 'string' || !name.trim()) {
        return { content: 'ERROR: 缺少 name（项目目录名，英文/数字/连字符）。', isError: true };
      }
      const displayName = typeof args.displayName === 'string' && args.displayName.trim() ? args.displayName.trim() : undefined;

      const workDir = resolve(await getWorkDir(config.sessionId));
      let dir: string;
      try {
        dir = registerProject(workDir, name, displayName);
      } catch (e) {
        return { content: `ERROR: ${(e as Error).message}`, isError: true };
      }
      await setProject(config.sessionId, name);

      const prev = await getProject(config.sessionId);
      const shown = displayName ?? name;
      const known = listProjects(workDir);
      return {
        content: JSON.stringify({
          ok: true,
          project: name,
          displayName: shown,
          dir: dir,
          reused: known.some((p) => p.name === name && p.createdAt !== p.updatedAt),
          projects: known.map((p) => ({ name: p.name, displayName: p.displayName ?? p.name })),
          note: `已切换到项目「${shown}」（${join(resolve(workDir), name)}）。` +
            (prev && prev !== name ? `此前是「${prev}」。` : '') +
            '之后的版式/素材/成品都落这个项目。',
        }),
      };
    },
  };
}
