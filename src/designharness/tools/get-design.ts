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
  const W = doc.canvas.width;
  const H = doc.canvas.height;
  const r4 = (v: number): number => Math.round(v * 10000) / 10000;

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
          // px 与 0–1 都给：patch 的 move/size 用 0–1，AI 不用自己除画布
          ...('frame' in e
            ? {
                frame: e.frame,
                frame01: {
                  x: r4(e.frame.x / W),
                  y: r4(e.frame.y / H),
                  w: r4(e.frame.w / W),
                },
              }
            : {
                rect: e.rect,
                rect01: {
                  x: r4(e.rect.x / W),
                  y: r4(e.rect.y / H),
                  w: r4(e.rect.w / W),
                  h: r4(e.rect.h / H),
                },
              }),
          fill: e.fill ?? null,
          stroke: e.stroke ?? null,
          ...(e.opacity !== undefined ? { opacity: e.opacity } : {}),
          ...(e.radius !== undefined ? { radius: e.radius } : {}),
          ...(e.shadow !== undefined ? { shadow: e.shadow } : {}),
          ...(e.blend !== undefined ? { blend: e.blend } : {}),
          ...(e.filter !== undefined ? { filter: e.filter } : {}),
          ...(e.backdrop !== undefined ? { backdrop: e.backdrop } : {}),
          ...(e.clip !== undefined ? { clip: e.clip } : {}),
          ...(e.mask !== undefined ? { mask: e.mask } : {}),
          ...(e.transform !== undefined ? { transform: e.transform } : {}),
          ...(e.type === 'text'
            ? {
                fontFamily: e.fontFamily ?? null,
                fontSizePx: e.fontSizePx ?? null,
                weight: e.weight ?? null,
                italic: e.italic ?? null,
                letterSpacing: e.letterSpacing ?? null,
                align: e.align ?? null,
                wrap: e.wrap ?? 'normal',
                ...(e.lineHeight !== undefined ? { lineHeight: e.lineHeight } : {}),
                ...(e.wordSpacing !== undefined ? { wordSpacing: e.wordSpacing } : {}),
                ...(e.stretch !== undefined ? { stretch: e.stretch } : {}),
                ...(e.alignLast !== undefined ? { alignLast: e.alignLast } : {}),
                ...(e.textTransform !== undefined ? { textTransform: e.textTransform } : {}),
                ...(e.smallCaps !== undefined ? { smallCaps: e.smallCaps } : {}),
                ...(e.underline !== undefined ? { underline: e.underline } : {}),
                ...(e.strike !== undefined ? { strike: e.strike } : {}),
                ...(e.decoration !== undefined ? { decoration: e.decoration } : {}),
                ...(e.baselineShift !== undefined ? { baselineShift: e.baselineShift } : {}),
                ...(e.dropCap !== undefined ? { dropCap: e.dropCap } : {}),
                ...(e.writingMode !== undefined ? { writingMode: e.writingMode } : {}),
                ...(e.direction !== undefined ? { direction: e.direction } : {}),
                ...(e.curve !== undefined ? { curve: e.curve } : {}),
                ...(e.path !== undefined ? { path: e.path } : {}),
                ...(e.features !== undefined ? { features: e.features } : {}),
                ...(e.variations !== undefined ? { variations: e.variations } : {}),
                ...(e.runs.length > 1 || e.runs.some((r) => Object.keys(r).some((k) => k !== 'text'))
                  ? { runs: e.runs }
                  : {}),
              }
            : {}),
          ...(e.type === 'shape' && e.kind === 'polygon' ? { points: e.points } : {}),
          ...(e.type === 'image'
            ? {
                ...(e.fit !== undefined ? { fit: e.fit } : {}),
                ...(e.position !== undefined ? { position: e.position } : {}),
                ...(e.render !== undefined ? { render: e.render } : {}),
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
      '读取版式的语义视图：图层/元素 id、name、type、text、frame/rect（px）、frame01/rect01（0–1）、' +
      '当前 fill/stroke/font/wrap/radius/shadow/blend/filter/clip/mask、图片 fit/position、文字对齐与装饰等。' +
      '默认读当前 active；也可以传 layout 读本会话系列里的另一张。' +
      '做任何 patch 前先用它确认节点 id 与当前 0–1 尺寸。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        layout: {
          type: 'string',
          description: '可选：读本会话系列里的哪一张；不传读当前 active',
        },
      },
    },
    async execute(args, ctx) {
      const requested = typeof args.layout === 'string' && args.layout.trim() ? args.layout.trim() : '';
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
      return { content: JSON.stringify({ layout, ...(semanticView(doc) as object) }) };
    },
  };
}
