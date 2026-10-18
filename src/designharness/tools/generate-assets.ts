/**
 * `generate_assets` 工具 —— 生成素材文件（**不改 doc**）。
 *
 * 两类：
 * - `images`：商品/场景图，走 `assetsgen` 的生图模型 → PNG；
 * - `icons`：主 AI 直接写的**线框 SVG** → 安全检查后落盘。
 *
 * ⚠️ 只落盘，**不发 artifacts**：素材文件本身不会改变 doc；等 AI 用
 * `patch_doc` 把节点的 `asset` 指过去时才需要刷新预览（那一步由 patch_doc 发）。
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { DesignDocument } from '../../document/vocabulary';
import type { AssetOrders } from '../../workflow/assetsgen/asset-order';
import { generateAssets, type AssetJobResult } from '../../workflow/assetsgen/image';
import { getWorkDir } from '../session/transcript';
import type { AgentTool } from '../subagent/types';

export interface IconResult {
  file: string;
  ok: boolean;
  bytes?: number;
  error?: string;
}

/**
 * SVG 安全检查：拒绝脚本 / 事件 / javascript: / foreignObject / 外链。
 * 线框图标本身是纯 path/stroke，正常不会碰这些。
 */
export function sanitizeSvg(raw: string): { ok: boolean; svg: string; errors: string[] } {
  let svg = raw.trim();
  const errors: string[] = [];
  if (!/^<svg[\s>]/i.test(svg)) errors.push('不是 <svg> 开头');
  if (/<script\b/i.test(svg)) errors.push('包含 <script>');
  if (/\son[a-z]+\s*=/i.test(svg)) errors.push('包含 on* 事件');
  if (/javascript:/i.test(svg)) errors.push('包含 javascript:');
  if (/<foreignObject\b/i.test(svg)) errors.push('包含 <foreignObject>');
  if (/(?:href|src)\s*=\s*["']?\s*(?:https?:)?\/\//i.test(svg)) errors.push('包含外链');
  if (/url\(\s*["']?\s*(?:https?:)?\/\//i.test(svg)) errors.push('包含外链 url()');
  // ⚠️ emit 把 svg 节点渲染成 `<img src="...svg">`：外部 SVG 作为独立图片解析时
  //    必须有 xmlns，否则浏览器直接破图（内联 <svg> 才可省略）。
  if (svg.startsWith('<svg') && !/\sxmlns\s*=/i.test(svg)) {
    svg = svg.replace(/^<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  return { ok: errors.length === 0, svg, errors };
}

function safeSvgName(file: unknown): string | null {
  if (typeof file !== 'string') return null;
  const f = file.trim();
  if (!f.endsWith('.svg')) return null;
  if (f.includes('/') || f.includes('\\') || f.startsWith('.')) return null;
  return f;
}

export function createGenerateAssetsTool(config: { sessionId: string }): AgentTool {
  return {
    name: 'generate_assets',
    description:
      '生成素材文件，但不改 doc：images 走生图模型（商品/场景，PNG）；icons 是主 AI 直接写的线框 SVG ' +
      '（viewBox="0 0 24 24" fill="none" stroke="currentColor"）。生成后用 patch_doc 把对应 image/svg 节点的 ' +
      'asset 指到文件名。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        images: {
          type: 'array',
          description: '生图订单（商品/场景）',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['file', 'prompt'],
            properties: {
              file: { type: 'string', description: '输出文件名，如 scene.png' },
              size: { type: 'string', description: '如 2048x2048 / 1440x2560' },
              prompt: { type: 'string' },
              references: {
                type: 'array',
                description: '参考图；@product 商品照 / @sketch 草图 / 文件名',
                items: { type: 'object', additionalProperties: true },
              },
              useSketchRef: { type: 'boolean' },
            },
          },
        },
        icons: {
          type: 'array',
          description: '线框 SVG 图标（主 AI 自己写）',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['file', 'svg'],
            properties: {
              file: { type: 'string', description: '输出文件名，如 icon-cart.svg' },
              svg: { type: 'string', description: '完整 <svg>…</svg>' },
            },
          },
        },
        productPath: {
          type: 'string',
          description: '可选：商品实物照路径（订单引用 @product 时需要）',
        },
      },
    },
    async execute(args, ctx) {
      const layout = ctx.activeLayout?.trim() ?? '';
      if (!layout) {
        return { content: 'ERROR: 当前没有打开的版式。', isError: true };
      }
      const workDir = await getWorkDir(config.sessionId);
      const outDir = join(workDir, 'designs', layout);
      const docPath = join(outDir, 'doc.json');
      if (!existsSync(docPath)) {
        return { content: `ERROR: 版式 ${layout} 还没有 doc.json。`, isError: true };
      }

      const images = Array.isArray(args.images) ? (args.images as AssetOrders) : [];
      const icons = Array.isArray(args.icons) ? (args.icons as Array<{ file?: unknown; svg?: unknown }>) : [];
      if (!images.length && !icons.length) {
        return { content: 'ERROR: images 和 icons 至少给一个。', isError: true };
      }

      const imageResults: AssetJobResult[] = [];
      if (images.length) {
        const spec = JSON.parse(readFileSync(docPath, 'utf8')) as DesignDocument;
        const { createBlinkRenderer } = await import('../../render/rasterize/blink-renderer');
        const renderer = await createBlinkRenderer();
        try {
          imageResults.push(
            ...(await generateAssets({
              orders: images,
              spec,
              outDir,
              productPath:
                (typeof args.productPath === 'string' && args.productPath.trim()) || null,
              host: renderer,
              force: false,
            })),
          );
        } catch (e) {
          return {
            content: JSON.stringify({
              ok: false,
              layout,
              images: imageResults,
              icons: [],
              errors: [`生图失败：${e instanceof Error ? e.message : String(e)}`],
            }),
            isError: true,
          };
        } finally {
          await renderer.dispose();
        }
      }

      const iconResults: IconResult[] = [];
      for (const icon of icons) {
        const file = safeSvgName(icon.file);
        if (!file) {
          iconResults.push({
            file: String(icon.file ?? ''),
            ok: false,
            error: 'file 必须是 .svg 文件名（不含路径）',
          });
          continue;
        }
        if (typeof icon.svg !== 'string') {
          iconResults.push({ file, ok: false, error: 'svg 必须是字符串' });
          continue;
        }
        const s = sanitizeSvg(icon.svg);
        if (!s.ok) {
          iconResults.push({ file, ok: false, error: s.errors.join('; ') });
          continue;
        }
        try {
          writeFileSync(join(outDir, file), s.svg, 'utf8');
          iconResults.push({ file, ok: true, bytes: Buffer.byteLength(s.svg) });
        } catch (e) {
          iconResults.push({ file, ok: false, error: e instanceof Error ? e.message : String(e) });
        }
      }

      const ok = imageResults.every((r) => r.ok) && iconResults.every((r) => r.ok);
      return {
        content: JSON.stringify({ ok, layout, images: imageResults, icons: iconResults }),
        ...(ok ? {} : { isError: true }),
      };
    },
  };
}
