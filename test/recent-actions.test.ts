import { describe, expect, it } from 'vitest';
import { formatRecentActions } from '../src/designharness/session/recent-actions';
import type { SessionEvent } from '../src/designharness/session/transcript';

function call(
  ts: string,
  name: string,
  args: string,
  result: string,
  ok = true,
): SessionEvent {
  return {
    ts,
    kind: 'action',
    action: 'tool-call',
    detail: { kind: 'tool-call', name, args, result, ok },
  };
}

describe('formatRecentActions', () => {
  it('过滤 skill，保留 sketch/generate/patch，并给“继续”提示', () => {
    const note = formatRecentActions([
      call('2026-10-20T07:04:30.000Z', 'skill', '{"name":"design-style"}', '{}'),
      call('2026-10-20T07:04:55.000Z', 'sketch_plan', '{"layout":"p1"}', '{"ok":true,"layout":"p1","created":true}'),
      call(
        '2026-10-20T07:05:16.000Z',
        'generate_assets',
        '{"layout":"p1","images":[{"file":"hero.png"}]}',
        '{"layout":"p1","images":[{"file":"hero.png","ok":true}]}',
      ),
    ]);
    expect(note).toContain('【最近操作】');
    expect(note).toContain('sketch_plan(p1)');
    expect(note).toContain('generate_assets(p1)');
    expect(note).toContain('hero.png');
    expect(note).not.toContain('skill');
    expect(note).toContain('不要重新生成');
  });

  it('patch_doc 统计 asset 条数', () => {
    const note = formatRecentActions([
      call(
        '2026-10-20T07:06:11.000Z',
        'patch_doc',
        '{"layout":"p1","patches":[{"id":"a","path":"asset","value":"hero.png"},{"id":"b","path":"fill","value":"#fff"}]}',
        '{"layout":"p1","applied":2}',
        true,
      ),
    ]);
    expect(note).toContain('patch 2 条');
    expect(note).toContain('挂载素材 1 条');
  });

  it('没有工具（或只有 skill）时返回空串', () => {
    expect(formatRecentActions([])).toBe('');
    expect(formatRecentActions([call('2026-10-20T07:04:30.000Z', 'skill', '{}', '{}')])).toBe('');
  });

  it('args/result 被截断时仍能从正则里认出 layout 和文件', () => {
    const note = formatRecentActions([
      call(
        '2026-10-20T07:05:16.000Z',
        'generate_assets',
        '{"layout":"p1","images":[{"file":"a.png"},{"file":"b.png"}…',
        '{"layout":"p1","images":[{"file":"a.png"},…',
      ),
    ]);
    expect(note).toContain('generate_assets(p1)');
    expect(note).toContain('a.png');
  });
});
