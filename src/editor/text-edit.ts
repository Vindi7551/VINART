/**
 * **在文字里插入 / 删除字符** —— 纯函数，不碰 DOM。
 *
 * ## 它解决什么
 *
 * 「在画布上打字」的前半段：**光标在哪儿、敲了什么键 → `runs` 变成什么样**。
 * 后半段（把光标画出来、把 DOM 补上）属宿主，见 `src/editor/README.md`。
 *
 * ## 为什么光标用**绝对字符下标**
 *
 * 敲一个字就可能把片段切开 / 合并（`normalizeRuns`），片段编号随时在变。
 * 只有"整段文字里的第几个字符"是稳定的 —— 与选区染色同一套（`text-runs.ts`）。
 *
 * ## 插进哪一段
 *
 * 光标压在两段的**接缝**上时，插进去的字**继承前一段**的样式
 * （`absToPoint` 把接缝归前一段末尾）——与浏览器在 `contentEditable` 里的行为一致：
 * 在 span 边界打字，字进的是前一个 span。
 */

import type { TextRun } from '../document/vocabulary';
import { absToPoint, normalizeRuns } from './text-runs';

/** 一次编辑的结果：新的片段数组 + **编辑之后光标该在哪**（绝对下标） */
export interface EditResult {
  runs: TextRun[];
  caret: number;
}

/** 整段文字有多长（所有片段拼起来） */
export function totalLength(runs: readonly TextRun[]): number {
  let n = 0;
  for (const r of runs) n += r.text.length;
  return n;
}

/**
 * `runs` 一个都没有时也要留一段 —— 词汇里 `runs` **至少一段**。
 *
 * 全选删光的场景：不兜底的话文档会变成 `runs: []`，
 * 之后既没法插入（没有落点）也没法定位光标。
 */
function ensureOne(runs: TextRun[]): TextRun[] {
  return runs.length ? runs : [{ text: '' }];
}

const copyAll = (runs: readonly TextRun[]): TextRun[] => runs.map((r) => ({ ...r }));

/**
 * ⭐ 在 `caret` 处插入一段文字（可以是 `\n`，换行本来就写在文字里）。
 *
 * 插进去的字**继承落点那一段**的样式（正好是"接着前面继续打"的直觉）。
 */
export function insertText(runs: readonly TextRun[], caret: number, text: string): EditResult {
  if (!text) return { runs: copyAll(runs), caret };
  const at = absToPoint(runs, caret);
  if (!at) return { runs: copyAll(runs), caret };

  const out = copyAll(runs);
  const r = out[at.run];
  r.text = r.text.slice(0, at.offset) + text + r.text.slice(at.offset);
  // ⚠️ 这里**不做** `normalizeRuns`：插入只会让这一段变长，不会产生"相邻同款"。
  return { runs: out, caret: caret + text.length };
}

/**
 * ⭐ 删掉 `[from, to)` 这一段字符（**退格 / 前删 / 替换选中**都走它）。
 *
 * 跨片段时逐段裁剪：切到哪段就削哪段，整段削光就整段消失
 * （空了自然会被 `normalizeRuns` 丢掉）。
 */
export function deleteRange(runs: readonly TextRun[], from: number, to: number): EditResult {
  const lo = Math.max(0, Math.min(from, to));
  const hi = Math.max(from, to);
  if (hi <= lo) return { runs: copyAll(runs), caret: lo };

  const out: TextRun[] = [];
  let acc = 0;
  for (const r of runs) {
    const s = acc;
    const e = acc + r.text.length;
    acc = e;
    if (e <= lo || s >= hi) {
      out.push({ ...r }); // 完全在删除区间之外
      continue;
    }
    // 只留下"区间外"的两头（可能都是空的）
    const head = r.text.slice(0, Math.max(0, lo - s));
    const tail = r.text.slice(Math.max(0, hi - s));
    const kept = head + tail;
    if (kept) out.push({ ...r, text: kept });
  }

  const merged = ensureOne(normalizeRuns(out));
  // 删完光标停在区间左端（不会超过新长度）
  return { runs: merged, caret: Math.min(lo, totalLength(merged)) };
}

/** 退格：删光标**前面**那个字符（在世界最左边 = 什么都不做） */
export function deleteBackward(runs: readonly TextRun[], caret: number): EditResult {
  if (caret <= 0) return { runs: copyAll(runs), caret };
  return deleteRange(runs, caret - 1, caret);
}

/** 前删：删光标**后面**那个字符 */
export function deleteForward(runs: readonly TextRun[], caret: number): EditResult {
  if (caret >= totalLength(runs)) return { runs: copyAll(runs), caret };
  return deleteRange(runs, caret, caret + 1);
}

/**
 * **把某一段的文字换掉**（IME 组合结束时用）。
 *
 * 为什么需要它：输入法组合期间的 `beforeinput` **不可取消**（`cancelable = false`），
 * 浏览器会真的去改 DOM。组合结束后把该片段读回来对齐 —— 这是**唯一**一处
 * "从 DOM 读回文字"的地方，而且**只读文字、不读样式**（样式真源仍在文档）。
 */
export function replaceRunText(runs: readonly TextRun[], index: number, text: string): EditResult {
  if (index < 0 || index >= runs.length) return { runs: copyAll(runs), caret: 0 };
  const out = copyAll(runs);
  out[index].text = text;
  const merged = ensureOne(normalizeRuns(out));
  // 光标停在刚改过那一段的末尾
  let caret = 0;
  for (let i = 0; i <= index && i < merged.length; i++) caret += merged[i].text.length;
  return { runs: merged, caret };
}
