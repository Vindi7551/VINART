/**
 * `patch_doc` 工具 —— 按节点 id 批量 patch 当前版式 doc 的**颜色/字体/素材引用**。
 *
 * 语义：
 * - 全部 patch 通过 → **立刻写盘**（AI 回读一致）+ 发 `doc-patch { patches }`；
 * - 任何一条失败 → **整批不写**，返回 errors（AI 改完再来）。
 *
 * ⚠️ 发的是 **patches**（不是整份 doc）：App 把它应用到当前内存 doc，
 *    这样用户编辑器里尚未自动保存的改动不会被工具按旧盘算出的整份 doc 覆盖。
 * ⚠️ 写盘仍按旧盘算：盘上暂时没有用户未保存的那一下；自动保存后一致。
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DesignDocument } from '../../document/vocabulary';
import {
  applyPatches,
  allowedPatchPaths,
  type DocPatch,
  type PatchResult,
} from '../../document/patch';
import { getWorkDir } from '../session/transcript';
import type { AgentTool } from '../subagent/types';

export { applyPatches, allowedPatchPaths, type DocPatch, type PatchResult };

export function createPatchDocTool(config: { sessionId: string }): AgentTool {
  return {
    name: 'patch_doc',
    description:
      '按节点 id 批量 patch 当前版式 doc：颜色/字体 fill / stroke.paint / fontFamily / fontSizePx / ' +
      'weight / italic / letterSpacing / lineHeight；素材引用 asset（仅 image/svg，填 generate_assets 产出的文件名）。' +
      '全部合法才写；有任何一条错就整批不写。先用 get_design 确认节点 id。',
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
      const patches = args.patches;
      if (!Array.isArray(patches)) {
        return { content: 'ERROR: patches 必须是数组。', isError: true };
      }

      const workDir = await getWorkDir(config.sessionId);
      const p = join(workDir, 'designs', layout, 'doc.json');
      if (!existsSync(p)) {
        return { content: `ERROR: 版式 '${layout}' 不存在（没有 doc.json）。`, isError: true };
      }

      const doc = JSON.parse(readFileSync(p, 'utf8')) as DesignDocument;
      const r = applyPatches(doc, patches as DocPatch[]);
      if (r.errors.length) {
        return {
          content: JSON.stringify({ ok: false, layout, applied: r.applied, errors: r.errors }),
          isError: true,
        };
      }

      // 立刻写盘：同一轮里 get_design / buildLayoutNote 立刻能读到新值。
      try {
        writeFileSync(p, JSON.stringify(r.doc, null, 2), 'utf8');
      } catch (e) {
        return {
          content: `ERROR: 写 doc.json 失败：${e instanceof Error ? e.message : String(e)}`,
          isError: true,
        };
      }

      // 只发 patches：App 应用到当前内存 doc，保留用户尚未自动保存的改动。
      // 同时带上这次新引用素材的 URL：App 的 assets map 是上次 /data 的，
      // 不含刚生成的图片；不带的话就地重发图层会得到空 src（刷新才出现）。
      const assets: Record<string, string> = {};
      for (const p of patches as DocPatch[]) {
        if (p.path === 'asset' && typeof p.value === 'string' && p.value.trim()) {
          const file = p.value.trim();
          assets[file] =
            `/api/sessions/${config.sessionId}/file/designs/${layout}/${encodeURIComponent(file)}`;
        }
      }
      ctx.onEvent?.({
        kind: 'doc-patch',
        layout,
        patches,
        ...(Object.keys(assets).length ? { assets } : {}),
      });
      return { content: JSON.stringify({ ok: true, layout, applied: r.applied, errors: [] }) };
    },
  };
}
