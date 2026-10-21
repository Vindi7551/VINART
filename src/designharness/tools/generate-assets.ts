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

/** 版式名只允许一层目录名，禁止路径穿越（与 sketch_plan 同一规则） */
function safeLayout(name: string): boolean {
  return (
    name.length > 0 && name !== '.' && name !== '..' && !name.includes('..') && !/[\\/]/.test(name)
  );
}

/**
 * 生图订单的入参校验 —— 有问题就**一张都不生成**，一次把所有问题列出来。
 *
 * 只校验「会不会白花钱 / 会不会写到目录外」：
 * file 是纯 .png 名、prompt 非空、size 格式与像素下限、references 是数组。
 */
export function validateImageOrders(images: AssetOrders): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();

  images.forEach((o, i) => {
    const tag = `images[${i}]`;
    if (!o || typeof o !== 'object') {
      problems.push(`${tag} 不是对象`);
      return;
    }

    const file = typeof o.file === 'string' ? o.file.trim() : '';
    if (!file) problems.push(`${tag}.file 必填`);
    else if (!/^[^/\\]+\.png$/i.test(file) || file.startsWith('.') || file.includes('..')) {
      problems.push(`${tag}.file 必须是 .png 纯文件名（不含路径）：${file}`);
    } else if (seen.has(file.toLowerCase())) {
      problems.push(`${tag}.file 重复：${file}`);
    } else {
      seen.add(file.toLowerCase());
    }

    const prompt = typeof o.prompt === 'string' ? o.prompt.trim() : '';
    if (!prompt) problems.push(`${tag}.prompt 必填（不能为空）`);

    if (o.size !== undefined) {
      const size = String(o.size).trim();
      const m = /^(\d+)x(\d+)$/i.exec(size);
      if (!m) {
        // 方舟也接受档位写法
        if (!/^[234]K$/i.test(size)) {
          problems.push(`${tag}.size 应为 宽x高（如 2048x2048）或 2K/3K/4K`);
        }
      } else if (Number(m[1]) * Number(m[2]) < 3_686_400) {
        problems.push(`${tag}.size ${size} 低于 3,686,400 像素下限`);
      }
    }

    const refs = (o as { references?: unknown }).references;
    if (refs !== undefined) {
      if (!Array.isArray(refs)) problems.push(`${tag}.references 必须是数组`);
      else {
        if (refs.length > 14) problems.push(`${tag}.references 最多 14 张（方舟上限）`);
        refs.forEach((r, j) => {
          const ref =
            typeof r === 'string'
              ? r
              : r && typeof r === 'object'
                ? ((r as Record<string, unknown>).ref ??
                  (r as Record<string, unknown>).file ??
                  (r as Record<string, unknown>).path ??
                  (r as Record<string, unknown>).name)
                : '';
          if (typeof ref !== 'string' || !ref.trim()) {
            problems.push(`${tag}.references[${j}] 缺少文件名`);
          }
        });
      }
    }
  });

  return problems;
}

/**
 * 把订单合并进 `<layout>/assets.json`（按 file 去重，新覆盖旧）。
 * 这个文件**没有任何代码读**——纯粹留底：这版素材当初是用什么提示词/参考图生成的。
 */
export function saveOrdersLedger(outDir: string, layout: string, images: AssetOrders): void {
  const p = join(outDir, 'assets.json');
  let prev: AssetOrders = [];
  if (existsSync(p)) {
    try {
      const j = JSON.parse(readFileSync(p, 'utf8')) as { orders?: AssetOrders };
      if (Array.isArray(j?.orders)) prev = j.orders;
    } catch {
      /* 坏文件就当没有 */
    }
  }
  const byFile = new Map(prev.map((o) => [o.file, o]));
  for (const o of images) byFile.set(o.file, o);
  writeFileSync(
    p,
    JSON.stringify(
      { layout, updatedAt: new Date().toISOString(), orders: [...byFile.values()] },
      null,
      2,
    ),
    'utf8',
  );
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
              prompt: {
                type: 'string',
                description: '生图提示词；可用 [图片1] / [图片2] 指代第几张参考图',
              },
              references: {
                type: 'array',
                description:
                  '参考图：直接写文件名 —— 商品照写 uploads/xxx.png，' +
                  '版式目录里的文件写 xxx.png（方舟最多 14 张）',
                items: { type: 'string' },
              },
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
        layout: {
          type: 'string',
          description: '可选：生成到系列里的哪一张；不传用当前 active',
        },
        overwrite: {
          type: 'boolean',
          description: '可选：同名素材已存在时也重新生成（默认跳过）',
        },
      },
    },
    async execute(args, ctx) {
      const requested = typeof args.layout === 'string' ? args.layout.trim() : '';
      const layout = requested || ctx.activeLayout?.trim() || '';
      if (!layout) {
        return { content: 'ERROR: 当前没有打开的版式，也没有传 layout。', isError: true };
      }
      if (!safeLayout(layout)) {
        return { content: `ERROR: 非法版式名：${layout}`, isError: true };
      }
      const workDir = await getWorkDir(config.sessionId);
      const outDir = join(workDir, 'designs', layout);
      const docPath = join(outDir, 'doc.json');
      if (!existsSync(docPath)) {
        return { content: `ERROR: 版式 '${layout}' 不存在（没有 doc.json）。`, isError: true };
      }

      const images = Array.isArray(args.images) ? (args.images as AssetOrders) : [];
      const icons = Array.isArray(args.icons) ? (args.icons as Array<{ file?: unknown; svg?: unknown }>) : [];
      if (!images.length && !icons.length) {
        return { content: 'ERROR: images 和 icons 至少给一个。', isError: true };
      }

      // 入参校验：有问题一张都不生成（避免白花钱 / 写到目录外）
      if (images.length) {
        const problems = validateImageOrders(images);
        if (problems.length) {
          return {
            content: JSON.stringify({ ok: false, layout, errors: problems }),
            isError: true,
          };
        }
        // 订单留底（失败也留着，方便重跑）
        try {
          saveOrdersLedger(outDir, layout, images);
        } catch (e) {
          console.warn(`    ⚠️ 写 assets.json 失败：${e instanceof Error ? e.message : String(e)}`);
        }
      }

      const imageResults: AssetJobResult[] = [];
      if (images.length) {
        try {
          imageResults.push(
            ...(await generateAssets({
              orders: images,
              outDir,
              workDir,
              force: args.overwrite === true,
              signal: ctx.signal,
              onProgress: (p) => ctx.onEvent?.({ kind: 'asset-progress', layout, ...p }),
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
