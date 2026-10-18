/**
 * `patch_doc` 工具 —— 按节点 id 批量 patch 当前版式 doc 的**颜色/字体**。
 *
 * 第一版白名单刻意很窄（只颜色/字体），"设计风格"交给后续 skill；
 * 多次试验后再逐步开放 radius/shadow/opacity 等。
 *
 * 语义：
 * - 全部 patch 通过 → 写 doc.json，发 artifacts；
 * - 任何一条失败 → **整批不写**，返回 errors（AI 改完再来）。
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DesignDocument, ElementNode } from '../../document/vocabulary';
import { findElement } from '../../document/vocabulary';
import { getWorkDir } from '../session/transcript';
import type { AgentTool } from '../subagent/types';

export interface DocPatch {
  id: string;
  path: string;
  value: unknown;
}

export interface PatchResult {
  doc: DesignDocument;
  applied: number;
  errors: string[];
}

/** 白名单：先只放颜色/字体 */
const ALLOWED = new Map<string, (v: unknown) => boolean>([
  ['fill', (v) => typeof v === 'string' || (Array.isArray(v) && v.every((x) => typeof x === 'string'))],
  ['stroke.paint', (v) => typeof v === 'string' || (Array.isArray(v) && v.every((x) => typeof x === 'string'))],
  ['fontFamily', (v) => typeof v === 'string'],
  ['fontSizePx', (v) => typeof v === 'number' && Number.isFinite(v) && v > 0],
  ['weight', (v) => typeof v === 'number' && Number.isFinite(v)],
  ['italic', (v) => typeof v === 'boolean'],
  ['letterSpacing', (v) => typeof v === 'number' && Number.isFinite(v)],
  ['lineHeight', (v) => typeof v === 'number' && Number.isFinite(v) && v > 0],
]);

export function allowedPatchPaths(): string[] {
  return [...ALLOWED.keys()];
}

/**
 * 纯函数：克隆 doc，逐条应用 patch。**不写盘**。
 * 返回的 doc 只在 errors 为空时才可以落盘。
 */
export function applyPatches(doc: DesignDocument, patches: DocPatch[]): PatchResult {
  const next = structuredClone(doc) as DesignDocument;
  const errors: string[] = [];
  let applied = 0;

  if (!Array.isArray(patches)) {
    return { doc: next, applied, errors: ['patches 必须是数组'] };
  }

  for (const [i, p] of patches.entries()) {
    if (!p || typeof p !== 'object') {
      errors.push(`patches[${i}] 不是对象`);
      continue;
    }
    const id = (p as { id?: unknown }).id;
    const path = (p as { path?: unknown }).path;
    const value = (p as { value?: unknown }).value;
    if (typeof id !== 'string' || !id) {
      errors.push(`patches[${i}].id 缺失`);
      continue;
    }
    if (typeof path !== 'string' || !path) {
      errors.push(`patches[${i}].path 缺失`);
      continue;
    }
    const check = ALLOWED.get(path);
    if (!check) {
      errors.push(`patches[${i}].path '${path}' 不在白名单`);
      continue;
    }
    if (!check(value)) {
      errors.push(`patches[${i}] 的值类型不对（${path}）`);
      continue;
    }
    const node = findElement(next, id) as ElementNode | null;
    if (!node) {
      errors.push(`找不到节点 '${id}'`);
      continue;
    }
    if (node.type === 'group') {
      errors.push(`节点 '${id}' 是 group，不支持颜色/字体 patch`);
      continue;
    }
    if (path === 'stroke.paint') {
      (node as { stroke?: Record<string, unknown> }).stroke = {
        ...((node as { stroke?: Record<string, unknown> }).stroke ?? {}),
        paint: value,
      };
    } else {
      (node as unknown as Record<string, unknown>)[path] = value;
    }
    applied++;
  }

  return { doc: next, applied, errors };
}

export function createPatchDocTool(config: { sessionId: string }): AgentTool {
  return {
    name: 'patch_doc',
    description:
      '按节点 id 批量 patch 当前版式 doc 的颜色/字体：fill / stroke.paint / fontFamily / fontSizePx / ' +
      'weight / italic / letterSpacing / lineHeight。全部合法才写；有任何一条错就整批不写。' +
      '先用 get_design 确认节点 id。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['patches'],
      properties: {
        patches: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'path', 'value'],
            properties: {
              id: { type: 'string' },
              path: { type: 'string', enum: allowedPatchPaths() },
              value: {},
            },
          },
        },
      },
    },
    async execute(args, ctx) {
      const layout = ctx.activeLayout?.trim() ?? '';
      if (!layout) {
        return { content: 'ERROR: 当前没有打开的版式。', isError: true };
      }
      const patches = args.patches;
      if (!Array.isArray(patches)) {
        return { content: 'ERROR: patches 必须是数组。', isError: true };
      }

      const workDir = await getWorkDir(config.sessionId);
      const p = join(workDir, 'designs', layout, 'doc.json');
      if (!existsSync(p)) {
        return { content: `ERROR: 版式 ${layout} 还没有 doc.json。`, isError: true };
      }

      const doc = JSON.parse(readFileSync(p, 'utf8')) as DesignDocument;
      const r = applyPatches(doc, patches as DocPatch[]);
      if (r.errors.length) {
        return {
          content: JSON.stringify({ ok: false, layout, applied: r.applied, errors: r.errors }),
          isError: true,
        };
      }

      try {
        writeFileSync(p, JSON.stringify(r.doc, null, 2), 'utf8');
      } catch (e) {
        return {
          content: `ERROR: 写 doc.json 失败：${e instanceof Error ? e.message : String(e)}`,
          isError: true,
        };
      }

      ctx.onEvent?.({ kind: 'artifacts', layout });
      return { content: JSON.stringify({ ok: true, layout, applied: r.applied, errors: [] }) };
    },
  };
}
