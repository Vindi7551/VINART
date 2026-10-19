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

/** 白名单：颜色/字体 + 文本 + 换行 + 素材引用（image/svg 的 asset 文件名） */
const ALLOWED = new Map<string, (v: unknown) => boolean>([
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
      errors.push(`节点 '${id}' 是 group，不支持颜色/字体 patch`);
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
