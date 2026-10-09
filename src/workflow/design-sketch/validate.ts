/**
 * ═══════════════════════════════════════════════════════════════════════
 * DesignSketch 校验器
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 三个使用者：
 * ① **编译器**（把创意方案编译成 spec）—— 拦住 LLM 写错的结构
 * ② **人**（手写 spec）—— 尽早发现错误，而不是等渲染出怪东西
 * ③ **渲染前的守卫** —— 见 `scripts/lib/design-renderer.ts` 的内置轻量检查
 *
 * ## ⚠️ 错误信息的写作标准：必须可行动
 *
 * 它的主要消费者是 **LLM**——报错会被原样喂回去当作修改指令。
 * 所以每条都要说清「**哪个节点、哪个字段、错在哪、该改成什么**」。
 *
 * ```
 *   ✗ 节点不合法
 *   ✓ 节点 "card" 的 rect.x = 1.2 超出范围。位置与尺寸一律是 0–1 的画布比例。
 * ```
 *
 * ## 校验的三层
 *
 * | 层 | 查什么 | 例子 |
 * |---|---|---|
 * | **error** | 结构不合法，渲染器会出错或渲染出空的东西 | 缺 `rect`、`type` 不认识、`id` 重复 |
 * | **warn** | 合法但**几乎肯定是笔误** | 未知字段（旧格式残留）、变换后溢出画布 |
 * | 不查 | **设计判断** | 对齐好不好、留白够不够——那是人和 VLM 的事 |
 *
 * ⚠️ **不检查"有没有对齐网格"** —— 网格是**参照，不是约束**，
 * 元素可以故意偏离网格来制造张力。
 */

import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { NODE_TYPES, SHAPES, type DesignSketch, type NodeType } from './design-sketch';
import { APPEARANCE_KEYS, type DesignAppearance } from './design-appearance';

// ══════════════════════════════════════════════════════════════════════
// 结果
// ══════════════════════════════════════════════════════════════════════

export interface SketchIssue {
  level: 'error' | 'warn';
  /** 出问题的位置，如 `layers[3] "card"` 或 `canvas.width` */
  path: string;
  /** 可直接当修改指令用的一句话 */
  message: string;
}

export interface CheckResult {
  ok: boolean;
  issues: SketchIssue[];
  /** 校验通过时的 spec（已断言类型） */
  spec?: DesignSketch;
}

// ══════════════════════════════════════════════════════════════════════
// 规则表
// ══════════════════════════════════════════════════════════════════════

/** 每类节点**独有**的必填字段（`id` / `type` / `rect` 三类都有，另行检查） */
const REQUIRED: Record<NodeType, string[]> = {
  image: ['asset'],
  text: ['text'],
  shape: ['shape'],
};

/** 每类节点**不该**出现的字段——出现说明把两类搞混了 */
const FORBIDDEN: Record<NodeType, string[]> = {
  image: ['text', 'fontScale', 'weight', 'align', 'shape', 'radius'],
  text: ['asset', 'fit', 'shape', 'radius'],
  shape: ['text', 'asset', 'fit', 'fontScale', 'weight', 'align'],
};

/** 节点上**允许出现**的全部字段。不在这张表里的 → 提示"可能是旧格式" */
const KNOWN_FIELDS = new Set([
  'id', 'type', 'rect', 'name', 'transform',
  'text', 'fontScale', 'weight', 'align', // text
  'asset', 'fit', // image
  'shape', 'radius', // shape
]);

/** `transform` 里允许出现的字段 */
const KNOWN_TRANSFORM_FIELDS = new Set(['rotate', 'skewX', 'origin']);

const ALIGN_VALUES = ['left', 'center', 'right'];
const FIT_VALUES = ['cover', 'contain'];

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

// ══════════════════════════════════════════════════════════════════════
// 主入口
// ══════════════════════════════════════════════════════════════════════

export function checkSketch(raw: unknown): CheckResult {
  const issues: SketchIssue[] = [];
  const err = (path: string, message: string) => issues.push({ level: 'error', path, message });
  const warn = (path: string, message: string) => issues.push({ level: 'warn', path, message });

  // ── 顶层 ──
  if (!isObj(raw)) {
    return {
      ok: false,
      issues: [{ level: 'error', path: '(根)', message: '顶层必须是一个 JSON 对象。' }],
    };
  }

  if (typeof raw.name !== 'string' || !raw.name.trim()) {
    err('name', '缺少 name。它是产物目录名，必须是英文/数字/连字符，如 "PT10"。');
  } else if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(raw.name)) {
    err('name', `name = "${raw.name}" 含非法字符。只能用英文、数字、点、下划线、连字符。`);
  }
  if (raw.title !== undefined && typeof raw.title !== 'string') {
    err('title', 'title 必须是字符串（人读标题，写进溯源注释）。');
  }
  if (raw.description !== undefined && typeof raw.description !== 'string') {
    err('description', 'description 必须是字符串（人读说明）。');
  }

  const canvas = raw.canvas;
  let cv: { width: number; height: number } | null = null;
  if (!isObj(canvas) || !isNum(canvas.width) || !isNum(canvas.height)) {
    err('canvas', '缺少 canvas，或 width/height 不是数字。例：{ "width": 2000, "height": 2000 }');
  } else if (canvas.width <= 0 || canvas.height <= 0) {
    err('canvas', `canvas 尺寸必须为正数，当前是 ${canvas.width}×${canvas.height}。`);
  } else {
    cv = { width: canvas.width, height: canvas.height };
  }

  if (!Array.isArray(raw.layers)) {
    err('layers', '缺少 layers 数组。它是这份版式的全部节点，**数组顺序即叠放顺序**（先写的在下面）。');
    return { ok: false, issues };
  }
  if (raw.layers.length === 0) {
    err('layers', 'layers 是空的——一份版式至少要有一个节点。');
  }

  // ── 节点 ──
  const seenIds = new Set<string>();
  raw.layers.forEach((n, i) => checkNode(n, `layers[${i}]`, seenIds, cv, err, warn));

  const hasError = issues.some((x) => x.level === 'error');
  return { ok: !hasError, issues, spec: hasError ? undefined : (raw as unknown as DesignSketch) };
}

// ══════════════════════════════════════════════════════════════════════
// 单个节点
// ══════════════════════════════════════════════════════════════════════

function checkNode(
  raw: unknown,
  path: string,
  seenIds: Set<string>,
  canvas: { width: number; height: number } | null,
  err: (p: string, m: string) => void,
  warn: (p: string, m: string) => void,
): void {
  if (!isObj(raw)) {
    err(path, '节点必须是一个对象。');
    return;
  }

  // type —— 先查它，后面才知道用哪套规则
  const t = raw.type;
  if (typeof t !== 'string' || !(NODE_TYPES as readonly string[]).includes(t)) {
    err(
      `${path}.type`,
      `type = ${JSON.stringify(t)} 不是合法节点类型。可用值只有三个：` +
        `${NODE_TYPES.join(' / ')}（图 / 文字 / 形状）。`,
    );
    return;
  }
  const type = t as NodeType;
  const at = `${path} "${String(raw.id ?? '?')}" (${type})`;

  // id
  if (typeof raw.id !== 'string' || !raw.id.trim()) {
    err(at, '缺少 id。每个节点都要有唯一 id（它落成 HTML 的 data-layer，拆层与文字自适应都靠它）。');
  } else if (seenIds.has(raw.id)) {
    err(at, `id "${raw.id}" 重复。id 必须全局唯一。`);
  } else {
    seenIds.add(raw.id);
  }

  // rect —— 唯一的位置与尺寸表达
  checkRect(raw.rect, at, err, warn);

  // transform —— 视觉变换（可选）
  checkTransform(raw.transform, at, err, warn);

  // 类特有必填
  for (const field of REQUIRED[type]) {
    if (raw[field] === undefined) {
      err(at, `缺少必填字段 ${field}。type="${type}" 需要它。`);
    }
  }

  // ── 类特有的值检查 ──
  if (type === 'text' && raw.text !== undefined) {
    const txt = raw.text;
    const okText =
      typeof txt === 'string' ||
      (Array.isArray(txt) && txt.length > 0 && txt.every((l) => typeof l === 'string'));
    if (!okText) {
      err(
        `${at}.text`,
        'text 必须是字符串（一行）或非空字符串数组（多行），如 "NOIR 07" 或 ["第一行","第二行"]。',
      );
    }
  }
  if (type === 'image' && raw.asset !== undefined) {
    if (typeof raw.asset !== 'string' || !raw.asset.trim()) {
      err(`${at}.asset`, 'asset 必须是非空字符串（素材文件名，如 "bottle.png"）。');
    }
  }
  if (type === 'shape' && raw.shape !== undefined) {
    if (!(SHAPES as readonly string[]).includes(raw.shape as string)) {
      err(
        `${at}.shape`,
        `shape = ${JSON.stringify(raw.shape)} 不是合法形状。可用值：${SHAPES.join(' / ')}。` +
          `（想要斜切？用 shape:"rect" + transform.skewX；想要朝向？用 transform.rotate。）`,
      );
    }
  }

  // ── 公共字段的值检查 ──
  if (raw.fontScale !== undefined) {
    const v = raw.fontScale;
    if (!isNum(v) || v <= 0 || v > 1) {
      err(
        `${at}.fontScale`,
        `fontScale = ${JSON.stringify(v)} 不合法。它是**相对画布宽度**的字号比例：` +
          '主标题约 0.045–0.055、副标题 0.024–0.030、脚注 0.014–0.019。',
      );
    }
  }
  if (raw.weight !== undefined && (!isNum(raw.weight) || raw.weight < 100 || raw.weight > 900)) {
    err(
      `${at}.weight`,
      `weight 应是 100–900 的数字（如 400 / 700 / 900），当前是 ${JSON.stringify(raw.weight)}。`,
    );
  }
  if (raw.align !== undefined && !ALIGN_VALUES.includes(raw.align as string)) {
    err(`${at}.align`, `align 只能填 ${ALIGN_VALUES.join(' / ')}，当前是 ${JSON.stringify(raw.align)}。`);
  }
  if (raw.fit !== undefined && !FIT_VALUES.includes(raw.fit as string)) {
    err(`${at}.fit`, `fit 只能填 ${FIT_VALUES.join(' / ')}，当前是 ${JSON.stringify(raw.fit)}。`);
  }
  if (raw.radius !== undefined) {
    const v = raw.radius;
    if (!isNum(v) || v < 0 || v > 0.5) {
      err(
        `${at}.radius`,
        `radius = ${JSON.stringify(v)} 不合法。它是**相对框短边**的比例，范围 0–0.5` +
          '（0 = 直角；0.5 就已经是完全的胶囊了，再大没有额外效果）。',
      );
    }
  }

  // 混用检查
  for (const field of FORBIDDEN[type]) {
    if (raw[field] !== undefined) {
      err(
        `${at}.${field}`,
        `type="${type}" 不该有 ${field} —— 那是别的节点类型的字段，两类的职责不要混。`,
      );
    }
  }

  // 不属于本契约的字段
  for (const k of Object.keys(raw)) {
    if ((APPEARANCE_KEYS as readonly string[]).includes(k)) {
      err(
        `${at}.${k}`,
        `${k} 是**颜色 / 描边**，属于「外观」，不写在这里。` +
          `请挪到同目录 design-appearance.json 的 layers["${String(raw.id ?? '?')}"] 下。`,
      );
    } else if (!KNOWN_FIELDS.has(k)) {
      warn(
        `${at}.${k}`,
        `"${k}" 不是当前契约的字段（可能是旧格式或自行发明的）。` +
          `契约只认：${[...KNOWN_FIELDS].join(' · ')}。若是效果 / 光影类，它归生图提示词。`,
      );
    }
  }

  // 变换后溢出画布
  if (canvas && isObj(raw.rect) && isObj(raw.transform)) {
    warnIfOverflow(
      raw.rect as unknown as { x: number; y: number; w: number; h: number },
      raw.transform as unknown as TransformLike,
      canvas.width,
      canvas.height,
      at,
      warn,
    );
  }
}

// ══════════════════════════════════════════════════════════════════════
// 位置与尺寸
// ══════════════════════════════════════════════════════════════════════

function checkRect(
  f: unknown,
  at: string,
  err: (p: string, m: string) => void,
  warn: (p: string, m: string) => void,
): void {
  if (f === undefined) {
    err(
      at,
      '缺少 rect。位置与尺寸一律写在 rect 里：{ "x": 0.1, "y": 0.2, "w": 0.5, "h": 0.3 }' +
        '（0–1 画布比例）。',
    );
    return;
  }
  if (!isObj(f)) {
    err(`${at}.rect`, `rect 必须是对象，当前是 ${JSON.stringify(f)}。`);
    return;
  }
  for (const k of ['x', 'y', 'w', 'h'] as const) {
    const v = f[k];
    if (!isNum(v)) {
      err(`${at}.rect.${k}`, `rect.${k} 必须是数字，当前是 ${JSON.stringify(v)}。`);
    } else if (v < 0 || v > 1) {
      err(
        `${at}.rect.${k}`,
        `rect.${k} = ${v} 超出范围。位置与尺寸一律是 **0–1 的画布比例**` +
          `（0.5 = 一半，1 = 铺满），不是像素。`,
      );
    }
  }
  if (isNum(f.w) && isNum(f.h) && (f.w === 0 || f.h === 0)) {
    warn(at, `rect 的 w/h 有一个是 0 —— 这个节点在画面上没有面积，是不是写错了？`);
  }
}

// ══════════════════════════════════════════════════════════════════════
// 视觉变换
// ══════════════════════════════════════════════════════════════════════

interface TransformLike {
  rotate?: unknown;
  skewX?: unknown;
  origin?: unknown;
}

function checkTransform(
  t: unknown,
  at: string,
  err: (p: string, m: string) => void,
  warn: (p: string, m: string) => void,
): void {
  if (t === undefined) return;

  if (!isObj(t)) {
    err(`${at}.transform`, `transform 必须是对象，如 { "rotate": -22 }。当前是 ${JSON.stringify(t)}。`);
    return;
  }

  // 「至少得有一个真变换」—— 这条不用类型系统管，因为报错要说人话
  const hasReal = isNum(t.rotate) || isNum(t.skewX);
  if (Object.keys(t).length === 0) {
    err(
      `${at}.transform`,
      'transform 是空的。至少要给一个变换（`rotate` 旋转 或 `skewX` 斜切）——' +
        '什么都不做的话，整个 transform 删掉即可。',
    );
  } else if (!hasReal) {
    err(
      `${at}.transform`,
      'transform 里没有真正的变换。`origin` 是 rotate / skewX 的**支点**，' +
        '单独出现没有意义——要么补上 `rotate` 或 `skewX`，要么删掉整个 transform。',
    );
  }

  if (t.rotate !== undefined && !isNum(t.rotate)) {
    err(
      `${at}.transform.rotate`,
      `rotate 必须是数字（角度，**顺时针为正**，如 -22），当前是 ${JSON.stringify(t.rotate)}。`,
    );
  }
  if (t.skewX !== undefined && !isNum(t.skewX)) {
    err(
      `${at}.transform.skewX`,
      `skewX 必须是数字（顶边相对底边水平偏移的比例，如 0.15 = 向右错开 15%），` +
        `当前是 ${JSON.stringify(t.skewX)}。`,
    );
  }
  if (t.origin !== undefined) {
    const o = t.origin;
    if (!isObj(o)) {
      err(
        `${at}.transform.origin`,
        `origin 必须是对象 { x, y }（相对 rect 自身的 0–1 坐标），当前是 ${JSON.stringify(o)}。`,
      );
    } else {
      for (const k of ['x', 'y'] as const) {
        const v = o[k];
        if (!isNum(v)) {
          err(`${at}.transform.origin.${k}`, `origin.${k} 必须是数字，当前是 ${JSON.stringify(v)}。`);
        } else if (v < 0 || v > 1) {
          err(
            `${at}.transform.origin.${k}`,
            `origin.${k} = ${v} 超出范围。它是**相对 rect 自身**的 0–1 坐标` +
              `（0.5 0.5 = 中心）。`,
          );
        }
      }
    }
  }

  for (const k of Object.keys(t)) {
    if (!KNOWN_TRANSFORM_FIELDS.has(k)) {
      warn(
        `${at}.transform.${k}`,
        `"${k}" 不是变换字段。transform 只认：${[...KNOWN_TRANSFORM_FIELDS].join(' · ')}。` +
          `（缩放 / 镜像等以后再加。）`,
      );
    }
  }
}

// ══════════════════════════════════════════════════════════════════════
// 变换后是否溢出画布
// ══════════════════════════════════════════════════════════════════════

/**
 * 算出「斜切 + 旋转」后的包围盒，超出画布就给个提示。
 *
 * ⚠️ 必须在**像素空间**里算：画布非正方形时，直接在 0–1 比例空间变换会算错
 * （0.1 的横向与 0.1 的纵向对应不同像素数）。
 *
 * 变换顺序与 CSS 的 `transform: rotate() skewX()` 一致：**先斜切，后旋转**。
 *
 * 纯几何计算，很便宜——所以每次校验都跑。
 */
function warnIfOverflow(
  rect: { x: number; y: number; w: number; h: number },
  t: TransformLike,
  canvasW: number,
  canvasH: number,
  at: string,
  warn: (p: string, m: string) => void,
): void {
  if (!isNum(rect.x) || !isNum(rect.y) || !isNum(rect.w) || !isNum(rect.h)) return;

  const k = isNum(t.skewX) ? t.skewX : 0;
  const deg = isNum(t.rotate) ? t.rotate : 0;
  if (k === 0 && deg === 0) return;

  const origin = isObj(t.origin) && isNum(t.origin.x) && isNum(t.origin.y)
    ? { x: t.origin.x, y: t.origin.y }
    : { x: 0.5, y: 0.5 };

  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  // 支点（画布比例）
  const ox = rect.x + origin.x * rect.w;
  const oy = rect.y + origin.y * rect.h;

  // 斜切斜率：每单位 y 的 x 偏移。
  // `skewX = k` 的语义是「顶边相对底边偏移 k 倍的框宽」，而顶底相距一个框高 →
  // 每像素 y 的 x 偏移 = (k × 框宽px) / 框高px
  const wPx = rect.w * canvasW;
  const hPx = rect.h * canvasH;
  const slant = hPx === 0 ? 0 : (k * wPx) / hPx;

  const corners: [number, number][] = [
    [rect.x, rect.y],
    [rect.x + rect.w, rect.y],
    [rect.x + rect.w, rect.y + rect.h],
    [rect.x, rect.y + rect.h],
  ];

  const pts = corners.map(([cx, cy]) => {
    const dx = (cx - ox) * canvasW;
    const dy = (cy - oy) * canvasH;
    // 1) 斜切：x 随 y 偏移
    const sx = dx + slant * dy;
    // 2) 旋转
    const rx = sx * cos - dy * sin;
    const ry = sx * sin + dy * cos;
    return [ox + rx / canvasW, oy + ry / canvasH] as [number, number];
  });

  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);

  if (x0 < -0.001 || y0 < -0.001 || x1 > 1.001 || y1 > 1.001) {
    const what = [deg !== 0 ? `旋转 ${deg}°` : '', k !== 0 ? `斜切 ${k}` : '']
      .filter(Boolean)
      .join(' + ');
    warn(
      at,
      `${what} 之后这个节点会**超出画布**` +
        `（变换后占 x ${x0.toFixed(3)}–${x1.toFixed(3)}，y ${y0.toFixed(3)}–${y1.toFixed(3)}）。` +
        `不是故意出血的话，把 rect 往里收一点，或减小角度 / 斜度。`,
    );
  }
}

// ══════════════════════════════════════════════════════════════════════
// 外观文件
// ══════════════════════════════════════════════════════════════════════

/**
 * 校验收一份 `design-appearance.json`。
 *
 * 最重要的检查：**配色 / 排版方案必须真实存在**。
 * 实测：模型编造过 `cold-dusk` / `noir-amber` / `sans-helvetica` 这类名字，
 * 渲染器只会打一行 warning 然后用兜底方案——**观感悄悄跑偏**。
 *
 * 反向也查：外观文件里不该出现位置 / 尺寸 / 字号（那是版式的活）。
 */
export function checkAppearance(raw: unknown): CheckResult {
  const issues: SketchIssue[] = [];
  const err = (path: string, message: string) => issues.push({ level: 'error', path, message });

  if (!isObj(raw)) {
    return {
      ok: false,
      issues: [
        { level: 'error', path: '(根)', message: '外观文件必须是一个 JSON 对象（没有任何外观就写 {}）。' },
      ],
    };
  }

  checkAssetRef('palette', raw.palette, 'designassets/elements/palette', '配色方案', err);
  checkAssetRef('fontScheme', raw.fontScheme, 'designassets/fonts/schemes', '排版方案', err);

  const layers = raw.layers;
  if (layers !== undefined) {
    if (!isObj(layers)) {
      err('layers', '外观的 layers 必须是对象：{ "<节点id>": { …外观字段 } }。');
    } else {
      for (const [id, patch] of Object.entries(layers)) {
        if (!isObj(patch)) {
          err(`layers["${id}"]`, '每个节点的外观必须是对象，如 { "fill": "#FFFFFF" }。');
          continue;
        }
        for (const k of Object.keys(patch)) {
          if (!(APPEARANCE_KEYS as readonly string[]).includes(k)) {
            err(
              `layers["${id}"].${k}`,
              `"${k}" 不是外观字段。外观只接受：${APPEARANCE_KEYS.join(' / ')}。` +
                '（位置、尺寸、字号、形状属于版式，写 design-sketch.json。）',
            );
          }
        }
      }
    }
  }

  return { ok: issues.every((x) => x.level !== 'error'), issues };
}

/**
 * 跨文件引用检查：appearance.layers 的每个 id 必须能在 spec 里找到。
 *
 * 这是「配色静默失效」的正面堵截：applyAppearance 按 id 匹配，匹配不上
 * **不报错也不警告**，该层直接走兜底色。典型成因：图层改名 / 删除后
 * spec 覆写了，appearance 没跟着改——等到人眼发现「编译的配色没生效」，
 * 中间已经隔了好几张图。
 *
 * 级别是 **warn** 不是 error：失配不破坏渲染（其余层照常上色），
 * 但每个调用方都必须把这条带出来——静默才是要消灭的东西。
 */
export function checkAppearanceRefs(
  spec: DesignSketch,
  appearance: DesignAppearance,
): SketchIssue[] {
  const ids = new Set<string>();
  const walk = (layers: unknown): void => {
    if (!Array.isArray(layers)) return;
    for (const l of layers) {
      if (!isObj(l)) continue;
      if (typeof l.id === 'string') ids.add(l.id);
      walk(l.children); // 防御性：契约暂无 children，将来加了也不漏
    }
  };
  walk((spec as { layers?: unknown }).layers);

  const issues: SketchIssue[] = [];
  for (const id of Object.keys(appearance.layers ?? {})) {
    if (ids.has(id)) continue;
    issues.push({
      level: 'warn',
      path: `layers["${id}"]`,
      message:
        `appearance 为 "${id}" 写的外观在 spec 里没有同 id 图层，渲染时会被**静默跳过**，` +
        `该层走兜底色。通常是图层改名 / 删除后 appearance 没跟上：` +
        `改成 spec 里的现有 id（${[...ids].join(' / ') || '（spec 没有任何图层）'}），` +
        `或从 appearance.layers 删掉这条（重编配色也会清理）。`,
    });
  }
  return issues;
}

// ══════════════════════════════════════════════════════════════════════
// 资产引用
// ══════════════════════════════════════════════════════════════════════

/** 列出某个资产目录下的可用名（报错时直接告诉模型该填什么）*/
function availableNames(dir: string): string {
  try {
    return readdirSync(resolve(dir))
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''))
      .join(' / ');
  } catch {
    return '（读不到目录）';
  }
}

function checkAssetRef(
  path: string,
  value: unknown,
  dir: string,
  what: string,
  err: (p: string, m: string) => void,
): void {
  if (value === undefined) return;
  if (typeof value !== 'string' || !value) {
    err(path, `${what}必须是非空字符串（方案名），当前是 ${JSON.stringify(value)}。`);
    return;
  }
  if (!existsSync(resolve(dir, `${value}.json`))) {
    err(
      path,
      `${what} "${value}" 不存在。**可用值：${availableNames(dir)}**。省略该字段就用默认方案，不要编造名字。`,
    );
  }
}
