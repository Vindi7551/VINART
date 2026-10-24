/**
 * `edit_structure` 工具 —— 增删元素 / 图层、跨层移动、图层排序。
 *
 * 与 `patch_doc` 分工：
 * - 本工具改**文档树**（不含 group 内部）；
 * - `patch_doc` 只改已有节点的字段。
 *
 * 全部操作合法才写盘；任何一条失败整批不写。
 * 发 `doc-patch` 事件时带 `structure`（不是 patches），前端用同一个事件名申请结构变更。
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DesignDocument } from '../../document/vocabulary';
import { applyStructure } from '../../document/structure';
import { getWorkDir } from '../session/transcript';
import type { AgentTool } from '../subagent/types';

export function createEditStructureTool(config: { sessionId: string }): AgentTool {
  return {
    name: 'edit_structure',
    description:
      '增删/移动元素和图层，不改颜色/字体/文字等字段。' +
      'ops 支持：' +
      'add-elements {layer, elements[], index?}；' +
      'add-layer {name?, elements?, index?}；' +
      'remove-elements {ids[]}；' +
      'remove-layer {ids[], force?}（非空层必须 force:true）；' +
      'move-elements {ids[], toLayer, index?}；' +
      'reorder-layers {order[]}（必须包含全部图层 id）。' +
      'elements 复用 sketch_plan 的 SketchElement 格式：text 用 rect{x,y,w}+fontScale/placeholder；' +
      'image/svg/shape 用 rect{x,y,w,h}+asset/kind；shape.kind 支持 rect/ellipse/polygon（polygon 带 points）；' +
      '所有元素可选 clip（CSS clip-path）与 mask（CSS mask-image）。坐标是 0–1；id 自动生成，返回在 added。' +
      '先用 get_design 拿 layer id / element id。任何一条错整批不写。删除前必须得到用户明确同意。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['ops'],
      properties: {
        ops: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: true,
            required: ['op'],
            properties: {
              op: {
                type: 'string',
                enum: [
                  'add-elements',
                  'add-layer',
                  'remove-elements',
                  'remove-layer',
                  'move-elements',
                  'reorder-layers',
                ],
              },
              layer: { type: 'string' },
              toLayer: { type: 'string' },
              index: { type: 'number' },
              name: { type: 'string' },
              ids: { type: 'array', items: { type: 'string' } },
              order: { type: 'array', items: { type: 'string' } },
              force: { type: 'boolean' },
              elements: { type: 'array', items: { type: 'object', additionalProperties: true } },
            },
          },
        },
        layout: {
          type: 'string',
          description: '可选：改系列里的哪一张；不传用当前 active',
        },
      },
    },
    async execute(args, ctx) {
      const requested = typeof args.layout === 'string' ? args.layout.trim() : '';
      const layout = requested || ctx.activeLayout?.trim() || '';
      if (!layout) {
        return { content: 'ERROR: 当前没有打开的版式，也没有传 layout。', isError: true };
      }

      const workDir = await getWorkDir(config.sessionId);
      const p = join(workDir, 'designs', layout, 'doc.json');
      if (!existsSync(p)) {
        return { content: `ERROR: 版式 '${layout}' 不存在（没有 doc.json）。`, isError: true };
      }

      const doc = JSON.parse(readFileSync(p, 'utf8')) as DesignDocument;
      const r = applyStructure(doc, args.ops);
      if (r.errors.length) {
        return {
          content: JSON.stringify({
            ok: false,
            layout,
            applied: r.applied,
            errors: r.errors,
          }),
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

      // 新增的 image/svg 可能引用刚生成的素材：把 URL 一起交给前端
      const assets: Record<string, string> = {};
      for (const a of r.added) {
        if (!a.asset || a.asset === '@placeholder') continue;
        assets[a.asset] =
          `/api/sessions/${config.sessionId}/file/designs/${layout}/${encodeURIComponent(a.asset)}`;
      }

      ctx.onEvent?.({
        kind: 'doc-patch',
        layout,
        structure: args.ops,
        ...(Object.keys(assets).length ? { assets } : {}),
      });

      return {
        content: JSON.stringify({
          ok: true,
          layout,
          applied: r.applied,
          added: r.added,
          removed: r.removed,
          errors: [],
        }),
      };
    },
  };
}
