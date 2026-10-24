/**
 * `spawn_agents` —— 主 AI 派出一批**通用任务**子 agent。
 *
 * 子 agent 不是固定角色：主 AI 用 `tools` 白名单决定它能做什么，
 * 用 `brief` 决定这次任务。runner 负责并发、账本、取消与 finish。
 *
 * 隔离：
 * - 写工具必须绑定 layout，同一 layout 只允许一个写 job；
 * - 子 agent 永远拿不到 spawn_agents（深度恒 1）。
 *
 * seed 里带 shared + 可选图片附件；同批所有 job 字节级相同。
 */

import { readFileSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { getChatGateway } from '../../config';
import { fileToDataUrl, isSupportedImagePath } from '../gateway/util/data-url';
import type { ChatMessage, ContentPart } from '../gateway/type/chat';
import { getWorkDir } from '../session/transcript';
import { runAgentBatch } from '../subagent/runner';
import type { AgentTool } from '../subagent/types';
import { createSkillTool } from '../skills/skill-tool';
import { createSketchTool } from './sketch-plan';
import { createGetDesignTool } from './get-design';
import { createPatchDocTool } from './patch-doc';
import { createEditStructureTool } from './edit-structure';
import { createGenerateAssetsTool } from './generate-assets';

const SUBAGENT_SYSTEM_PATH = resolve('src/designharness/subagent/subagent-system.md');
let systemCache: string | null = null;
function subagentSystem(): string {
  if (systemCache === null) systemCache = readFileSync(SUBAGENT_SYSTEM_PATH, 'utf8');
  return systemCache;
}

const ALLOWED_TOOLS = [
  'skill',
  'get_design',
  'sketch_plan',
  'patch_doc',
  'edit_structure',
  'generate_assets',
] as const;
type AllowedTool = (typeof ALLOWED_TOOLS)[number];
const ALLOWED = new Set<string>(ALLOWED_TOOLS);
const WRITE_TOOLS = new Set<AllowedTool>([
  'sketch_plan',
  'patch_doc',
  'edit_structure',
  'generate_assets',
]);
const LAYOUT_TOOLS = new Set<AllowedTool>([
  'get_design',
  'sketch_plan',
  'patch_doc',
  'edit_structure',
  'generate_assets',
]);

const MAX_JOBS = 4;
const MAX_ATTACHMENTS = 6;
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;

interface JobInput {
  label: string;
  brief: string;
  tools: AllowedTool[];
  layout?: string;
  maxTurns?: number;
  temperature?: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function normalizeJobs(raw: unknown): { jobs: JobInput[]; error?: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { jobs: [], error: 'jobs 必须是非空数组' };
  if (raw.length > MAX_JOBS) return { jobs: [], error: `一次最多 ${MAX_JOBS} 个 job` };
  const jobs: JobInput[] = [];
  for (const [i, item] of raw.entries()) {
    if (!isRecord(item)) return { jobs: [], error: `jobs[${i}] 不是对象` };
    if (typeof item.label !== 'string' || !item.label.trim()) {
      return { jobs: [], error: `jobs[${i}].label 必须是非空字符串` };
    }
    if (typeof item.brief !== 'string' || !item.brief.trim()) {
      return { jobs: [], error: `jobs[${i}].brief 必须是非空字符串` };
    }
    if (!Array.isArray(item.tools) || item.tools.some((t) => typeof t !== 'string')) {
      return { jobs: [], error: `jobs[${i}].tools 必须是字符串数组` };
    }
    const tools = item.tools as string[];
    const bad = tools.find((t) => !ALLOWED.has(t));
    if (bad) return { jobs: [], error: `jobs[${i}] 不允许工具 '${bad}'` };
    if (tools.includes('spawn_agents')) {
      return { jobs: [], error: `jobs[${i}] 不能递归 spawn` };
    }
    jobs.push({
      label: item.label.trim(),
      brief: item.brief.trim(),
      tools: tools as AllowedTool[],
      ...(typeof item.layout === 'string' && item.layout.trim() ? { layout: item.layout.trim() } : {}),
      ...(typeof item.maxTurns === 'number' ? { maxTurns: item.maxTurns } : {}),
      ...(typeof item.temperature === 'number' ? { temperature: item.temperature } : {}),
    });
  }
  return { jobs };
}

function buildSeed(shared: string, attachments: string[], workDir: string): ChatMessage[] {
  const parts: ContentPart[] = [{ type: 'text', text: shared }];
  let total = 0;
  for (const [i, rel] of attachments.entries()) {
    const abs = resolve(workDir, rel);
    if (!abs.startsWith(workDir + sep) || !isSupportedImagePath(abs)) {
      throw new Error(`attachments[${i}] 不是工作目录内的受支持图片：${rel}`);
    }
    let size = 0;
    try {
      size = statSync(abs).size;
    } catch {
      throw new Error(`attachments[${i}] 文件不存在：${rel}`);
    }
    if (size > MAX_ATTACHMENT_BYTES) {
      throw new Error(`attachments[${i}] 超过 8 MiB：${rel}`);
    }
    total += size;
    if (total > MAX_TOTAL_ATTACHMENT_BYTES) {
      throw new Error('attachments 总大小超限（最多 20 MiB）');
    }
    parts.push({ type: 'image_url', image_url: { url: fileToDataUrl(abs) } });
  }
  return [{ role: 'user', content: parts }];
}

function scopeTool(tool: AgentTool, layout?: string): AgentTool {
  if (!layout) return tool;
  return {
    ...tool,
    execute: (args, ctx) =>
      tool.execute({ ...args, layout }, { ...ctx, activeLayout: layout }),
  };
}

export function createSpawnAgentsTool(config: { sessionId: string }): AgentTool {
  return {
    name: 'spawn_agents',
    description:
      '派出一批通用任务子 agent。每个 job 自己带 brief 和 tools 白名单；' +
      '适合并行审查、锁定事实、出多个独立 layout 草稿等。' +
      'jobs[].tools 可选：skill / get_design / sketch_plan / patch_doc / edit_structure / generate_assets。' +
      '写工具必须给 layout；同一 layout 只允许一个写 job。子 agent 不能递归 spawn。' +
      'shared 是同批共享上下文；attachments 可带工作目录内的图片路径（不传则继承本轮用户上传的图片），供审查使用。' +
      '返回 outcomes（runId/label/layout/stopReason/summary/artifacts）与 usage。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['shared', 'jobs'],
      properties: {
        shared: {
          type: 'string',
          description: '同批所有子 agent 共享的上下文：用户需求、产品/品牌事实、风格约束等',
        },
        attachments: {
          type: 'array',
          items: { type: 'string' },
          description: '可选：工作目录内的图片路径，供子 agent 查看（最多 6 张，每张 ≤8MiB）',
        },
        maxConcurrent: {
          type: 'number',
          description: '并发数，默认 3，最大 6',
        },
        jobs: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['label', 'brief', 'tools'],
            properties: {
              label: { type: 'string' },
              brief: { type: 'string' },
              tools: {
                type: 'array',
                items: { type: 'string', enum: [...ALLOWED_TOOLS] },
              },
              layout: { type: 'string', description: '写任务的必填 layout；读写都锁定到它' },
              maxTurns: { type: 'number' },
              temperature: { type: 'number' },
            },
          },
        },
      },
    },
    async execute(args, ctx) {
      if (typeof args.shared !== 'string' || !args.shared.trim()) {
        return { content: 'ERROR: shared 必须是非空字符串。', isError: true };
      }
      const parsed = normalizeJobs(args.jobs);
      if (parsed.error) return { content: `ERROR: ${parsed.error}`, isError: true };
      const jobs = parsed.jobs;

      const workDir = await getWorkDir(config.sessionId);
      if (!workDir) {
        return { content: 'ERROR: 当前会话还没有工作目录，不能 spawn。', isError: true };
      }

      // layout 补齐 + 写冲突检查
      const writeLayouts = new Set<string>();
      for (const [i, j] of jobs.entries()) {
        const writes = j.tools.some((t) => WRITE_TOOLS.has(t));
        const needsLayout = j.tools.some((t) => LAYOUT_TOOLS.has(t));
        const layout =
          j.layout ||
          (!writes && j.tools.includes('get_design') ? ctx.activeLayout?.trim() : undefined);
        if (needsLayout && !layout) {
          return { content: `ERROR: jobs[${i}] 使用了 layout 工具，必须给 layout。`, isError: true };
        }
        if (writes && !j.layout) {
          return { content: `ERROR: jobs[${i}] 使用写工具，必须显式给 layout。`, isError: true };
        }
        if (layout) j.layout = layout;
        if (writes) {
          if (writeLayouts.has(layout!)) {
            return { content: `ERROR: layout '${layout}' 被多个写 job 使用；请每个写任务独立 layout。`, isError: true };
          }
          writeLayouts.add(layout!);
        }
      }

      let seed: ChatMessage[];
      try {
        const explicit = Array.isArray(args.attachments)
          ? args.attachments.filter((x): x is string => typeof x === 'string')
          : null;
        // 没显式传 = 继承本轮用户上传的素材；显式 [] = 不带图
        const attachments = explicit ?? ctx.attachments ?? [];
        if (attachments.length > MAX_ATTACHMENTS) {
          return { content: `ERROR: attachments 最多 ${MAX_ATTACHMENTS} 张。`, isError: true };
        }
        seed = buildSeed(args.shared.trim(), attachments, workDir);
      } catch (e) {
        return { content: `ERROR: ${e instanceof Error ? e.message : String(e)}`, isError: true };
      }

      const all: Record<string, AgentTool> = {
        skill: createSkillTool({ sessionId: config.sessionId }),
        get_design: createGetDesignTool({ sessionId: config.sessionId }),
        sketch_plan: createSketchTool({ sessionId: config.sessionId }),
        patch_doc: createPatchDocTool({ sessionId: config.sessionId }),
        edit_structure: createEditStructureTool({ sessionId: config.sessionId }),
        generate_assets: createGenerateAssetsTool({ sessionId: config.sessionId }),
      };

      const batch = await runAgentBatch({
        sessionId: config.sessionId,
        system: subagentSystem(),
        seed,
        dir: workDir,
        tools: [],
        jobs: jobs.map((j) => ({
          label: j.label,
          ...(j.layout ? { name: j.layout } : {}),
          brief: j.layout ? `[分配的 layout：${j.layout}]\n${j.brief}` : j.brief,
          tools: j.tools.map((name) => scopeTool(all[name]!, j.layout)),
          ...(j.maxTurns !== undefined ? { maxTurns: j.maxTurns } : {}),
          ...(j.temperature !== undefined ? { temperature: j.temperature } : {}),
        })),
        stream: getChatGateway().stream,
        maxConcurrent: Math.min(6, Math.max(1, Number(args.maxConcurrent) || 3)),
        signal: ctx.signal,
        onEvent: (evt) => ctx.onEvent?.(evt),
      });

      return {
        content: JSON.stringify({
          ok: true,
          outcomes: batch.outcomes.map((o, i) => ({
            runId: o.runId,
            label: o.label,
            layout: jobs[i]?.layout ?? null,
            stopReason: o.stopReason,
            summary: o.summary ?? null,
            artifacts: o.artifacts,
            diagnostic: o.diagnostic ?? null,
          })),
          usage: batch.usage,
          errors: [],
        }),
      };
    },
  };
}
