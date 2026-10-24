import { describe, expect, it } from 'vitest';
import {
  answerPending,
  askUser,
  cancelPending,
  hasPendingAsk,
} from '../src/designharness/session/ask-registry';
import type { AskQuestion } from '../src/designharness/session/turn-parts';

const Q: AskQuestion[] = [
  {
    id: 'size',
    header: '画布',
    question: '多大？',
    options: [
      { label: '4:5', value: '4:5' },
      { label: '1:1', value: '1:1' },
    ],
  },
];

describe('ask registry', () => {
  it('answer 解析 pending，并发出 answered 事件', async () => {
    const events: Array<Record<string, unknown>> = [];
    const p = askUser('s-answer', Q, new AbortController().signal, (e) => events.push(e));
    expect(hasPendingAsk('s-answer')).toBe(true);
    const asked = events.find((e) => e.kind === 'ask-user')!;
    expect(asked.questions).toEqual(Q);
    expect(answerPending('s-answer', String(asked.questionId), { size: '4:5' })).toBe(true);
    await expect(p).resolves.toEqual({ size: '4:5' });
    expect(events.some((e) => e.kind === 'ask-user-answered')).toBe(true);
    expect(hasPendingAsk('s-answer')).toBe(false);
  });

  it('abort 拒绝 pending，并发出 cancelled 事件', async () => {
    const events: Array<Record<string, unknown>> = [];
    const ac = new AbortController();
    const p = askUser('s-abort', Q, ac.signal, (e) => events.push(e));
    ac.abort();
    await expect(p).rejects.toThrow('用户已停止');
    expect(events.some((e) => e.kind === 'ask-user-cancelled')).toBe(true);
    expect(hasPendingAsk('s-abort')).toBe(false);
  });

  it('同一会话不能同时挂两个 pending', async () => {
    const p = askUser('s-dup', Q, new AbortController().signal);
    await expect(askUser('s-dup', Q, new AbortController().signal)).rejects.toThrow('已经有一个');
    cancelPending('s-dup');
    await expect(p).rejects.toThrow();
  });
});
