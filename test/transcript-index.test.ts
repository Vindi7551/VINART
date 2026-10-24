/**
 * `transcript.advanceIndexEntry` 的纯函数对账 —— 索引增量更新的口径。
 *
 * 为什么要单测：这是把「每条事件全量重放」换成「拿这条事件推进摘要」的核心。
 * 规则必须和全量重放（`deriveTitle` / `countMessages` / `lastMetaField`）逐字一致，
 * 否则索引会悄悄漂，而 `reconcileDirIndex` 要到下次认领目录才会修。
 */
import { describe, expect, it } from 'vitest';
import {
  advanceIndexEntry,
  type SessionEvent,
  type SessionIndexEntry,
} from '../src/designharness/session/transcript';

const baseEntry: SessionIndexEntry = {
  id: 'sess_test',
  title: '新会话',
  updatedAt: '2026-10-24T00:00:00.000Z',
  messageCount: 0,
  workDir: 'D:\\work\\demo',
  home: 'D:\\work\\demo',
};

const userMsg = (text: string, ts = '2026-10-24T00:00:01.000Z'): SessionEvent => ({
  ts,
  kind: 'message',
  id: 'm1',
  role: 'user',
  text,
});

const assistantMsg = (text: string, ts = '2026-10-24T00:00:02.000Z'): SessionEvent => ({
  ts,
  kind: 'message',
  id: 'm2',
  role: 'assistant',
  text,
});

describe('advanceIndexEntry（索引增量更新）', () => {
  it('动作事件只改 updatedAt，不动标题/条数/工作目录', () => {
    const next = advanceIndexEntry(baseEntry, {
      ts: '2026-10-24T09:00:00.000Z',
      kind: 'action',
      action: 'tool-call',
      detail: { name: 'patch_doc' },
    });
    expect(next).toEqual({ ...baseEntry, updatedAt: '2026-10-24T09:00:00.000Z' });
  });

  it('首条用户消息：条数 0→1，标题取首条用户消息', () => {
    const next = advanceIndexEntry(baseEntry, userMsg('复刻这张产品图'));
    expect(next.messageCount).toBe(1);
    expect(next.title).toBe('复刻这张产品图');
    expect(next.updatedAt).toBe('2026-10-24T00:00:01.000Z');
  });

  it('标题只算一次：后续用户消息不覆盖标题，但条数继续加', () => {
    const first = advanceIndexEntry(baseEntry, userMsg('第一句标题'));
    const second = advanceIndexEntry(first, userMsg('第二句不应该变成标题'));
    expect(second.title).toBe('第一句标题');
    expect(second.messageCount).toBe(2);
  });

  it('助手消息也计入 messageCount，但不改标题', () => {
    const first = advanceIndexEntry(baseEntry, userMsg('标题甲'));
    const next = advanceIndexEntry(first, assistantMsg('助手回复正文'));
    expect(next.messageCount).toBe(2);
    expect(next.title).toBe('标题甲');
  });

  it('标题超过 20 字时截断并加省略号（与 deriveTitle 同口径）', () => {
    const text = '这是一个超过二十个字符的很长很长的会话标题测试';
    const next = advanceIndexEntry(baseEntry, userMsg(text));
    expect(next.title).toBe(text.trim().slice(0, 20) + '…');
  });

  it('首条用户消息是空白时标题保持「新会话」', () => {
    const next = advanceIndexEntry(baseEntry, userMsg('   '));
    expect(next.title).toBe('新会话');
    expect(next.messageCount).toBe(1);
  });

  it('meta 带 workDir 时更新工作目录；不带时保持原值', () => {
    const withDir = advanceIndexEntry(baseEntry, {
      ts: '2026-10-24T00:00:03.000Z',
      kind: 'meta',
      workDir: 'D:\\work\\other',
    });
    expect(withDir.workDir).toBe('D:\\work\\other');

    const withoutDir = advanceIndexEntry(withDir, {
      ts: '2026-10-24T00:00:04.000Z',
      kind: 'meta',
    });
    expect(withoutDir.workDir).toBe('D:\\work\\other');
  });

  it('active-layout 事件不碰任何摘要字段', () => {
    const next = advanceIndexEntry(
      { ...baseEntry, title: '已有标题', messageCount: 7 },
      { ts: '2026-10-24T00:00:05.000Z', kind: 'active-layout', layout: 'demo' },
    );
    expect(next).toEqual({
      ...baseEntry,
      title: '已有标题',
      messageCount: 7,
      updatedAt: '2026-10-24T00:00:05.000Z',
    });
  });

  it('不修改传入的旧条目（纯函数）', () => {
    const prev: SessionIndexEntry = { ...baseEntry };
    const snapshot = JSON.parse(JSON.stringify(prev)) as SessionIndexEntry;
    advanceIndexEntry(prev, userMsg('不应该写回旧对象'));
    expect(prev).toEqual(snapshot);
  });
});
