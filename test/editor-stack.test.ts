import { describe, expect, it } from 'vitest';

import type { DesignDocument } from '../src/document/vocabulary';
import {
  createEditorStack,
  gotoStep,
  historyEntries,
  pushCommand,
  removeStep,
} from '../src/editor/editor-stack';

const doc = (width: number): DesignDocument => ({ canvas: { width, height: 100 }, layers: [] });

describe('编辑栈：历史里的第 0 步（初始状态）', () => {
  it('初始状态也在历史里，能跳回去，且不可删除', () => {
    const s = createEditorStack(doc(100));
    expect(historyEntries(s)).toHaveLength(1);
    expect(historyEntries(s)[0]).toMatchObject({ index: 0, label: '初始状态', undone: false });

    pushCommand(s, doc(200), '改画布');
    expect(historyEntries(s).map((e) => [e.index, e.undone])).toEqual([
      [0, false],
      [1, false],
    ]);
    expect(historyEntries(s)[1]?.label).toBe('改画布');

    // 点第 0 行 = 回到最初
    expect(gotoStep(s, 0)?.canvas.width).toBe(100);
    expect(historyEntries(s).map((e) => [e.index, e.undone])).toEqual([
      [0, false],
      [1, true],
    ]);
    expect(removeStep(s, 0)).toBeNull();
  });
});
