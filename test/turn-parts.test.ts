import { describe, expect, it } from 'vitest';
import {
  appendReasoningPart,
  appendTextPart,
  answerQuestionPart,
  cancelQuestionPart,
  finishDelegationPart,
  finishToolPart,
  partsReasoning,
  partsText,
  startDelegationPart,
  startQuestionPart,
  startToolPart,
  type TurnPart,
} from '../src/designharness/session/turn-parts';

describe('turn parts', () => {
  it('连续文本 / 思考合并，不切碎', () => {
    let parts: TurnPart[] = [];
    parts = appendTextPart(parts, '先看');
    parts = appendTextPart(parts, '版式。');
    parts = appendReasoningPart(parts, '想');
    parts = appendReasoningPart(parts, '一下');
    expect(parts).toEqual([
      { type: 'text', text: '先看版式。' },
      { type: 'reasoning', text: '想一下' },
    ]);
    expect(partsText(parts)).toBe('先看版式。');
    expect(partsReasoning(parts)).toBe('想一下');
  });

  it('工具 start / end 按 callId 更新同一行', () => {
    let parts: TurnPart[] = [];
    parts = appendTextPart(parts, '查一下。');
    parts = startToolPart(parts, { callId: 'c1', name: 'get_design', args: '{}' });
    parts = finishToolPart(parts, 'c1', { status: 'done', result: 'ok', ms: 12 });
    expect(parts[1]).toEqual({
      type: 'tool',
      callId: 'c1',
      name: 'get_design',
      args: '{}',
      status: 'done',
      result: 'ok',
      ms: 12,
    });
  });

  it('完整的交错顺序：文本 → 思考 → 工具 → 思考 → 文本', () => {
    let parts: TurnPart[] = [];
    parts = appendTextPart(parts, '第一段。');
    parts = appendReasoningPart(parts, '轮 1 思考');
    parts = startToolPart(parts, { callId: 'c1', name: 'get_design' });
    parts = finishToolPart(parts, 'c1', { status: 'done', ms: 8 });
    parts = appendReasoningPart(parts, '轮 2 思考');
    parts = appendTextPart(parts, '第二段。');

    expect(parts.map((p) => p.type)).toEqual(['text', 'reasoning', 'tool', 'reasoning', 'text']);
    expect(partsText(parts)).toBe('第一段。第二段。');
  });

  it('结束事件找不到 start 时补一条完成态', () => {
    const parts = finishToolPart([], 'missing', { status: 'failed', result: 'boom' });
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ type: 'tool', callId: 'missing', status: 'failed', result: 'boom' });
  });

  it('delegation 按 runId 更新，不重复 push', () => {
    let parts: TurnPart[] = [];
    parts = startDelegationPart(parts, { runId: 'r1', label: '审查产品', task: '只看不改' });
    parts = startDelegationPart(parts, { runId: 'r1', label: '审查产品', task: '只看不改' });
    expect(parts).toHaveLength(1);
    parts = finishDelegationPart(parts, 'r1', { status: 'done', summary: '哑光黑，logo 左上' });
    expect(parts[0]).toMatchObject({ type: 'delegation', runId: 'r1', status: 'done' });
  });

  it('question 按 questionId 回答 / 取消', () => {
    let parts: TurnPart[] = [];
    parts = startQuestionPart(parts, {
      questionId: 'q1',
      questions: [{ id: 'size', question: '多大？' }],
    });
    expect(parts[0]).toMatchObject({ type: 'question', status: 'pending' });
    parts = answerQuestionPart(parts, 'q1', { size: '4:5' });
    expect(parts[0]).toMatchObject({ type: 'question', status: 'answered', answers: { size: '4:5' } });
    parts = cancelQuestionPart(parts, 'q1');
    expect(parts[0]).toMatchObject({ type: 'question', status: 'cancelled' });
  });
});
