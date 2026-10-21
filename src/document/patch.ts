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

/** 与 translate 同一口径：保留 2 位小数 */
const r2 = (v: number): number => Math.round(v * 100) / 100;

/**
 * 白名单：
 * - 外观：颜色 / 圆角 / 阴影 / 混合 / 滤镜 / 背景滤镜 / 裁剪 / 蒙版 / 字体 / 文本 / 富文本 / 换行 / 素材引用
 * - 描边：paint / width / inset / dash / cap / join / over
 * - 文字：对齐 / 字距 / 拉伸 / OpenType / 大小写 / 装饰线 / 基线 / 首字下沉 / 方向 / 沿路径
 * - 几何：move（0–1 相对位移）/ size（0–1 目标尺寸）
 * - 变换：rotate / skewX / skewY / origin（度 / 0–1，仅 image/svg/shape）/ scale（仅 image/shape）
 *
 * ⚠️ 几何值一律是 **0–1 画布比例**，不是 px——AI 不知道画布多大，
 *    换算只在 `applyPatches` 里做（它手里有 doc.canvas）。
 */

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isNonNeg = (v: unknown): v is number => isNum(v) && v >= 0;
const isNumTuple = (v: unknown, n: number): v is number[] =>
  Array.isArray(v) && v.length === n && v.every(isNum);
const isNonNegTuple = (v: unknown, n: number): v is number[] =>
  isNumTuple(v, n) && v.every((x) => x >= 0);
const isStrArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);
const oneOf = (...allowed: readonly string[]) => (v: unknown): boolean =>
  typeof v === 'string' && allowed.includes(v);

const BLEND_MODES = [
  'normal', 'multiply', 'screen', 'overlay',
  'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light',
  'difference', 'exclusion',
  'hue', 'saturation', 'color', 'luminosity',
] as const;
const TEXT_ALIGNS = ['left', 'center', 'right', 'justify'] as const;
const ALIGN_LASTS = ['left', 'center', 'right'] as const;
const TEXT_TRANSFORMS = ['none', 'uppercase', 'lowercase', 'capitalize'] as const;
const WRITING_MODES = ['horizontal', 'vertical'] as const;
const DIRECTIONS = ['ltr', 'rtl'] as const;
const DECORATION_STYLES = ['solid', 'dashed', 'dotted', 'wavy'] as const;
const IMAGE_FITS = ['cover', 'contain', 'fill'] as const;
const IMAGE_RENDERS = ['smooth', 'pixelated'] as const;

/** `shadow`：数组，每层都是可选字段的 record；只校验形状，不替模型补默认值 */
function isShadow(v: unknown): v is unknown[] {
  if (!Array.isArray(v)) return false;
  return v.every((s) => {
    if (!isRecord(s)) return false;
    if (s.offset !== undefined) {
      if (!isRecord(s.offset) || !isNum(s.offset.x) || !isNum(s.offset.y)) return false;
    }
    if (s.blur !== undefined && !isNum(s.blur)) return false;
    if (s.spread !== undefined && !isNum(s.spread)) return false;
    if (s.color !== undefined && !isStr(s.color)) return false;
    if (s.inset !== undefined && !isBool(s.inset)) return false;
    if (s.follow !== undefined && s.follow !== 'box' && s.follow !== 'outline') return false;
    return true;
  });
}

/** 文字装饰线：color / style / thickness 都可选 */
function isDecoration(v: unknown): v is Record<string, unknown> {
  if (!isRecord(v)) return false;
  if (v.color !== undefined && !isStr(v.color)) return false;
  if (v.style !== undefined && !DECORATION_STYLES.includes(v.style as never)) return false;
  if (v.thickness !== undefined && !isNum(v.thickness)) return false;
  return true;
}

/** 可变字体轴：任意轴名 → 数值 */
function isVariations(v: unknown): v is Record<string, number> {
  return isRecord(v) && Object.values(v).every(isNum);
}

/** `runs` 里允许出现的字段（与 `TextRun` 一一对应；多一个都拒，防止脏字段落盘） */
const TEXT_RUN_KEYS = new Set([
  'text', 'fill', 'fontFamily', 'fontSizePx', 'weight', 'italic', 'stretch',
  'underline', 'strike', 'decoration', 'letterSpacing', 'wordSpacing',
  'baselineShift', 'textTransform', 'smallCaps', 'features', 'variations',
]);

function isTextRun(v: unknown): v is Record<string, unknown> {
  if (!isRecord(v) || !isStr(v.text)) return false;
  for (const k of Object.keys(v)) {
    if (!TEXT_RUN_KEYS.has(k)) return false;
  }
  if (v.fill !== undefined && !isStr(v.fill)) return false;
  if (v.fontFamily !== undefined && !isStr(v.fontFamily)) return false;
  if (v.fontSizePx !== undefined && !(isNum(v.fontSizePx) && v.fontSizePx > 0)) return false;
  if (v.weight !== undefined && !isNum(v.weight)) return false;
  if (v.italic !== undefined && !isBool(v.italic)) return false;
  if (v.stretch !== undefined && !(isNum(v.stretch) && v.stretch > 0)) return false;
  if (v.underline !== undefined && !isBool(v.underline)) return false;
  if (v.strike !== undefined && !isBool(v.strike)) return false;
  if (v.decoration !== undefined && !isDecoration(v.decoration)) return false;
  if (v.letterSpacing !== undefined && !isNum(v.letterSpacing)) return false;
  if (v.wordSpacing !== undefined && !isNum(v.wordSpacing)) return false;
  if (v.baselineShift !== undefined && !isNum(v.baselineShift)) return false;
  if (v.textTransform !== undefined && !TEXT_TRANSFORMS.includes(v.textTransform as never)) return false;
  if (v.smallCaps !== undefined && !isBool(v.smallCaps)) return false;
  if (v.features !== undefined && !isStrArray(v.features)) return false;
  if (v.variations !== undefined && !isVariations(v.variations)) return false;
  return true;
}

/** 富文本：至少一段；空数组会让文字节点没有内容载体 */
function isTextRuns(v: unknown): v is unknown[] {
  return Array.isArray(v) && v.length > 0 && v.every(isTextRun);
}

const TEXT_ONLY_PATHS = new Set([
  'text', 'runs', 'wrap', 'align', 'alignLast', 'wordSpacing', 'stretch',
  'features', 'variations', 'textTransform', 'smallCaps',
  'underline', 'strike', 'decoration', 'baselineShift', 'dropCap',
  'writingMode', 'direction', 'curve', 'path',
]);
const IMAGE_ONLY_PATHS = new Set(['fit', 'position', 'render']);

const ALLOWED = new Map<string, (v: unknown) => boolean>([
  ['move', (v) => isRecord(v) && isNum(v.dx) && isNum(v.dy)],
  ['size', (v) => isRecord(v) && isNum(v.w) && (v.h === undefined || isNum(v.h))],
  ['rotate', (v) => isNum(v)],
  ['skewX', (v) => isNum(v)],
  ['skewY', (v) => isNum(v)],
  ['scale', (v) => isRecord(v) && isNum(v.x) && isNum(v.y) && v.x > 0 && v.y > 0],
  ['origin', (v) => isRecord(v) && isNum(v.x) && isNum(v.y) && v.x >= 0 && v.x <= 1 && v.y >= 0 && v.y <= 1],
  ['opacity', (v) => isNum(v) && v >= 0 && v <= 1],
  ['name', isStr],
  ['fill', (v) => typeof v === 'string' || (Array.isArray(v) && v.every((x) => typeof x === 'string'))],
  // ── 外观 ──
  ['radius', (v) => isNonNeg(v) || isNonNegTuple(v, 4)],
  ['shadow', isShadow],
  ['blend', oneOf(...BLEND_MODES)],
  ['filter', isStr],
  ['backdrop', isStr],
  ['clip', isStr],
  ['mask', (v) => isStr(v) || isStrArray(v)],
  // ── 描边 ──
  ['stroke.paint', (v) => typeof v === 'string' || (Array.isArray(v) && v.every((x) => typeof x === 'string'))],
  ['stroke.width', (v) => isNonNeg(v) || isNonNegTuple(v, 4)],
  ['stroke.inset', isBool],
  ['stroke.dash', (v) => isNumTuple(v, 2)],
  ['stroke.cap', oneOf('butt', 'round', 'square')],
  ['stroke.join', oneOf('miter', 'round', 'bevel')],
  ['stroke.over', isBool],
  // ── 图片 ──
  ['fit', oneOf(...IMAGE_FITS)],
  ['position', (v) => isRecord(v) && isNum(v.x) && isNum(v.y) && v.x >= 0 && v.x <= 1 && v.y >= 0 && v.y <= 1],
  ['render', oneOf(...IMAGE_RENDERS)],
  // ── 字体 / 文字 ──
  ['fontFamily', isStr],
  ['fontSizePx', (v) => isNum(v) && v > 0],
  ['weight', isNum],
  ['italic', isBool],
  ['letterSpacing', isNum],
  ['lineHeight', (v) => isNum(v) && v > 0],
  ['wrap', oneOf('normal', 'nowrap')],
  ['align', oneOf(...TEXT_ALIGNS)],
  ['alignLast', oneOf(...ALIGN_LASTS)],
  ['wordSpacing', isNum],
  ['stretch', (v) => isNum(v) && v > 0],
  ['features', isStrArray],
  ['variations', isVariations],
  ['textTransform', oneOf(...TEXT_TRANSFORMS)],
  ['smallCaps', isBool],
  ['underline', isBool],
  ['strike', isBool],
  ['decoration', isDecoration],
  ['baselineShift', isNum],
  ['dropCap', isNonNeg],
  ['writingMode', oneOf(...WRITING_MODES)],
  ['direction', oneOf(...DIRECTIONS)],
  ['curve', isNum],
  ['path', isStr],
  // ── 内容 ──
  ['asset', (v) => typeof v === 'string' && v.trim().length > 0],
  ['text', isStr],
  ['runs', isTextRuns],
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
    if (TEXT_ONLY_PATHS.has(path) && node.type !== 'text') {
      errors.push(`节点 '${id}' 是 ${node.type}：只有 text 能改 ${path}`);
      continue;
    }
    if (IMAGE_ONLY_PATHS.has(path) && node.type !== 'image') {
      errors.push(`节点 '${id}' 是 ${node.type}：只有 image 能改 ${path}`);
      continue;
    }
    const rec = node as unknown as Record<string, unknown>;

    // ── 通用外观 / 文字 / 图片字段：直接落在节点上 ──
    if (path === 'name') {
      // 空名字 = 清掉字段（UI 回退显示 id），别在 doc 里留空串
      if ((value as string).trim()) rec.name = value;
      else delete rec.name;
      applied++;
      continue;
    }
    if (['radius', 'shadow', 'filter', 'backdrop', 'clip', 'mask'].includes(path)) {
      rec[path] = value;
      applied++;
      continue;
    }
    if (path === 'blend') {
      if (value === 'normal') delete rec.blend;
      else rec.blend = value;
      applied++;
      continue;
    }
    if (path.startsWith('stroke.')) {
      const key = path.slice('stroke.'.length);
      const stroke = isRecord(rec.stroke) ? { ...rec.stroke } : {};
      stroke[key] = value;
      rec.stroke = stroke;
      applied++;
      continue;
    }
    if (IMAGE_ONLY_PATHS.has(path)) {
      rec[path] = value;
      applied++;
      continue;
    }
    if (path === 'path') {
      // 空的沿路径数据 = 移除，避免留下 d="" 让 <textPath> 报错
      if ((value as string).trim()) rec.path = value;
      else delete rec.path;
      applied++;
      continue;
    }
    if (
      [
        'align', 'alignLast', 'wordSpacing', 'stretch', 'features', 'variations',
        'textTransform', 'smallCaps', 'underline', 'strike', 'decoration',
        'baselineShift', 'dropCap', 'writingMode', 'direction', 'curve',
      ].includes(path)
    ) {
      rec[path] = value;
      applied++;
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

    if (path === 'skewX' || path === 'skewY' || path === 'origin' || path === 'scale') {
      if (node.type === 'text') {
        errors.push(`节点 '${id}' 是 text：transform 只对 image/svg/shape 开放（文字请改字号/字体）`);
        continue;
      }
      if (path === 'scale' && node.type !== 'image' && node.type !== 'shape') {
        errors.push(`节点 '${id}' 是 ${node.type}：scale 只对 image/shape 开放（矢量请改 rect）`);
        continue;
      }
      // 合并进现有 transform：不覆盖 rotate 等其它字段
      node.transform = { ...(node.transform ?? {}), [path]: value } as typeof node.transform;
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
    if (path === 'runs') {
      // 整段替换：每段样式由调用方给全；至少一段（空文字也允许，但不能 []）
      (node as unknown as { runs: Array<Record<string, unknown>> }).runs = (
        value as Array<Record<string, unknown>>
      ).map((r) => ({ ...r }));
      applied++;
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
    (node as unknown as Record<string, unknown>)[path] = value;
    applied++;
  }

  return { doc: next, applied, errors };
}
