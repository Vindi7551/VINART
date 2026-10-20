/**
 * `patch_doc` 的**纯函数核心** —— 前后端共用。
 *
 * - 服务端工具 `designharness/tools/patch-doc.ts` 用它校验 + 写盘；
 * - 浏览器 `App.applyDocPatch` 用它把 `doc-patch` 的 patches 应用到**当前内存 doc**，
 *   从而保留用户编辑器里尚未自动保存的改动。
 *
 * ⚠️ 这里**不能** import `node:fs` / `transcript` / server 相关的东西——
 *    它会被 Vite 打进浏览器 bundle。
 */

import type { DesignDocument, ElementNode } from './vocabulary';
import { findElement } from './vocabulary';

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

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** 与 translate 同一口径：保留 2 位小数 */
const r2 = (v: number): number => Math.round(v * 100) / 100;

/**
 * 白名单：
 * - 外观：颜色 / 字体 / 文本 / 换行 / 素材引用
 * - 几何：move（0–1 相对位移）/ size（0–1 目标尺寸）
 * - 变换：rotate（度，仅 image/svg/shape）/ opacity（0–1）
 *
 * ⚠️ 几何值一律是 **0–1 画布比例**，不是 px——AI 不知道画布多大，
 *    换算只在 `applyPatches` 里做（它手里有 doc.canvas）。
 */
const ALLOWED = new Map<string, (v: unknown) => boolean>([
  ['move', (v) => isRecord(v) && isNum(v.dx) && isNum(v.dy)],
  ['size', (v) => isRecord(v) && isNum(v.w) && (v.h === undefined || isNum(v.h))],
  ['rotate', (v) => isNum(v)],
  ['opacity', (v) => isNum(v) && v >= 0 && v <= 1],
  ['fill', (v) => typeof v === 'string' || (Array.isArray(v) && v.every((x) => typeof x === 'string'))],
  ['stroke.paint', (v) => typeof v === 'string' || (Array.isArray(v) && v.every((x) => typeof x === 'string'))],
  ['fontFamily', (v) => typeof v === 'string'],
  ['fontSizePx', (v) => typeof v === 'number' && Number.isFinite(v) && v > 0],
  ['weight', (v) => typeof v === 'number' && Number.isFinite(v)],
  ['italic', (v) => typeof v === 'boolean'],
  ['letterSpacing', (v) => typeof v === 'number' && Number.isFinite(v)],
  ['lineHeight', (v) => typeof v === 'number' && Number.isFinite(v) && v > 0],
  ['wrap', (v) => v === 'normal' || v === 'nowrap'],
  ['asset', (v) => typeof v === 'string' && v.trim().length > 0],
  ['text', (v) => typeof v === 'string'],
]);

export function allowedPatchPaths(): string[] {
  return [...ALLOWED.keys()];
}

/**
 * 纯函数：克隆 doc，逐条应用 patch。**不写盘**。
 * 返回的 doc 只在 errors 为空时才可以落盘 / 应用。
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
      errors.push(`节点 '${id}' 是 group，不支持 patch（请改它的子元素）`);
      continue;
    }

    // ── 几何：0–1 → px 只在这里换算 ──
    if (path === 'move') {
      const { dx, dy } = value as { dx: number; dy: number };
      const W = next.canvas.width;
      const H = next.canvas.height;
      if (node.type === 'text') {
        node.frame = {
          ...node.frame,
          x: r2(node.frame.x + dx * W),
          y: r2(node.frame.y + dy * H),
        };
      } else {
        node.rect = {
          ...node.rect,
          x: r2(node.rect.x + dx * W),
          y: r2(node.rect.y + dy * H),
        };
      }
      applied++;
      continue;
    }

    if (path === 'size') {
      const { w, h } = value as { w: number; h?: number };
      const W = next.canvas.width;
      const H = next.canvas.height;
      if (node.type === 'text') {
        if (h !== undefined) {
          errors.push(`节点 '${id}' 是 text：高度由排版决定，只接受 w`);
          continue;
        }
        if (w <= 0) {
          errors.push(`节点 '${id}' 的 size.w 必须是正数（${w}）`);
          continue;
        }
        node.frame = { ...node.frame, w: r2(w * W) };
      } else {
        if (w <= 0 || h === undefined || h <= 0) {
          errors.push(`节点 '${id}' 是 ${node.type}：size 需要正的 w 和 h`);
          continue;
        }
        node.rect = { ...node.rect, w: r2(w * W), h: r2(h * H) };
      }
      applied++;
      continue;
    }

    if (path === 'rotate') {
      if (node.type === 'text') {
        errors.push(`节点 '${id}' 是 text：第一版只对 image/svg/shape 开放旋转`);
        continue;
      }
      node.transform = { ...(node.transform ?? {}), rotate: value as number };
      applied++;
      continue;
    }

    if (path === 'opacity') {
      node.opacity = value as number;
      applied++;
      continue;
    }

    if (path === 'asset' && node.type !== 'image' && node.type !== 'svg') {
      errors.push(`节点 '${id}' 是 ${node.type}，只有 image/svg 能改 asset`);
      continue;
    }
    if (path === 'text') {
      if (node.type !== 'text') {
        errors.push(`节点 '${id}' 是 ${node.type}，只有 text 能改 text`);
        continue;
      }
      // 纯文本：收成单个 run，保留第一个 run 的样式；允许 ""（清空文字，节点保留）。
      const base = node.runs[0] ?? { text: '' };
      node.runs = [{ ...base, text: value as string }];
      applied++;
      continue;
    }
    if (path === 'wrap') {
      if (node.type !== 'text') {
        errors.push(`节点 '${id}' 是 ${node.type}，只有 text 能改 wrap`);
        continue;
      }
      // 省略 = 默认 normal ⇒ 设成 normal 时删掉字段，别在 doc 里留冗余
      if (value === 'normal') delete node.wrap;
      else node.wrap = 'nowrap';
      applied++;
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
