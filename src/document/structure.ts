/**
 * `edit_structure` 的纯函数核心 —— 增删元素 / 图层、跨层移动、图层排序。
 *
 * 与 `patch.ts` 并列：
 * - `patch.ts` 改已有节点字段；
 * - 本文件改文档树（但**只碰顶层 layers**，不碰 group 内部）。
 *
 * ⚠️ 浏览器与服务端共用：不能 import `node:fs` / transcript / server。
 */

import type { DesignDocument, ElementNode, Layer } from './vocabulary';
import {
  DEFAULT_FONT_FAMILY,
  DEFAULT_PLACEHOLDER_TEXT,
  DEFAULT_SHAPE_FILL,
  DEFAULT_TEXT_FILL,
  DEFAULT_TEXT_FONT_SCALE,
  PLACEHOLDER_ASSET,
  type SketchElement,
} from '../schema/plan';

export type StructureOp =
  | {
      op: 'add-elements';
      layer: string;
      elements: SketchElement[];
      index?: number;
    }
  | {
      op: 'add-layer';
      name?: string;
      elements?: SketchElement[];
      index?: number;
    }
  | { op: 'remove-elements'; ids: string[] }
  | { op: 'remove-layer'; ids: string[]; force?: boolean }
  | { op: 'move-elements'; ids: string[]; toLayer: string; index?: number }
  | { op: 'reorder-layers'; order: string[] };

export interface AddedRef {
  id: string;
  layer: string;
  type: ElementNode['type'] | 'layer';
  name: string;
  asset?: string;
}

export interface RemovedRef {
  id: string;
  type: ElementNode['type'] | 'layer';
  name?: string;
}

export interface StructureResult {
  doc: DesignDocument;
  applied: number;
  errors: string[];
  added: AddedRef[];
  removed: RemovedRef[];
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

function px(v: number, total: number): number {
  return Math.round(v * total * 100) / 100;
}

function collectIds(elements: ElementNode[], out: Set<string>): void {
  for (const e of elements) {
    out.add(e.id);
    if (e.type === 'group') collectIds(e.elements, out);
  }
}

function allIds(doc: DesignDocument): Set<string> {
  const out = new Set<string>();
  for (const l of doc.layers) {
    out.add(l.id);
    collectIds(l.elements, out);
  }
  return out;
}

function nextLayerId(doc: DesignDocument, used: Set<string>): string {
  let n = doc.layers.length + 1;
  while (used.has(`layer-${n}`)) n += 1;
  const id = `layer-${n}`;
  used.add(id);
  return id;
}

function nextElementId(used: Set<string>, layerNumber: number): string {
  let n = 1;
  while (used.has(`el-${layerNumber}-${n}`)) n += 1;
  const id = `el-${layerNumber}-${n}`;
  used.add(id);
  return id;
}

function layerNumber(id: string, index: number): number {
  const m = /^layer-(\d+)$/.exec(id);
  return m ? Number(m[1]) : index + 1;
}

function findLayer(doc: DesignDocument, id: string): Layer | null {
  return doc.layers.find((l) => l.id === id) ?? null;
}

function detachElement(elements: ElementNode[], id: string): ElementNode | null {
  for (let i = 0; i < elements.length; i += 1) {
    const e = elements[i]!;
    if (e.id === id) {
      elements.splice(i, 1);
      return e;
    }
    if (e.type === 'group') {
      const found = detachElement(e.elements, id);
      if (found) return found;
    }
  }
  return null;
}

function detachFromDoc(doc: DesignDocument, id: string): ElementNode | null {
  for (const layer of doc.layers) {
    const found = detachElement(layer.elements, id);
    if (found) return found;
  }
  return null;
}

function invalidIndex(v: unknown): boolean {
  return v !== undefined && (!Number.isInteger(v) || (v as number) < 0);
}

/** SketchElement（0–1）→ 文档节点（px） */
function makeNode(
  raw: unknown,
  id: string,
  canvas: DesignDocument['canvas'],
): { node: ElementNode | null; asset?: string; error?: string } {
  if (!isRecord(raw)) return { node: null, error: `元素 ${id} 不是对象` };
  const el = raw as unknown as SketchElement;
  const name = isStr(el.name) && el.name.trim() ? el.name.trim() : '元素';
  if (!isRecord(el.rect) || !isNum(el.rect.x) || !isNum(el.rect.y) || !isNum(el.rect.w)) {
    return { node: null, error: `元素 ${id} 的 rect 非法` };
  }
  const x = px(el.rect.x, canvas.width);
  const y = px(el.rect.y, canvas.height);
  const w = px(el.rect.w, canvas.width);
  if (w <= 0) return { node: null, error: `元素 ${id} 的 rect.w 必须为正` };

  if (el.type === 'text') {
    const fontScale = isNum(el.fontScale) && el.fontScale > 0 ? el.fontScale : DEFAULT_TEXT_FONT_SCALE;
    return {
      node: {
        id,
        type: 'text',
        name,
        frame: { x, y, w },
        align: el.align ?? 'left',
        ...(el.wrap ? { wrap: el.wrap } : {}),
        fill: DEFAULT_TEXT_FILL,
        fontFamily: DEFAULT_FONT_FAMILY,
        fontSizePx: Math.max(1, Math.round(fontScale * canvas.width)),
        runs: [{ text: (isStr(el.placeholder) ? el.placeholder.trim() : '') || DEFAULT_PLACEHOLDER_TEXT }],
      },
    };
  }

  if (!isRecord(el.rect) || !isNum(el.rect.h) || el.rect.h <= 0) {
    return { node: null, error: `元素 ${id} 的 rect.h 必须为正` };
  }
  const h = px(el.rect.h, canvas.height);

  if (el.type === 'image') {
    const asset = isStr(el.asset) && el.asset.trim() ? el.asset.trim() : PLACEHOLDER_ASSET;
    return {
      node: {
        id,
        type: 'image',
        name,
        rect: { x, y, w, h },
        asset,
        fit: el.fit ?? (asset === PLACEHOLDER_ASSET ? 'contain' : 'cover'),
      },
      ...(asset !== PLACEHOLDER_ASSET ? { asset } : {}),
    };
  }

  if (el.type === 'svg') {
    const asset = isStr(el.asset) && el.asset.trim() ? el.asset.trim() : PLACEHOLDER_ASSET;
    return {
      node: { id, type: 'svg', name, rect: { x, y, w, h }, asset },
      ...(asset !== PLACEHOLDER_ASSET ? { asset } : {}),
    };
  }

  if (el.type === 'shape') {
    if (el.kind !== 'rect' && el.kind !== 'ellipse') {
      return { node: null, error: `元素 ${id} 的 shape.kind 只能是 rect / ellipse` };
    }
    return {
      node: {
        id,
        type: 'shape',
        kind: el.kind,
        name,
        rect: { x, y, w, h },
        fill: DEFAULT_SHAPE_FILL,
      },
    };
  }

  return { node: null, error: `元素 ${id} 的 type 非法` };
}

/**
 * 应用结构操作。全部合法才应对结果写盘；errors 非空时不要用返回的 doc。
 */
export function applyStructure(doc: DesignDocument, ops: unknown): StructureResult {
  const next = structuredClone(doc) as DesignDocument;
  const errors: string[] = [];
  const added: AddedRef[] = [];
  const removed: RemovedRef[] = [];
  let applied = 0;

  if (!Array.isArray(ops)) {
    return { doc: next, applied, errors: ['ops 必须是数组'], added, removed };
  }
  if (ops.length > 50) {
    return { doc: next, applied, errors: ['一次最多 50 条结构操作'], added, removed };
  }

  const used = allIds(next);

  for (const [i, raw] of ops.entries()) {
    if (!isRecord(raw)) {
      errors.push(`ops[${i}] 不是对象`);
      continue;
    }
    const op = raw as unknown as StructureOp;

    if (op.op === 'add-elements') {
      const layer = findLayer(next, op.layer);
      if (!layer) {
        errors.push(`ops[${i}]：找不到图层 '${op.layer}'`);
        continue;
      }
      if (!Array.isArray(op.elements) || op.elements.length === 0) {
        errors.push(`ops[${i}]：elements 必须是非空数组`);
        continue;
      }
      if (invalidIndex(op.index) || op.index! > layer.elements.length) {
        errors.push(`ops[${i}]：index 越界`);
        continue;
      }
      const at = op.index ?? layer.elements.length;
      const layerIndex = next.layers.indexOf(layer);
      const layerNum = layerNumber(layer.id, layerIndex);
      const nodes: ElementNode[] = [];
      let failed = false;
      for (const el of op.elements) {
        const id = nextElementId(used, layerNum);
        const made = makeNode(el, id, next.canvas);
        if (!made.node) {
          errors.push(`ops[${i}]：${made.error ?? '元素非法'}`);
          failed = true;
          break;
        }
        nodes.push(made.node);
        added.push({
          id,
          layer: layer.id,
          type: made.node.type,
          name: made.node.name ?? id,
          ...(made.asset ? { asset: made.asset } : {}),
        });
      }
      if (failed) continue;
      layer.elements.splice(at, 0, ...nodes);
      applied += 1;
      continue;
    }

    if (op.op === 'add-layer') {
      if (invalidIndex(op.index) || op.index! > next.layers.length) {
        errors.push(`ops[${i}]：index 越界`);
        continue;
      }
      const id = nextLayerId(next, used);
      const layer: Layer = { id, name: isStr(op.name) && op.name.trim() ? op.name.trim() : '新图层', elements: [] };
      const at = op.index ?? next.layers.length;
      next.layers.splice(at, 0, layer);
      added.push({ id, layer: id, type: 'layer', name: layer.name ?? id });

      if (op.elements !== undefined) {
        if (!Array.isArray(op.elements)) {
          errors.push(`ops[${i}]：elements 必须是数组`);
          continue;
        }
        const nodes: ElementNode[] = [];
        const layerNum = layerNumber(id, at);
        for (const el of op.elements) {
          const elementId = nextElementId(used, layerNum);
          const made = makeNode(el, elementId, next.canvas);
          if (!made.node) {
            errors.push(`ops[${i}]：${made.error ?? '元素非法'}`);
            break;
          }
          nodes.push(made.node);
          added.push({
            id: elementId,
            layer: id,
            type: made.node.type,
            name: made.node.name ?? elementId,
            ...(made.asset ? { asset: made.asset } : {}),
          });
        }
        layer.elements.push(...nodes);
      }
      applied += 1;
      continue;
    }

    if (op.op === 'remove-elements') {
      if (!Array.isArray(op.ids) || op.ids.length === 0) {
        errors.push(`ops[${i}]：ids 必须是非空数组`);
        continue;
      }
      for (const id of op.ids) {
        const found = detachFromDoc(next, id);
        if (!found) {
          errors.push(`ops[${i}]：找不到元素 '${id}'`);
          continue;
        }
        removed.push({ id, type: found.type, ...(found.name ? { name: found.name } : {}) });
      }
      applied += 1;
      continue;
    }

    if (op.op === 'remove-layer') {
      if (!Array.isArray(op.ids) || op.ids.length === 0) {
        errors.push(`ops[${i}]：ids 必须是非空数组`);
        continue;
      }
      for (const id of op.ids) {
        const idx = next.layers.findIndex((l) => l.id === id);
        if (idx < 0) {
          errors.push(`ops[${i}]：找不到图层 '${id}'`);
          continue;
        }
        const layer = next.layers[idx]!;
        if (layer.elements.length > 0 && op.force !== true) {
          errors.push(`ops[${i}]：图层 '${id}' 非空，需要 force:true 才能删除`);
          continue;
        }
        if (next.layers.length === 1) {
          errors.push(`ops[${i}]：不能删除最后一个图层`);
          continue;
        }
        next.layers.splice(idx, 1);
        removed.push({ id, type: 'layer', ...(layer.name ? { name: layer.name } : {}) });
      }
      applied += 1;
      continue;
    }

    if (op.op === 'move-elements') {
      if (!Array.isArray(op.ids) || op.ids.length === 0) {
        errors.push(`ops[${i}]：ids 必须是非空数组`);
        continue;
      }
      const target = findLayer(next, op.toLayer);
      if (!target) {
        errors.push(`ops[${i}]：找不到目标图层 '${op.toLayer}'`);
        continue;
      }
      if (invalidIndex(op.index) || op.index! > target.elements.length) {
        errors.push(`ops[${i}]：index 越界`);
        continue;
      }
      const nodes: ElementNode[] = [];
      for (const id of op.ids) {
        const found = detachFromDoc(next, id);
        if (!found) {
          errors.push(`ops[${i}]：找不到元素 '${id}'`);
          continue;
        }
        nodes.push(found);
      }
      target.elements.splice(op.index ?? target.elements.length, 0, ...nodes);
      applied += 1;
      continue;
    }

    if (op.op === 'reorder-layers') {
      if (!Array.isArray(op.order) || op.order.length !== next.layers.length) {
        errors.push(`ops[${i}]：order 必须包含全部图层`);
        continue;
      }
      const byId = new Map(next.layers.map((l) => [l.id, l]));
      const seen = new Set<string>();
      const ordered: Layer[] = [];
      let bad = false;
      for (const id of op.order) {
        const l = byId.get(id);
        if (!l || seen.has(id)) {
          errors.push(`ops[${i}]：order 含未知或重复图层 '${id}'`);
          bad = true;
          break;
        }
        seen.add(id);
        ordered.push(l);
      }
      if (bad) continue;
      next.layers.splice(0, next.layers.length, ...ordered);
      applied += 1;
      continue;
    }

    errors.push(`ops[${i}]：未知操作 '${String((raw as { op?: unknown }).op ?? '')}'`);
  }

  return { doc: next, applied, errors, added, removed };
}
