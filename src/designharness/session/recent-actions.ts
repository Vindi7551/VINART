/**
 * 最近工具操作 → systemNote 摘要。
 *
 * 为什么需要：`chat-session` 的历史里**只存最终 assistant 文本**，中间 tool_calls /
 * tool 结果不进下一轮上下文。一轮被工具轮数上限截断后，用户说“继续”，模型看不到
 * “刚才已经 generate_assets 了哪些文件、有没有 patch”，于是容易重新开一版 / 重新生图。
 *
 * 这里只做**紧凑摘要**（工具名 / layout / 文件 / patch 数），不把大 JSON 喂回去。
 */

import type { SessionEvent } from './transcript';

export interface RecentActionsOptions {
  /** 最多写几条；默认 6 */
  limit?: number;
}

function parseJson(v: unknown): unknown {
  if (typeof v !== 'string' || !v.trim()) return null;
  try {
    return JSON.parse(v);
  } catch {
    return null; // 转录里的 args/result 可能被截断
  }
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** 从 args/result 里抠 layout（JSON 解析失败时退回正则） */
function layoutOf(argsRaw: unknown, resultRaw: unknown): string {
  const a = asRecord(parseJson(argsRaw));
  const r = asRecord(parseJson(resultRaw));
  const direct = str(r?.layout) || str(a?.layout);
  if (direct) return direct;
  for (const raw of [resultRaw, argsRaw]) {
    if (typeof raw !== 'string') continue;
    const m = /"layout"\s*:\s*"([^"]+)"/.exec(raw);
    if (m?.[1]) return m[1];
  }
  return '?';
}

/** generate_assets 产出的文件名（result 优先；args 里也有 file） */
function filesOf(argsRaw: unknown, resultRaw: unknown): string[] {
  const out: string[] = [];
  const add = (v: unknown) => {
    const s = str(v).trim();
    if (s && !out.includes(s)) out.push(s);
  };

  const r = asRecord(parseJson(resultRaw));
  for (const key of ['images', 'icons'] as const) {
    const list = r?.[key];
    if (Array.isArray(list)) {
      for (const it of list) {
        const rec = asRecord(it);
        if (rec && rec.ok !== false) add(rec.file);
      }
    }
  }
  if (out.length) return out;

  // JSON 被截断：从原始字符串里捞 "file":"xxx"
  for (const raw of [resultRaw, argsRaw]) {
    if (typeof raw !== 'string') continue;
    for (const m of raw.matchAll(/"file"\s*:\s*"([^"]+)"/g)) {
      if (m[1]) add(m[1]);
    }
  }
  return out;
}

/** patch_doc：总条数 + 其中 asset 条数 */
function patchInfo(argsRaw: unknown, resultRaw: unknown): { applied: number; assets: number } {
  const a = asRecord(parseJson(argsRaw));
  const patches = Array.isArray(a?.patches) ? a.patches : [];
  const assets = patches.filter((p) => asRecord(p)?.path === 'asset').length;
  const r = asRecord(parseJson(resultRaw));
  const applied = typeof r?.applied === 'number' ? r.applied : patches.length;
  return { applied, assets };
}

function hhmm(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '--:--';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * 纯函数：把最近的 tool-call 事件格式化成 systemNote 的一段。
 * 没有工具调用（或只有 skill）时返回空串。
 */
export function formatRecentActions(
  events: readonly SessionEvent[],
  opts: RecentActionsOptions = {},
): string {
  const limit = Math.max(1, opts.limit ?? 6);
  const calls: Array<{ e: Extract<SessionEvent, { kind: 'action' }>; detail: Record<string, unknown> }> =
    [];
  for (const e of events) {
    if (e.kind !== 'action' || e.action !== 'tool-call') continue;
    const detail = asRecord(e.detail);
    if (!detail) continue;
    // skill 是“读手册”，不是进度；不进摘要，否则挤掉真正的 sketch/generate/patch
    if (str(detail.name) === 'skill') continue;
    calls.push({ e, detail });
  }
  const recent = calls.slice(-limit);
  if (!recent.length) return '';

  const lines = recent.map(({ e, detail }) => {
    const name = str(detail.name) || '?';
    const ok = detail.ok !== false;
    const layout = layoutOf(detail.args, detail.result);
    let what = '';
    if (name === 'sketch_plan') {
      what = '新建草图';
    } else if (name === 'generate_assets') {
      const files = filesOf(detail.args, detail.result);
      what = files.length ? `生成 ${files.join('、')}` : '生成素材';
    } else if (name === 'patch_doc') {
      const { applied, assets } = patchInfo(detail.args, detail.result);
      what = assets ? `patch ${applied} 条（挂载素材 ${assets} 条）` : `patch ${applied} 条`;
    } else if (name === 'get_design') {
      what = '读语义视图';
    } else {
      what = '执行';
    }
    return `- ${hhmm(e.ts)} ${name}(${layout}) → ${what}${ok ? '' : '（失败）'}`;
  });

  const last = recent[recent.length - 1]!.detail;
  const lastName = str(last.name);
  const hint =
    lastName === 'generate_assets'
      ? '素材已生成；如果 doc 里还没挂上，下一步用 patch_doc 的 asset，不要重新生成。'
      : lastName === 'sketch_plan'
        ? '草图已建；下一步 get_design / patch_doc，不要为了“继续”而新建版式。'
        : '';

  return [
    '【最近操作】',
    ...lines,
    ...(hint ? [`- 提示：${hint}`] : []),
  ].join('\n');
}
