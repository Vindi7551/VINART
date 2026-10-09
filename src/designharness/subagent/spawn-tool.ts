/**
 * spawn_design_agents —— 主 AI 的委派工具（E 阶段）。
 *
 * 主 AI 在聊天里决定「这活该批量委派」时调用本工具；工具内部组装
 * runAgentBatch（system 素材 + design-sketch 工具集 + 工作目录），同步等
 * 批次跑完，把结构化结果回喂给主 AI——由它向用户汇报。
 *
 * 设计要点：
 * - **主 AI 只给意图（jobs[].brief），不碰机制**：system 素材、工具表、
 *   目录、记账全部由这里固化组装——主 AI 写业务内容，代码管执行
 * - **brief 必须自包含**（CC/DSH 共识：上下文零继承是默认）：
 *   子 agent 看不到主 AI 的聊天记录，画面意图与逐字文案都要写进 brief
 * - 产物落 `<workDir>/<项目>/designs/<name>/`（项目 = 会话当前项目，
 *   set_project 设置；未设置 fail-loud）——与 artifacts / layout 端点同根
 * - 撞名防护（2026-10-08）：批内 name 重复整批拒绝；撞已有版式名拒绝——
 *   spawn 语义是「出新草案」，改现有版式走 edit_spec，重做请换新名
 * - 记账：runAgentBatch 内部落 agent-spawn / agent-result 事件对到父会话
 * - signal 透传：用户点停止 → 主 AI 流中止 → 批次取消一路传播
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getWorkDir, getProject } from '../session/transcript';
import { NO_PROJECT_HINT } from '../tools/project-paths';
import { getChatGateway } from '../../config';
import { runAgentBatch } from './runner';
import { designAgentSystem } from './design-system';
import { DESIGN_SKETCH_TOOLS } from '../tools';
import type { AgentTool } from './types';

export interface SpawnToolConfig {
  /** 父会话 id——记账落点 + 工作目录来源 */
  sessionId: string;
  /** 批次取消信号（ChatSession 的 abort controller） */
  signal?: AbortSignal;
  /** 同时运行的子 agent 上限（默认 3：渲染是 chromium 冷启动 ~25s/张，别一次起太多） */
  maxConcurrent?: number;
}

interface SpawnJobArg {
  label?: unknown;
  name?: unknown;
  brief?: unknown;
}

export function createSpawnTool(config: SpawnToolConfig): AgentTool {
  return {
    name: 'spawn_design_agents',
    description:
      '委派一批版式设计子 agent 并行工作：每个子 agent 独立产出一份 design-sketch.json ' +
      '（保存+静态校验）并渲染草图。适合「出一张/一套版式草案」类任务，不适合问答与闲聊。\n' +
      '⚠️ 每个 job 的 brief 必须**自包含**——子 agent 看不到你们的对话：' +
      '画面意图、逐字文案（标题/标签/脚注一个字不能漏）、布局要求全部写进 brief。',
    parameters: {
      type: 'object',
      properties: {
        jobs: {
          type: 'array',
          description: '要委派的任务列表',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: '任务标签，如「PT03 材质特写」（给用户看的进度名）' },
              name: { type: 'string', description: '版式名（design-sketch.json 的 name 与目录名），如 "PT03"。只能英文/数字/点/下划线/连字符' },
              brief: { type: 'string', description: '自包含的任务简报：画面意图、逐字文案、布局要求（占比/位置关系）' },
            },
            required: ['label', 'name', 'brief'],
          },
        },
      },
      required: ['jobs'],
    },

    async execute(args, ctx) {
      const raw = args.jobs;
      if (!Array.isArray(raw) || raw.length === 0) {
        return { content: 'ERROR: jobs 必须是非空数组（每个元素含 label/name/brief）。', isError: true };
      }
      const jobsIn = raw as SpawnJobArg[];
      for (const j of jobsIn) {
        if (typeof j.label !== 'string' || typeof j.name !== 'string' || typeof j.brief !== 'string' ||
            !j.name.trim() || !j.brief.trim()) {
          return { content: 'ERROR: 每个 job 都需要非空的 label（进度名）、name（版式名）、brief（自包含简报）。', isError: true };
        }
      }

      const workDir = await getWorkDir(config.sessionId);
      const project = await getProject(config.sessionId);
      if (!project) {
        return { content: `ERROR: ${NO_PROJECT_HINT}`, isError: true };
      }
      const dir = join(workDir, project, 'designs');

      // 撞名防护（fail-loud，批次未启动零成本）：批内重名 = 两个子 agent
      // 并发写同一目录互相覆盖；撞已有版式 = 静默覆盖旧版。都整批拒绝。
      const names = jobsIn.map((j) => j.name as string);
      const dup = names.find((n, i) => names.indexOf(n) !== i);
      if (dup) {
        return {
          content: `ERROR: 批次里有重复的版式名 "${dup}"——两个 job 会并发写同一个目录互相覆盖。每个 job 用不同的 name。`,
          isError: true,
        };
      }
      const existing = names.filter((n) => existsSync(join(dir, n)));
      if (existing.length > 0) {
        return {
          content: `ERROR: 以下版式名在项目「${project}」下已存在：${existing.join('、')}。` +
            'spawn 是出新草案，不会覆盖：重做一版请换新名（如 ' +
            existing.map((n) => `${n}-v2`).join('、') +
            '）；只是要改现有版式的话用 edit_spec 直接改（不委派，零成本）。',
          isError: true,
        };
      }

      const batch = await runAgentBatch({
        sessionId: config.sessionId,
        system: designAgentSystem(),
        seed: [],
        jobs: jobsIn.map((j) => ({
          label: j.label as string,
          name: j.name as string,
          // 版式名钉在简报开头——子 agent 的 save_spec 三个 name 必须一致
          brief: `版式名：${j.name}\n\n${j.brief}`,
        })),
        dir,
        tools: DESIGN_SKETCH_TOOLS,
        // 业务组装点（与 chat-store 同侧）由这里接真实网关；engine/runner 两层保持纯
        stream: (m, o) => getChatGateway().stream(m, o),
        signal: config.signal,
        maxConcurrent: config.maxConcurrent ?? 3,
        // 进度事件 → 上层（chat-session → SSE → 前端委派卡片）；runner 已带 name
        onEvent: (evt) => ctx.onEvent?.(evt),
      });

      const results = batch.outcomes.map((o, i) => ({
        name: jobsIn[i] ? (jobsIn[i].name as string) : '',
        label: o.label,
        stopReason: o.stopReason,
        summary: o.summary ?? null,
        artifacts: o.artifacts,
        diagnostic: o.diagnostic ?? null,
      }));

      // 产物事件：批次里有子 agent 落了盘（新 spec / sketch.png）→ 前端实时刷 gallery，
      // 不用等主 AI 写完总结
      if (batch.outcomes.some((o) => o.artifacts.length > 0)) {
        ctx.onEvent?.({ kind: 'artifacts', source: 'spawn_design_agents' });
      }

      return {
        content: JSON.stringify({ aborted: batch.aborted, usage: batch.usage, results }),
      };
    },
  };
}
