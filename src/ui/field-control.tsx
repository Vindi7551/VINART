import type { ReactNode } from 'react';

import type { FieldKind } from '../editor/inspector';
import { Checkbox, ColorSwatch, NumberInput, Select, TextArea, TextInput } from './primitives';
import { PaintControl } from './paint-editor';

/**
 * **字段控件** —— 把 `FieldKind` 渲染成一个输入控件。
 *
 * ## 为什么单独一份
 *
 * `EditPanel`（**节点级**：改整个元素）与 `SelectionStylePanel`（**片段级**：只改选中的那几个字）
 * 渲染的是**同一套 `kind`**。以前两边各写一份 `switch` + 各写一份 `inputStyle` ——
 * 加一种控件要改两处，漏一处就变成"整块能改、选中的字改不了"（而且这个坑已经踩过一次）。
 *
 * ⇒ 控件渲染收在这里，**两个面板都走它**。
 *
 * ## 两条不能动的规矩
 *
 * - **空值一律给 `''`，不给 0**：给 0 的话"没写"会显示成 0，用户一碰就当真值写进去。
 * - **`toggle` 必须是复选框**：做成文本框的话读回来是 `undefined`（"没写"）、
 *   写回去是字符串 `"false"` —— 经 `!!v` 变成 `true` ⇒ **永远关不掉**。
 */
export function FieldControl({
  kind,
  value,
  disabled,
  onCommit,
}: {
  kind: FieldKind;
  value: unknown;
  disabled?: boolean;
  onCommit: (v: unknown) => void;
}): ReactNode {
  switch (kind.kind) {
    case 'enum':
      return (
        <Select disabled={disabled} value={typeof value === 'string' ? value : ''} onChange={(e) => onCommit(e.target.value)}>
          <option value="">（未设置）</option>
          {kind.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </Select>
      );

    case 'toggle':
      return <Checkbox disabled={disabled} checked={value === true} onChange={(e) => onCommit(e.target.checked)} />;

    case 'color':
      return (
        <span className="ui-color-row">
          <ColorSwatch
            disabled={disabled}
            value={typeof value === 'string' && /^#[0-9a-f]{3,8}$/i.test(value) ? value.slice(0, 7) : '#000000'}
            onChange={(e) => onCommit(e.target.value)}
          />
          <TextInput
            disabled={disabled}
            value={typeof value === 'string' ? value : ''}
            placeholder="#RRGGBB"
            onChange={(e) => onCommit(e.target.value)}
          />
        </span>
      );

    case 'paint':
      return (
        <PaintControl
          value={value}
          disabled={disabled}
          allowLayers={!!kind.layers}
          hint={kind.hint}
          onCommit={onCommit}
        />
      );

    case 'number':
      return (
        <span className="ui-num-wrap">
          <NumberInput
            disabled={disabled}
            value={typeof value === 'number' && Number.isFinite(value) ? value : ''}
            // 占位符：让"**这一项没写**"看得出来是空的，而不是像坏了
            placeholder="—"
            step={kind.step ?? 0.01}
            min={kind.min}
            max={kind.max}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === '') return; // 清空不当作 0 提交
              const num = Number(raw);
              if (!Number.isNaN(num)) onCommit(num);
            }}
          />
          {kind.suffix ? <span className="ui-suffix">{kind.suffix}</span> : null}
        </span>
      );

    default: {
      const str = typeof value === 'string' ? value : '';
      // ⚠️ 多行文本（内容）必须是 textarea —— 换行是这个字段的**正常内容**
      return kind.multiline ? (
        <TextArea disabled={disabled} style={{ minHeight: 56 }} value={str} onChange={(e) => onCommit(e.target.value)} />
      ) : (
        <TextInput disabled={disabled} value={str} onChange={(e) => onCommit(e.target.value)} />
      );
    }
  }
}

/**
 * 这个 `kind` 要不要**整行宽**。
 *
 * 枚举（下拉要宽度）、取色（色块 + 十六进制串）、多行文本（内容）—— 挤在半格里没法用。
 * 数字/复选框/单行文本放半格，两列排开。
 */
export const isWideKind = (kind: FieldKind): boolean =>
  kind.kind === 'enum' || kind.kind === 'color' || kind.kind === 'paint' || (kind.kind === 'text' && !!kind.multiline);

/** 这一格要不要用"复选框在右"的排法 */
export const isCheckKind = (kind: FieldKind): boolean => kind.kind === 'toggle';
