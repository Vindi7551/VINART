import type { SelectionSnapshot, SelectionValue } from '../editor/inspector';

/**
 * **文字选区样式面板** —— 「在画面上选中几个字，只改那几个字」。
 *
 * ## 它为什么独立成一个组件
 *
 * 它和 `EditPanel` 是**两种东西**：`EditPanel` 改的是**整个节点**（位置 / 尺寸 / 整块字号…），
 * 这一栏改的是**选中的那几个字**（片段级样式）。混在一起会让人分不清
 * "我改的是整块还是这几个字"。
 *
 * ## 数据从哪来
 *
 * 全靠编辑器给的**选区快照**（`VocabEditorHandle.selectionSnapshot()`）：
 * 每一项都带着 `path` / `label` / `kind` / **此刻的生效值**。
 * ⇒ 面板**不碰 `runs`、不知道 `RunPatch`**，改的时候只把 `(path, value)` 递回去
 * （px → 0–1 换算、装饰线的逐项合并都在编辑器里做）。
 *
 * ⚠️ 快照是**一次性**的：选区一变，App 会拿新的快照重画这一栏。别在本地缓存它。
 */

/** 跟 `EditPanel` 用同一套输入框样式（窄栏里要一致） */
const inputStyle: React.CSSProperties = {
  width: '100%',
  minWidth: 0,
  fontSize: 12,
  padding: '2px 4px',
  border: '1px solid var(--border, #d5d5dd)',
  borderRadius: 4,
  background: 'var(--bg-input, #fff)',
  color: 'inherit',
  boxSizing: 'border-box',
};

export interface SelectionStylePanelProps {
  /** 选区快照；`null` = 没在选字 */
  selection: SelectionSnapshot | null;
  /** 把面板上的改动递回编辑器（`path` + 新值） */
  onStyle: (path: string, value: unknown) => void;
}

export function SelectionStylePanel({ selection, onStyle }: SelectionStylePanelProps) {
  if (!selection) return null;

  const renderControl = (f: SelectionValue) => {
    const v = f.value;
    const commit = (next: unknown) => onStyle(f.path, next);

    switch (f.kind.kind) {
      case 'enum':
        return (
          <select style={inputStyle} value={typeof v === 'string' ? v : ''} onChange={(e) => commit(e.target.value)}>
            <option value="">（未设置）</option>
            {f.kind.options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        );

      case 'toggle':
        // ⚠️ 复选框写回的是 **显式 boolean**（三态里的"要"与"明确不要"）——
        //    做成文本框的话，读回来是 `undefined`、写回去是字符串 "false"，
        //    经 `!!v` 变成 true ⇒ **永远关不掉**（`EditPanel` 踩过同一个坑）。
        return (
          <input
            type="checkbox"
            checked={v === true}
            style={{ width: 14, height: 14, margin: 0, cursor: 'pointer' }}
            onChange={(e) => commit(e.target.checked)}
          />
        );

      case 'color':
        return (
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input
              type="color"
              value={typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v) ? v.slice(0, 7) : '#000000'}
              style={{
                width: 26,
                height: 20,
                padding: 0,
                border: '1px solid var(--border, #d5d5dd)',
                borderRadius: 4,
                background: 'none',
              }}
              onChange={(e) => commit(e.target.value)}
            />
            <input
              type="text"
              style={inputStyle}
              value={typeof v === 'string' ? v : ''}
              placeholder="#RRGGBB"
              onChange={(e) => commit(e.target.value)}
            />
          </span>
        );

      case 'number':
        return (
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, width: '100%' }}>
            <input
              type="number"
              style={inputStyle}
              // ⚠️ 空值给 `''`：给 0 的话"没写"会显示成 0，用户一碰就当真值写进去
              value={typeof v === 'number' && Number.isFinite(v) ? v : ''}
              step={f.kind.step ?? 0.01}
              min={f.kind.min}
              max={f.kind.max}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === '') return;
                const num = Number(raw);
                if (!Number.isNaN(num)) commit(num);
              }}
            />
            {f.kind.suffix && <span style={{ color: '#888', fontSize: 11 }}>{f.kind.suffix}</span>}
          </span>
        );

      default:
        return (
          <input
            type="text"
            style={inputStyle}
            value={typeof v === 'string' ? v : ''}
            onChange={(e) => commit(e.target.value)}
          />
        );
    }
  };

  return (
    <div
      style={{
        marginBottom: 12,
        padding: '8px 8px 6px',
        border: '1px solid var(--accent, #6c5ce7)',
        borderRadius: 6,
        background: 'rgba(108,92,231,0.06)',
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 2, color: 'var(--accent, #6c5ce7)' }}>
        选中的字（{selection.text.length} 个）
      </div>
      {/* 把选中的内容显示出来 —— 让人确认"我确实改的是这几个字" */}
      <div
        style={{
          fontSize: 11,
          color: '#666',
          marginBottom: 6,
          maxHeight: 34,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={selection.text}
      >
        “{selection.text}”
      </div>

      {selection.fields.map((f) => (
        <label
          key={f.path}
          style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '3px 0', fontSize: 12 }}
        >
          <span style={{ width: 92, flex: '0 0 92px', color: '#555' }}>{f.label}</span>
          <span style={{ flex: 1, minWidth: 0 }}>{renderControl(f)}</span>
        </label>
      ))}
    </div>
  );
}
