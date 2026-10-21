/**
 * `src/editor/gesture-math.ts` 与 `hit-test.ts` 的纯函数单测。
 *
 * 这两支是整条编辑器链路里**唯一能脱离浏览器验证**的部分，
 * 所以断言写细一点：几何口径错一次，就会以"拖拽/缩放不对劲"的形式
 * 在真实 app 里冒出来，且很难看出是哪一步错。
 *
 * ⚠️ 本文件原先把 `geometry.ts` 当被测对象 —— 那个文件已经不存在了
 * （里面的函数搬进了 `gesture-math.ts` / `points.ts`）。路径不改就会
 * **整个文件加载失败**（vitest 报 `Cannot find module`，而且 0 测试通过并不显眼）。
 * ⚠️ 它能烂掉这么久没被发现，是因为 `tsconfig.json` 的 `include` 里**没有 `test/`**
 * ⇒ `tsc` 不检查它。（现在已把 `test` 加进 include。）
 *
 * 运行：npm test
 */

import { describe, expect, it } from 'vitest';

import {
  MIN_SIZE,
  angleAt,
  boxCenter,
  boxInsideCanvas,
  cornerPoints,
  localToScreen,
  moveBox,
  resizeBox,
  rotateDegrees,
  screenDeltaToLocal,
  screenToLocal,
} from '../src/editor/gesture-math';
import { hitDecoration, hitLayer, hitTest } from '../src/editor/hit-test';
import type { LayerDom } from '../src/editor/types';

// 真实产物的量：POSTER01，1440×2160，fit 之后 zoom = 0.3005
const CANVAS = { width: 1440, height: 2160 };
const VP = { originX: 230, originY: 187, zoom: 0.30046293470594625 };

// ══════════════════════════════════════════════════════════════════════
// 坐标换算
// ══════════════════════════════════════════════════════════════════════

describe('screenToLocal —— 全局唯一的 /zoom', () => {
  it('把页面坐标折到画布 local（用实测的 se 柄坐标对账）', () => {
    // 探针实测：se 柄中心在页面 (657.56, 615.16)，子文档里是 local (1423, 1425)
    const p = screenToLocal(657.5587560865615, 615.1596819559734, VP);
    expect(p.x).toBeCloseTo(1423, 1);
    expect(p.y).toBeCloseTo(1425, 1);
  });

  it('zoom 翻倍 ⇒ local 位移减半（除以 zoom 只发生一次）', () => {
    const a = screenToLocal(VP.originX + 100, VP.originY + 100, VP);
    const b = screenToLocal(VP.originX + 100, VP.originY + 100, { ...VP, zoom: VP.zoom * 2 });
    expect(b.x).toBeCloseTo(a.x / 2, 9);
    expect(b.y).toBeCloseTo(a.y / 2, 9);
  });

  it('localToScreen 是它的逆', () => {
    const s = localToScreen({ x: 1423, y: 1425 }, VP);
    expect(s.x).toBeCloseTo(657.5588, 3);
    expect(s.y).toBeCloseTo(615.1597, 3);
  });

  it('screenDeltaToLocal 与两端相减等价', () => {
    const d = screenDeltaToLocal(40, -12, VP);
    const a = screenToLocal(VP.originX, VP.originY, VP);
    const b = screenToLocal(VP.originX + 40, VP.originY - 12, VP);
    expect(d.x).toBeCloseTo(b.x - a.x, 9);
    expect(d.y).toBeCloseTo(b.y - a.y, 9);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 比例 ↔ local px
// ══════════════════════════════════════════════════════════════════════

/**
 * ⚠️ 这里原本是 `rect ↔ localBox` 的换算测试（`rectToLocalBox` / `localBoxToRect`）。
 *
 * 那两个函数**已经删掉了** —— `rect` 的单位从"0–1 比例"改成**画布 px** 之后，
 * 它们变成恒等函数（`{x,y,w,h}` ⇄ `{left,top,width,height}` 只是改字段名），
 * 留着反而让人以为还有一层换算。
 *
 * ⇒ 这条换算**不再存在**，所以原来那两条断言（"0.1542 → left 222.048"、
 *    "往返一致"）已经没有被测对象了。换成守住**新契约**的断言：
 *    盒子与 `rect` 必须**逐字段同值**，不许再出现任何乘除。
 */
describe('rect 就是画布 px（不许再有任何"比例 → px"换算）', () => {
  it('文档里的 rect 可以直接当盒子用（逐字段同值）', () => {
    // 这是新契约的核心：rect 的 4 个数 == LocalBox 的 4 个数
    const rect = { x: 222, y: 1235, w: 1201, h: 190 };
    const asBox = { left: rect.x, top: rect.y, width: rect.w, height: rect.h };
    expect(asBox).toEqual({ left: 222, top: 1235, width: 1201, height: 190 });
  });

  it('换算函数已不存在（编辑器不该再有那对 API）', async () => {
    const gm = (await import('../src/editor/gesture-math')) as Record<string, unknown>;
    expect(gm.rectToLocalBox).toBeUndefined();
    expect(gm.localBoxToRect).toBeUndefined();
  });
});

describe('corner / center', () => {
  const box = { left: 222, top: 1235, width: 1201, height: 190 };

  it('四角点', () => {
    expect(cornerPoints(box)).toEqual({
      nw: { x: 222, y: 1235 },
      ne: { x: 1423, y: 1235 },
      sw: { x: 222, y: 1425 },
      se: { x: 1423, y: 1425 },
    });
  });

  it('se 柄正好压在右下角（实测 local 1423 / 1425）', () => {
    expect(cornerPoints(box).se).toEqual({ x: 1423, y: 1425 });
  });

  it('中心', () => {
    expect(boxCenter(box)).toEqual({ x: 822.5, y: 1330 });   // 222 + 1201/2
  });
});

// ══════════════════════════════════════════════════════════════════════
// 移动
// ══════════════════════════════════════════════════════════════════════

describe('moveBox', () => {
  const start = { left: 222, top: 1235, width: 1201, height: 190 };

  it('位移 = 指针 local 位移（与 zoom 无关）', () => {
    const box = moveBox(start, { x: 800, y: 1300 }, { x: 667, y: 1300 });
    expect(box.left).toBeCloseTo(89, 6);
    expect(box.top).toBeCloseTo(1235, 6);
    expect(box.width).toBe(1201);
  });

  it('同一 local 位移在任意 zoom 下都得到同一个盒子（没有 /zoom 二次缩放）', () => {
    // 用 screenToLocal 各自算：40 屏幕 px 在 zoom 0.3 / 1 / 2 下的 local 位移
    const zooms = [0.3, 1, 2];
    const boxes = zooms.map((z) => {
      const vp = { ...VP, zoom: z };
      const a = screenToLocal(vp.originX, vp.originY, vp);
      const b = screenToLocal(vp.originX + 40, vp.originY, vp);
      return moveBox(start, a, b);
    });
    // 三者的位移量应当各随 zoom 变化（40/z，方向跟随指针），这就是"跟手"
    expect(boxes[0].left - start.left).toBeCloseTo(40 / 0.3, 3);
    expect(boxes[1].left - start.left).toBeCloseTo(40, 3);
    expect(boxes[2].left - start.left).toBeCloseTo(40 / 2, 3);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 缩放
// ══════════════════════════════════════════════════════════════════════

describe('resizeBox', () => {
  const start = { left: 222, top: 1235, width: 1201, height: 190 };
  const O = { x: 0, y: 0 };

  it('se 只吃 Δx：纯横向拖不动高度', () => {
    const box = resizeBox(start, 'se', O, { x: 133.13, y: 0 });
    expect(box.width).toBeCloseTo(1334.13, 3);
    expect(box.height).toBe(190);
    expect(box.left).toBe(222);
    expect(box.top).toBe(1235);
  });

  it('se 吃 Δy：纯纵向拖不动宽度', () => {
    const box = resizeBox(start, 'se', O, { x: 0, y: 50 });
    expect(box.width).toBe(1201);
    expect(box.height).toBe(240);
  });

  it('⚠️ 口径：resize 的位移只和 Δx 有关，与"二维距离"无关', () => {
    // 同样 Δx=100，附带一个大 Δy，宽度变化必须一模一样
    const a = resizeBox(start, 'se', O, { x: 100, y: 0 });
    const b = resizeBox(start, 'se', O, { x: 100, y: 999 });
    expect(b.width).toBe(a.width);
  });

  it('nw 推回 left/top，对角固定', () => {
    const box = resizeBox(start, 'nw', O, { x: 100, y: 40 });
    expect(box.width).toBe(1101);
    expect(box.height).toBe(150);
    expect(box.left).toBe(322);          // 222 + (1201-1101)
    expect(box.top).toBe(1275);          // 1235 + (190-150)
    expect(box.left + box.width).toBe(1423);   // 右下角没动
    expect(box.top + box.height).toBe(1425);
  });

  it('ne：右边扩、顶边提，left 不动', () => {
    const box = resizeBox(start, 'ne', O, { x: 10, y: 10 });
    expect(box.left).toBe(222);
    expect(box.width).toBe(1211);
    expect(box.top).toBe(1245);
    expect(box.height).toBe(180);
  });

  it('最小尺寸兜底 24', () => {
    const box = resizeBox(start, 'se', O, { x: -9999, y: -9999 });
    expect(box.width).toBe(MIN_SIZE);
    expect(box.height).toBe(MIN_SIZE);
  });

  it('Shift 锁比：se 缩宽时高按起始比例跟', () => {
    const box = resizeBox(start, 'se', O, { x: 100, y: 0 }, { ratioLock: true });
    const ratio = start.height / start.width;
    expect(box.width).toBe(1301);
    expect(box.height).toBeCloseTo(1301 * ratio, 6);
  });

  it('Shift 锁比 + nw：对角仍然固定', () => {
    const box = resizeBox(start, 'nw', O, { x: 100, y: 0 }, { ratioLock: true });
    expect(box.left + box.width).toBe(1423);
    expect(box.top + box.height).toBe(1425);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 旋转
// ══════════════════════════════════════════════════════════════════════

describe('rotateDegrees', () => {
  const center = { x: 100, y: 100 };

  it('angleAt：右 = 0°，下 = 90°（与 CSS rotate 同向，顺时针为正）', () => {
    expect(angleAt(center, { x: 200, y: 100 })).toBeCloseTo(0, 6);
    expect(angleAt(center, { x: 100, y: 200 })).toBeCloseTo(90, 6);
    expect(angleAt(center, { x: 100, y: 0 })).toBeCloseTo(-90, 6);
  });

  it('从 0° 起始角拖到 90° 位置 ⇒ 转 90°', () => {
    const deg = rotateDegrees({ center, angle0: 0, rotate0: 0 }, { x: 100, y: 200 });
    expect(deg).toBeCloseTo(90, 6);
  });

  it('叠加起始角（已经是 30° 时再拖 90° ⇒ 120°）', () => {
    const deg = rotateDegrees({ center, angle0: 0, rotate0: 30 }, { x: 100, y: 200 });
    expect(deg).toBeCloseTo(120, 6);
  });

  it('保留 1 位小数（与旧实现同精度）', () => {
    const deg = rotateDegrees({ center, angle0: 0, rotate0: 0 }, { x: 100, y: 200.0001 });
    expect(deg).toBe(Math.round(deg * 10) / 10);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 越界判定
// ══════════════════════════════════════════════════════════════════════

describe('boxInsideCanvas', () => {
  it('右下角出画布 = 不在画布内（这正是 se 柄够不着的原因）', () => {
    // 第 2 组向右拖之后：left 322 + width 1334 = 1656 > 1440
    expect(boxInsideCanvas({ left: 322, top: 1235, width: 1334, height: 190 }, CANVAS)).toBe(false);
  });
  it('完整在内', () => {
    expect(boxInsideCanvas({ left: 89, top: 1235, width: 1201, height: 190 }, CANVAS)).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 命中测试（用最小假对象，不需要浏览器）
// ══════════════════════════════════════════════════════════════════════

/** 只实现 `closest` / `getAttribute` 的假元素 */
function fakeEl(attrs: Record<string, string>, closestTo: Element | null = null): Element {
  return {
    closest: () => closestTo,
    getAttribute: (k: string) => (k in attrs ? attrs[k] : null),
  } as unknown as Element;
}

function fakeDom(fromPoint: Element | null): LayerDom {
  return {
    querySelector: () => null,
    querySelectorAll: () => [] as unknown as ArrayLike<Element>,
    elementFromPoint: () => fromPoint,
  };
}

describe('hitDecoration（第 1 段：装饰件优先）', () => {
  it('旋转柄', () => {
    const el = fakeEl({ 'data-ve-rot': '1' }, fakeEl({ 'data-ve-rot': '1' }));
    expect(hitDecoration(el)).toEqual({ kind: 'rotate' });
  });

  it('四角手柄', () => {
    for (const dir of ['nw', 'ne', 'sw', 'se'] as const) {
      const el = fakeEl({ 'data-ve-handle': dir }, fakeEl({ 'data-ve-handle': dir }));
      expect(hitDecoration(el)).toEqual({ kind: 'handle', dir });
    }
  });

  it('普通元素 = empty', () => {
    expect(hitDecoration(fakeEl({}, null))).toEqual({ kind: 'empty' });
    expect(hitDecoration(null)).toEqual({ kind: 'empty' });
  });
});

describe('hitLayer（第 2 段：问子文档）', () => {
  it('elementFromPoint 给的是 IMG，靠 closest 收口到图层', () => {
    const layer = fakeEl({ 'data-layer': 'title_cn' });
    const img = fakeEl({}, layer);
    expect(hitLayer(fakeDom(img), { x: 500, y: 1300 })).toBe('title_cn');
  });

  it('点到空白（没有 data-layer 祖先）= null', () => {
    expect(hitLayer(fakeDom(fakeEl({}, null)), { x: 5, y: 5 })).toBe(null);
  });

  it('elementFromPoint 返回 null = null', () => {
    expect(hitLayer(fakeDom(null), { x: 5, y: 5 })).toBe(null);
  });
});

describe('hitTest（两段式合并）', () => {
  const layerEl = fakeEl({ 'data-layer': 'slogan' });
  const root = fakeDom(fakeEl({}, layerEl));

  it('① 点在覆盖层手柄上 ⇒ 手柄赢，不去问子文档（否则会被底下那层截胡）', () => {
    const handle = fakeEl({ 'data-ve-handle': 'se' }, fakeEl({ 'data-ve-handle': 'se' }));
    expect(hitTest(root, handle, { x: 1423, y: 1425 })).toEqual({ kind: 'handle', dir: 'se' });
  });

  it('② 点在手柄以外 ⇒ 落到子文档那一层', () => {
    expect(hitTest(root, null, { x: 500, y: 1300 })).toEqual({ kind: 'layer', id: 'slogan' });
  });
});
