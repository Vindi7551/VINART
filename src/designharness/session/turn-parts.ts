/**
 * 助手一轮回复的**有序 parts**。
 *
 * 一个 assistant turn = 文本段 / 思考段 / 工具调用 按发生顺序排成的数组。
 * 这是实时 UI 与 transcript 落盘共用的形状；不是 doc 模型的一部分。
 */

export interface TurnTextPart {
  type: 'text';
  text: string;
}

export interface TurnReasoningPart {
  type: 'reasoning';
  text: string;
}

export interface TurnToolPart {
  type: 'tool';
  /** 同一次调用的 start / end 用同一个 id 配对 */
  callId: string;
  name: string;
  args?: string;
  status: 'running' | 'done' | 'failed';
  result?: string;
  ms?: number;
}

export interface TurnDelegationPart {
  type: 'delegation';
  runId: string;
  label: string;
  name?: string;
  task?: string;
  status: 'running' | 'done' | 'failed';
  summary?: string;
  artifacts?: string[];
}

export type TurnPart = TurnTextPart | TurnReasoningPart | TurnToolPart | TurnDelegationPart;

/** 追加文本；如果末尾已经是文本段就合并，避免一段话被切碎 */
export function appendTextPart(parts: TurnPart[], text: string): TurnPart[] {
  if (!text) return parts;
  const last = parts[parts.length - 1];
  if (last?.type === 'text') {
    return [...parts.slice(0, -1), { ...last, text: last.text + text }];
  }
  return [...parts, { type: 'text', text }];
}

/** 追加思考；同一轮连续 reasoning chunk 合并 */
export function appendReasoningPart(parts: TurnPart[], text: string): TurnPart[] {
  if (!text) return parts;
  const last = parts[parts.length - 1];
  if (last?.type === 'reasoning') {
    return [...parts.slice(0, -1), { ...last, text: last.text + text }];
  }
  return [...parts, { type: 'reasoning', text }];
}

/** 开始一次工具调用：新起一个 running 的 tool part */
export function startToolPart(
  parts: TurnPart[],
  tool: Omit<TurnToolPart, 'type' | 'status'>,
): TurnPart[] {
  return [...parts, { type: 'tool', ...tool, status: 'running' }];
}

/** 结束工具调用：按 callId 更新；找不到就补一条完成态（兼容丢 start 的情况） */
export function finishToolPart(
  parts: TurnPart[],
  callId: string,
  patch: { status: 'done' | 'failed'; result?: string; ms?: number },
): TurnPart[] {
  let found = false;
  const next = parts.map((p) => {
    if (p.type !== 'tool' || p.callId !== callId) return p;
    found = true;
    return { ...p, ...patch };
  });
  if (found) return next;
  return [
    ...next,
    {
      type: 'tool',
      callId,
      name: 'tool',
      status: patch.status,
      ...(patch.result !== undefined ? { result: patch.result } : {}),
      ...(patch.ms !== undefined ? { ms: patch.ms } : {}),
    },
  ];
}

/** 开始一条子 agent 委派 */
export function startDelegationPart(
  parts: TurnPart[],
  d: Omit<TurnDelegationPart, 'type' | 'status'>,
): TurnPart[] {
  if (parts.some((p) => p.type === 'delegation' && p.runId === d.runId)) return parts;
  return [...parts, { type: 'delegation', ...d, status: 'running' }];
}

/** 结束一条委派：按 runId 更新；找不到就补一条完成态 */
export function finishDelegationPart(
  parts: TurnPart[],
  runId: string,
  patch: {
    status: 'done' | 'failed';
    summary?: string;
    artifacts?: string[];
  },
): TurnPart[] {
  let found = false;
  const next = parts.map((p) => {
    if (p.type !== 'delegation' || p.runId !== runId) return p;
    found = true;
    return { ...p, ...patch };
  });
  if (found) return next;
  return [
    ...next,
    {
      type: 'delegation',
      runId,
      label: '子 agent',
      status: patch.status,
      ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
      ...(patch.artifacts !== undefined ? { artifacts: patch.artifacts } : {}),
    },
  ];
}

/** 纯文本拼接（兼容 Message.text / 老 UI / 复制） */
export function partsText(parts: TurnPart[]): string {
  return parts
    .filter((p): p is TurnTextPart => p.type === 'text')
    .map((p) => p.text)
    .join('');
}

/** 思考全文（兼容 Message.reasoning） */
export function partsReasoning(parts: TurnPart[]): string {
  return parts
    .filter((p): p is TurnReasoningPart => p.type === 'reasoning')
    .map((p) => p.text)
    .join('');
}
