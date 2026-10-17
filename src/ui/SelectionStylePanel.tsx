import type { SelectionSnapshot } from '../editor/inspector';
import { Field as FieldRow, FieldGrid, Hint } from './primitives';
import { FieldControl, isCheckKind, isWideKind } from './field-control';
import { IconCaretText } from './icons';

/**
 * **文字选区样式面板** —— 「在画面上选中几个字，只改那几个字」。
 *
 * ## 它为什么独立成一个组件
 *
 * 它和 `EditPanel` 是**两种东西**：`EditPanel` 改的是**整个节点**（位置 / 尺寸 / 整块字号…），
 * 这一栏改的是**选中的那几个字**（片段级样式）。混在一起会让人分不清
 * "我改的是整块还是这几个字"。⇒ 独立一块、置顶、**强调色边框**。
 *
 * ## 数据从哪来
 *
 * 全靠编辑器给的**选区快照**（`VocabEditorHandle.selectionSnapshot()`）：
 * 每一项都带着 `path` / `label` / `kind` / **此刻的生效值**。
 * ⇒ 面板**不碰 `runs`、不知道 `RunPatch`**，改的时候只把 `(path, value)` 递回去
 * （装饰线的逐项合并等在编辑器里做）。
 *
 * ⚠️ 快照是**一次性**的：选区一变，App 会拿新的快照重画这一栏。别在本地缓存它。
 *
 * ⚠️ 控件渲染**与 `EditPanel` 共用一份**（`FieldControl`）—— 以前两边各写一份 switch，
 *    加一种控件漏一处就变成"整块能改、选中的字改不了"。
 */
export interface SelectionStylePanelProps {
  /** 选区快照；`null` = 没在选字 */
  selection: SelectionSnapshot | null;
  /** 把面板上的改动递回编辑器（`path` + 新值） */
  onStyle: (path: string, value: unknown) => void;
}

export function SelectionStylePanel({ selection, onStyle }: SelectionStylePanelProps) {
  if (!selection) return null;

  return (
    <div className="ui-selection ui-section">
      <div className="ui-section-head">
        <span className="ui-section-icon">
          <IconCaretText />
        </span>
        <span className="ui-section-title">选中的字</span>
        <span className="ui-section-count">{selection.text.length}</span>
      </div>
      {/* 把选中的内容显示出来 —— 让人确认"我确实改的是这几个字" */}
      <div className="ui-selection-text" title={selection.text}>
        “{selection.text}”
      </div>
      <FieldGrid>
        {selection.fields.map((f) => (
          <FieldRow
            key={f.path}
            label={f.label}
            className={`${isWideKind(f.kind) ? 'wide' : ''}${isCheckKind(f.kind) ? ' check' : ''}`.trim()}
          >
            <FieldControl kind={f.kind} value={f.value} onCommit={(v) => onStyle(f.path, v)} />
          </FieldRow>
        ))}
      </FieldGrid>
      {selection.fields.length === 0 ? <Hint>这几个字没有可改的样式</Hint> : null}
    </div>
  );
}
