/**
 * ⭐ **统一编辑栈**（M2）—— 撤销 / 重做的**唯一**机制，跨所有工具混用。
 *
 * 命名：`editor-stack`——①它管的是**双向**（撤销 + 前进/重做），叫 `undo-stack` 只说了半个；
 * ②它的灵魂是 M2 的那条设计决定：**编辑器的所有操作共用这一个栈**（跨工具混用不乱）。
 * （曾叫 `commands`——实现虽是教科书式 Command Pattern，但"command"在编辑器语境里
 * 的第一联想是快捷键指令，且与主类型 `EditorStack` 名不副实，弃。）
 */

import type { DesignDocument } from '../document/vocabulary';

export interface Command {
  /** 给 UI 显示（"输入文字" "移动" "改 rect.w"） */
  label: string;
  /** 合并键：同类操作 + 同一个目标（打字 = `type:<id>`；面板 = `patch:<id>:<path>`）。无 ⇒ 不合并 */
  key?: string;
  /** 提交时间（合并窗口判定用） */
  at: number;
  before: DesignDocument;
  after: DesignDocument;
}

export interface EditorStack {
  /** 已发生的命令（按序） */
  done: Command[];
  /** 被撤销的命令（重做时弹回） */
  undone: Command[];
  /** 上限（防内存；文档小，100 步足够） */
  limit: number;
  /** **当前状态的镜像**——push 的 before 来自它，undo/redo 后同步 */
  head: DesignDocument;
  /**
   * ⭐ **最初的文档**（第 0 步）。
   *
   * 为什么需要它：`head` 只在 `done` 非空时才等于"某条命令的 after"；
   * 一旦全部撤销完（`done` 为空），**没有它就回不到第 0 步** ✗
   * ⇒ PS 那种"跳到任意一步（含最开始）"必须存它 ✓
   * （顺带：有了它，每条命令的 `before` 就是冗余的 —— 见 `gotoStep` 的注释）
   */
  base: DesignDocument;
}

/** 合并窗口（ms）：同类操作在此间隔内连续发生 ⇒ 并成一条 */
const MERGE_WINDOW = 800;

const clone = (d: DesignDocument): DesignDocument => structuredClone(d);

export function createEditorStack(base: DesignDocument, limit = 100): EditorStack {
  return { done: [], undone: [], limit, head: clone(base), base: clone(base) };
}

/**
 * 提交一条编辑。⚠️ 必须在**文档已改完之后**调用（before 取自 `head` —— 上一次提交后的状态）。
 * `key` 相同且距上一次提交 < 窗口 ⇒ 合并（栈顶 `after` 更新；`before` 保持最早 ⇒ 撤销落点不变）。
 * ⚠️ 新编辑会**清空重做分支**。
 */
export function pushCommand(stack: EditorStack, doc: DesignDocument, label: string, key?: string): void {
  const now = Date.now();
  const top = stack.done[stack.done.length - 1];
  if (key && top && top.key === key && now - top.at < MERGE_WINDOW) {
    top.after = clone(doc);
    stack.head = top.after;
    stack.undone = [];
    return;
  }
  const cmd: Command = {
    label,
    key,
    at: now,
    before: clone(stack.head),
    after: clone(doc),
  };
  stack.done.push(cmd);
  if (stack.done.length > stack.limit) stack.done.shift();
  stack.head = cmd.after;
  stack.undone = [];
}

/** 撤销：返回要**装回**的文档（= 栈顶命令的 before）；没有可撤销 ⇒ `null` */
export function undo(stack: EditorStack): DesignDocument | null {
  const cmd = stack.done.pop();
  if (!cmd) return null;
  stack.undone.push(cmd);
  stack.head = clone(cmd.before);
  return stack.head;
}

/** 重做：返回要**装回**的文档（= 命令的 after）；无可重做 ⇒ `null` */
export function redo(stack: EditorStack): DesignDocument | null {
  const cmd = stack.undone.pop();
  if (!cmd) return null;
  stack.done.push(cmd);
  stack.head = clone(cmd.after);
  return stack.head;
}

export const canUndo = (s: EditorStack): boolean => s.done.length > 0;
export const canRedo = (s: EditorStack): boolean => s.undone.length > 0;
export const undoDepth = (s: EditorStack): number => s.done.length;
export const redoDepth = (s: EditorStack): number => s.undone.length;

/** 重置（宿主整体换文档 ⇒ 历史作废） */
export function resetStack(stack: EditorStack, base: DesignDocument): void {
  stack.done = [];
  stack.undone = [];
  stack.head = clone(base);
  stack.base = clone(base);
}

/** 历史总步数（含已撤销的）—— 面板要画"第 k 步 / 共 n 步" */
export const totalSteps = (s: EditorStack): number => s.done.length + s.undone.length;

/**
 * ⭐ **跳到第 `index` 步**（PS 历史面板那种"点任意一条跳过去"）。
 *
 * - `index = 0` ⇒ 回到**最初**（`stack.base`）
 * - `index = done.length` ⇒ 什么都不做（已经在那儿）
 * - `index > done.length` ⇒ **重做**若干步
 * - `index < done.length` ⇒ **撤销**若干步
 *
 * ⚠️ 语义上它就是"连续 undo / 连续 redo"，只是**一次算完** ⇒ 返回要装回的文档。
 * ⚠️ `undone` 的栈顶 = 最近被撤销的那条（`redo` 从尾部弹）⇒ 两个循环都从尾部搬 ✓
 */
export function gotoStep(stack: EditorStack, index: number): DesignDocument | null {
  const total = totalSteps(stack);
  if (!Number.isInteger(index) || index < 0 || index > total) return null;
  if (index === stack.done.length) return null; // 已经在那儿，不必换文档

  while (stack.done.length > index) {
    const cmd = stack.done.pop();
    if (!cmd) break;
    stack.undone.push(cmd);
  }
  while (stack.done.length < index) {
    const cmd = stack.undone.pop();
    if (!cmd) break;
    stack.done.push(cmd);
  }
  // ⭐ 第 0 步没有"上一条命令的 after" ⇒ 只能用 `base`
  const at = stack.done.length === 0 ? stack.base : stack.done[stack.done.length - 1].after;
  stack.head = clone(at);
  return stack.head;
}

/** 历史列表（给面板用）：`[{ index, label, at }]`，index 从 1 开始（0 = 初始，不在列表里） */
export function historyEntries(s: EditorStack): Array<{ index: number; label: string; at: number; undone: boolean }> {
  return [
    ...s.done.map((c, i) => ({ index: i + 1, label: c.label, at: c.at, undone: false })),
    // ⚠️ `undone` 是**栈**（栈顶 = 最近被撤销的那条）⇒ 要 `reverse` 才是**升序的步号**，
    //    否则面板里会出现 "3 排在 2 前面" ✗（实测踩过）
    ...[...s.undone].reverse().map((c, i) => ({
      index: s.done.length + i + 1,
      label: c.label,
      at: c.at,
      undone: true,
    })),
  ];
}
