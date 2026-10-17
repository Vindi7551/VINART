/**
 * **文字装填** —— 「装不装得下」必须**在浏览器里量**，纯 CSS 算不出来。
 *
 * ## 为什么这一遍不能省
 *
 * 字号是写死的（`fontScale × 画布宽`）。文字一长就撑破版式 ——
 * 要么冲出框，要么换行把整块布局挤歪。**CSS 没有"自动缩到装得下"这种写法**
 * （`clamp()` / `cqw` 都只能按容器尺寸算，不知道文字到底有多宽）。
 * 所以只能是：渲染一遍 → 量 → 算系数 → 再渲染一遍。
 *
 * 这条路旧链早就踩过（`src/workflow/compose/assemble.ts`），本文件照抄它的三条经验：
 *
 * 1. **测量视口必须等于画布尺寸** —— 不然量出来的"可用宽"是错的。
 * 2. **必须等 `document.fonts.ready`** —— woff2 是异步加载的，不等就量到**兜底字体**的宽度，
 *    算出来的系数全是错的（而且错得很隐蔽：看着差不多，其实差一截）。
 * 3. **量 `scrollWidth / clientWidth`** —— 内层是 `nowrap` 的文字本体，
 *    宽度被拉成容器宽，于是"需要多宽"就藏在 `scrollWidth` 里。
 *
 * ## 为什么新链要**多轮**而不是一轮
 *
 * 旧链只测一次（`fits[k] = avail / need`）就回填。理论上线性关系一次就够，
 * 但字号是**取整**的（`Math.round`），缩完可能还差一两个像素。
 * 所以这里循环：量到还溢出 ⇒ 系数**累乘** ⇒ 再渲染，直到装下或用完轮数。
 *
 * ## ⚠️ 浏览器是**注入**进来的
 *
 * 本文件不自己启动浏览器（`MeasurePage` 由调用方给）。
 * 这样这段逻辑既能接真 playwright，也能在测试里接一个假页面 ——
 * 和 `src/editor/` 那条"文档对象必须从参数流入"的约束是同一个道理。
 */

import { emitDocument, type EmitIssue, type EmitOptions } from './emit';
import { iterElements, type DesignDocument } from '../../document/vocabulary';

/**
 * 测量用的页面 —— **注入进来**，形状与 old `assemble.ts` 用的 playwright `Page` 一致。
 *
 * ⚠️ `evaluate` 收的是**字符串**（一段表达式），不是函数：
 * 打包器会给箭头函数注入 `__name` 之类的辅助，序列化到浏览器里就炸了。
 *
 * ⚠️ **不能带第二个参数**：playwright 在 `pageFunction` 是字符串时会**忽略 arg**。
 * 要传东西就把它拼进表达式里（`fn(1,2)` 这种形式）。
 */
export interface MeasurePage {
  setViewportSize(size: { width: number; height: number }): Promise<unknown>;
  setContent(html: string, opts?: { waitUntil?: string }): Promise<unknown>;
  evaluate<R>(expr: string): Promise<R>;
  close(): Promise<unknown>;
}

export interface FitOptions extends Pick<EmitOptions, 'faceCss' | 'assets'> {
  /** 最多回填几轮（默认 3）。装得下的话一轮就停 */
  maxRounds?: number;
}

export interface FitRound {
  round: number;
  /** 这一轮**结束时**用的系数（累积值） */
  fits: Record<string, number>;
  /** 这一轮量出来**还溢出**的节点 */
  overflow: string[];
}

export interface FitResult {
  /** 最终 HTML —— 用的是**最后一次**算出来的系数 */
  html: string;
  /** 最终系数（只含"确实需要缩"的那些；装得下的不在里面） */
  fits: Record<string, number>;
  /** 实际跑了几轮测量（0 = 一遍就装下了，什么都没缩） */
  rounds: number;
  /** 最后一轮量完**仍然**溢出的节点（正常情况下应当为空） */
  stillOverflow: string[];
  log: FitRound[];
  unsupported: EmitIssue[];
  notes: EmitIssue[];
}

/**
 * 在浏览器里跑的**测量脚本**。取宽、高里**更严格**的那个比例 —— 字号一缩，宽高同比例下去。
 *
 * ⚠️ **高度不能量外层的 `scrollHeight`**（实测踩到）：内层是
 * `position:absolute; top:50%; transform:translateY(-50%)`，
 * 那 50% 的**偏移**会被算进外层的滚动区域 ⇒ 量出来的"需要高度"永远比真实值多半个框，
 * 于是怎么缩都还差几像素，永远收敛不了。
 *
 * ⇒ 高度量**文字块自身**的 `offsetHeight`（布局高度，不含 `transform`），
 *   拿它和框高比。宽度照旧量 `scrollWidth / clientWidth`（内层被拉成框宽，
 *   "需要多宽"就藏在 `scrollWidth` 里）。
 */
const MEASURE_JS = `(function (keys) {
  var out = {};
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    var inner = document.querySelector('[data-fit="' + k + '"]');
    if (!inner) continue;
    var outer = document.querySelector('[data-layer="' + k + '"]');

    var wRatio = 1, hRatio = 1;
    var availW = inner.clientWidth, needW = inner.scrollWidth;
    if (availW > 0 && needW > availW) wRatio = availW / needW;
    if (outer) {
      var availH = outer.clientHeight, needH = inner.offsetHeight;
      if (availH > 0 && needH > availH) hRatio = availH / needH;
    }

    var r = Math.min(wRatio, hRatio);
    if (r < 1) out[k] = r;
  }
  return out;
})`;

/**
 * 哪些节点要参与测量 = 所有**参与 DOM 排版**的文字节点。
 *
 * ⚠️ 画布的孩子是**图层**，文字是**图层里的元素**（组里还能再套组）
 * ⇒ 必须沿 `iterElements` 往下走。只看顶层会漏掉组内文字：它们拿不到装填系数，
 * 长文字会冲出框，而且**没人知道**。
 *
 * ⚠️ **沿路径排字的（`path` / `curve`）不参与** —— 它们走 SVG `<textPath>`，
 * 页面上根本没有 `[data-fit]` 那个锚点（`MEASURE_JS` 里会跳过）。
 * 而且装填系数对它们本来就无意义：路径上的文字是"按路径长度排"，
 * 不是"塞进一个框里缩字号"。
 */
export function fitTargets(doc: DesignDocument): string[] {
  const out: string[] = [];
  for (const layer of doc.layers) {
    for (const e of iterElements(layer)) {
      if (e.type === 'text' && !e.path && !e.curve) out.push(e.id);
    }
  }
  return out;
}

/**
 * **渲染 + 实测 + 回填**，直到装得下或用完轮数。
 *
 * 返回的 `html` 就是"已经缩好"的最终产物，可以直接拿去出图。
 */
export async function emitFitted(
  doc: DesignDocument,
  page: MeasurePage,
  opts: FitOptions = {},
): Promise<FitResult> {
  const maxRounds = opts.maxRounds ?? 3;
  const emitOpts: EmitOptions = { faceCss: opts.faceCss, assets: opts.assets };
  const ids = fitTargets(doc);

  let fits: Record<string, number> = {};
  let last = emitDocument(doc, { ...emitOpts, fits });
  const log: FitRound[] = [];

  // 一个文字节点都没有 ⇒ 没什么可量的
  if (!ids.length) {
    return { html: last.html, fits, rounds: 0, stillOverflow: [], log, unsupported: last.unsupported, notes: last.notes };
  }

  await page.setViewportSize({ width: doc.canvas.width, height: doc.canvas.height });

  let stillOverflow: string[] = [];
  let measured = 0;

  for (let round = 1; round <= maxRounds; round++) {
    await page.setContent(last.html, { waitUntil: 'load' });
    // ⚠️ 等字体就绪：不等就量到兜底字体的宽度，系数全错（旧链踩过）
    await page.evaluate('document.fonts ? document.fonts.ready : null');

    // ⚠️ 参数必须**拼进表达式**：字符串形式的 `evaluate` 收不到第二个参数
    const ratios = await page.evaluate<Record<string, number>>(
      `${MEASURE_JS}(${JSON.stringify(ids)})`,
    );
    measured = round;
    const overflow = Object.keys(ratios);
    stillOverflow = overflow;

    // 装得下了 ⇒ 收工（用的是当前这一份 html）
    if (!overflow.length) break;

    // 系数**累乘**：这一轮的比值是在"上一轮缩过之后"的基础上再缩
    for (const k of overflow) fits[k] = (fits[k] ?? 1) * ratios[k];
    log.push({ round, fits: { ...fits }, overflow });

    last = emitDocument(doc, { ...emitOpts, fits });
    // 最后一轮之后不再重渲（再渲也用不上）⇒ 补量一次，
    // 好让 `stillOverflow` 反映的是**最终产物**的状态，而不是中间某一轮的。
    // ⚠️ 这一条**不进 `log`** —— `log` 只记"真的做过回填的轮次"。
    if (round === maxRounds) {
      await page.setContent(last.html, { waitUntil: 'load' });
      await page.evaluate('document.fonts ? document.fonts.ready : null');
      stillOverflow = Object.keys(
        await page.evaluate<Record<string, number>>(`${MEASURE_JS}(${JSON.stringify(ids)})`),
      );
    }
  }

  return {
    html: last.html,
    fits,
    rounds: measured,
    stillOverflow,
    log,
    unsupported: last.unsupported,
    notes: last.notes,
  };
}
