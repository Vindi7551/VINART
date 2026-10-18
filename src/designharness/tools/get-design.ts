/**
 * `get_design` 工具 —— 给 AI 读**当前版式的语义视图**（不是完整 doc）。
 *
 * 为什么需要它：`buildLayoutNote()` 每轮只注入 id/type/name/text 的摘要；
 * 做颜色/字体 patch 时，AI 还需要知道当前 fill/font、frame/rect、图层名。
 * 按需调用比每轮塞完整 doc 省 token。
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DesignDocument } from '../../document/vocabulary';
import { iterElements } from '../../document/vocabulary';
import { getWorkDir } from '../session/transcript';
import type { AgentTool } from '../subagent/types';

/** 当前 doc 的语义视图：够 AI 决定改哪个节点、改成什么，但远小于完整 doc */
export function semanticView(doc: DesignDocument): unknown {
  return {
    canvas: doc.canvas,
    layers: doc.layers.map((l) => ({
      id: l.id,
      name: l.name ?? null,
      elements: [...iterElements(l)].map((e) => {
        if (e.type === 'group') {
          return { id: e.id, name: e.name ?? null, type: 'group' as const };
        }
        return {
          id: e.id,
          name: e.name ?? null,
          type: e.type,
          ...(e.type === 'text' ? { text: e.runs.map((r) => r.text).join('') } : {}),
          ...('frame' in e ? { frame: e.frame } : { rect: e.rect }),
          fill: e.fill ?? null,
          stroke: e.stroke ?? null,
          ...(e.type === 'text'
            ? {
                fontFamily: e.fontFamily ?? null,
                fontSizePx: e.fontSizePx ?? null,
                weight: e.weight ?? null,
                italic: e.italic ?? null,
                letterSpacing: e.letterSpacing ?? null,
                align: e.align ?? null,
              }
            : {}),
        };
      }),
    })),
  };
}

export function createGetDesignTool(config: { sessionId: string }): AgentTool {
  return {
    name: 'get_design',
    description:
      '读取当前打开版式的语义视图：图层/元素 id、name、type、text、frame/rect、当前 fill/stroke/font。' +
      '做颜色/字体 patch 前先用它确认节点；不要凭记忆猜 id。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
    async execute(_args, ctx) {
      const layout = ctx.activeLayout?.trim() ?? '';
      if (!layout) {
        return { content: 'ERROR: 当前没有打开的版式。', isError: true };
      }
      const workDir = await getWorkDir(config.sessionId);
      const p = join(workDir, 'designs', layout, 'doc.json');
      if (!existsSync(p)) {
        return { content: `ERROR: 版式 ${layout} 还没有 doc.json。`, isError: true };
      }
      const doc = JSON.parse(readFileSync(p, 'utf8')) as DesignDocument;
      return { content: JSON.stringify({ layout, ...(semanticView(doc) as object) }) };
    },
  };
}
