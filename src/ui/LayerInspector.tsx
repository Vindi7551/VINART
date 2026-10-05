import { useEffect, useState } from 'react';
import type { LayerAppearance, LayoutLayer } from './types';

// ══════════════════════════════════════════════
// 色值工具:与 iframe 内编辑脚本同一套语义(#RRGGBBAA 只淡色值不淡整层)
// ══════════════════════════════════════════════

type Palette = Record<string, string>;

function parseColor(v: unknown, pal: Palette): { r: number; g: number; b: number } | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  const m = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/.exec(s);
  if (m)
    return {
      r: parseInt(m[1].slice(0, 2), 16),
      g: parseInt(m[1].slice(2, 4), 16),
      b: parseInt(m[1].slice(4, 6), 16),
    };
  const r = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(s);
  if (r) return { r: +r[1], g: +r[2], b: +r[3] };
  if (pal[s]) return parseColor(pal[s], pal);
  return null;
}

function withAlpha(v: unknown, a: number, pal: Palette): string | null {
  const c = parseColor(v, pal);
  if (!c) return null;
  const h2 = (n: number) => Math.round(n).toString(16).padStart(2, '0');
  return `#${h2(c.r)}${h2(c.g)}${h2(c.b)}${h2(a * 255)}`;
}

function alphaOf(v: unknown, pal: Palette): number {
  if (typeof v !== 'string') return 1;
  const m = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/.exec(v.trim());
  if (m && m[2]) return parseInt(m[2], 16) / 255;
  const r = /^rgba?\([^)]*,\s*([\d.]+)\s*\)$/.exec(v.trim());
  if (r) return +r[1];
  if (pal[v.trim()]) return alphaOf(pal[v.trim()], pal);
  return 1;
}

function toHex(v: unknown, pal: Palette): string {
  if (typeof v !== 'string') return '#888888';
  const m = /^#([0-9a-fA-F]{6})$/.exec(v.trim());
  if (m) return '#' + m[1];
  const resolved = pal[v.trim()];
  return resolved && /^#[0-9a-fA-F]{6}$/.test(resolved) ? resolved : '#888888';
}

// ══════════════════════════════════════════════

interface LayerInspectorProps {
  layer: LayoutLayer;
  appearance: LayerAppearance;
  palette: Palette;
  /** 当前激活的染色词(点击图上染色片段切换;空 = 全部文字/基色) */
  activeWord?: string | null;
  /** 新增高亮词时回调(宿主把该词设为激活,单行颜色立即指向它) */
  onActivateWord?: (word: string) => void;
  /** 任意属性变更(React 合并进 spec/appearance 后经 postMessage 打回 iframe) */
  onPatch: (patch: Record<string, unknown>) => void;
  onBack?: () => void;
}

const inputStyle: React.CSSProperties = { width: 64 };

export function LayerInspector({
  layer,
  appearance,
  palette,
  activeWord,
  onActivateWord,
  onPatch,
}: LayerInspectorProps) {
  const isText = layer.type === 'text';
  const isShape = layer.type === 'shape';
  const colorKey = isShape ? 'fill' : 'color';
  const colorVal = (appearance as Record<string, unknown>)[colorKey];

  // 文本本地态:避免每敲一个字都全量 patch——失焦/回车才提交
  const [textDraft, setTextDraft] = useState(() =>
    Array.isArray(layer.text) ? layer.text.join('\n') : String(layer.text ?? ''),
  );
  useEffect(() => {
    setTextDraft(Array.isArray(layer.text) ? layer.text.join('\n') : String(layer.text ?? ''));
  }, [layer.id, layer.text]);

  const [alpha, setAlpha] = useState(() => Math.round(alphaOf(colorVal, palette) * 100));
  useEffect(() => {
    setAlpha(Math.round(alphaOf(colorVal, palette) * 100));
  }, [colorVal, palette]);

  // ── 颜色构成:基色 + N 组染色词(单行颜色跟随「激活片段」切换)──
  const acc = (appearance as Record<string, unknown>).accent as
    | { words: string[]; color: string }
    | undefined;
  const groups: { words: string[]; color: string }[] =
    ((appearance as Record<string, unknown>).accents as
      | { words: string[]; color: string }[]
      | undefined) ?? (acc ? [acc] : []);
  const activeGroup =
    activeWord && activeWord !== '__base__'
      ? groups.find((g) => g.words.includes(activeWord))
      : null;
  const onBase = !activeGroup; // 无激活词或激活词无组 → 编辑基色
  const currentColor = onBase ? colorVal : activeGroup!.color;

  const [addOpen, setAddOpen] = useState(false);
  const [addDraft, setAddDraft] = useState('');

  const num = (v: string) => (v === '' ? undefined : Number(v));

  return (
    <div style={{ fontSize: 12, lineHeight: 1.9 }}>
      <h4 style={{ margin: '0 0 6px' }}>
        {layer.id} <small style={{ color: '#888', fontWeight: 400 }}>({layer.type})</small>
      </h4>

      {isText && (
        <>
          <div>
            文字(双击图上也可就地改)
            <br />
            <textarea
              rows={2}
              style={{ width: '96%' }}
              value={textDraft}
              onChange={(e) => setTextDraft(e.target.value)}
              onBlur={() => onPatch({ text: textDraft.includes('\n') ? textDraft.split('\n') : textDraft })}
            />
          </div>
          <div>
            fontScale{' '}
            <input
              type="number"
              step={0.005}
              style={inputStyle}
              value={layer.fontScale ?? 0.03}
              onChange={(e) => onPatch({ fontScale: num(e.target.value) ?? 0.03 })}
            />{' '}
            weight{' '}
            <input
              type="number"
              step={100}
              min={100}
              max={900}
              style={{ width: 60 }}
              value={layer.weight ?? 400}
              onChange={(e) => onPatch({ weight: Number(e.target.value) })}
            />{' '}
            curve{' '}
            <input
              type="number"
              step={0.1}
              min={0}
              max={1}
              style={{ width: 52 }}
              value={layer.curve ?? 0}
              onChange={(e) => onPatch({ curve: Number(e.target.value) })}
            />
            <br />
            <small style={{ color: '#888' }}>curve 改动保存后重渲生效</small>
          </div>
        </>
      )}

      <div>
        x{' '}
        <input
          type="number"
          step={0.005}
          style={inputStyle}
          value={layer.rect.x}
          onChange={(e) => onPatch({ rect: { ...layer.rect, x: Number(e.target.value) } })}
        />{' '}
        y{' '}
        <input
          type="number"
          step={0.005}
          style={inputStyle}
          value={layer.rect.y}
          onChange={(e) => onPatch({ rect: { ...layer.rect, y: Number(e.target.value) } })}
        />
        <br />
        w{' '}
        <input
          type="number"
          step={0.005}
          style={inputStyle}
          value={layer.rect.w}
          onChange={(e) => onPatch({ rect: { ...layer.rect, w: Number(e.target.value) } })}
        />{' '}
        h{' '}
        <input
          type="number"
          step={0.005}
          style={inputStyle}
          value={layer.rect.h}
          onChange={(e) => onPatch({ rect: { ...layer.rect, h: Number(e.target.value) } })}
        />
      </div>

      {/* ── 颜色:单行,上下文感知——点图上哪个词就编辑哪个词的颜色 ── */}
      <div>
        {isShape ? 'fill' : 'color'}{' '}
        <input
          type="color"
          style={{ width: 48, height: 24, verticalAlign: 'middle' }}
          value={toHex(currentColor, palette)}
          onChange={(e) =>
            onBase
              ? onPatch({ [colorKey]: e.target.value })
              : onPatch({
                  accents: groups.map((g) =>
                    g === activeGroup ? { ...g, color: e.target.value } : g,
                  ),
                })
          }
        />{' '}
        <input
          style={{ width: 110 }}
          placeholder="角色名或#hex"
          value={String(currentColor ?? '')}
          onChange={(e) =>
            onBase
              ? onPatch({ [colorKey]: e.target.value })
              : onPatch({
                  accents: groups.map((g) =>
                    g === activeGroup ? { ...g, color: e.target.value } : g,
                  ),
                })
          }
        />
      </div>
      <small style={{ color: '#888' }}>
        {onBase
          ? '当前:全部文字(基色)——点击图上的染色词可单独改它'
          : `当前:「${activeWord}」的染色(点图上其他位置切回基色)`}
      </small>

      <div>
        颜色透明度{' '}
        <input
          type="range"
          min={0}
          max={100}
          style={{ width: 120, verticalAlign: 'middle' }}
          value={alpha}
          onChange={(e) => {
            const pct = Number(e.target.value);
            setAlpha(pct);
            const next = withAlpha(colorVal, pct / 100, palette);
            if (next) onPatch({ [colorKey]: next });
          }}
        />{' '}
        <span>{alpha}%</span>
      </div>

      {/* 染色组管理:基色之外的颜色构成,可增删(数量不限) */}
      {isText && (
        <div style={{ borderTop: '1px dashed #ddd', marginTop: 4, paddingTop: 4 }}>
          <div style={{ marginBottom: 2, color: '#888' }}>染色词({groups.length})</div>
          {groups.map((g, gi) => (
            <div key={gi} style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 2 }}>
              <input
                style={{ flex: 1, minWidth: 0 }}
                value={g.words.join(', ')}
                onChange={(e) => {
                  const words = e.target.value
                    .split(/[,，]/)
                    .map((s) => s.trim())
                    .filter(Boolean);
                  const next = groups.map((x, i) => (i === gi ? { ...x, words } : x));
                  onPatch({ accents: next });
                }}
              />
              <input
                type="color"
                style={{ width: 36, height: 22 }}
                value={toHex(g.color, palette)}
                onChange={(e) => {
                  const next = groups.map((x, i) =>
                    i === gi ? { ...x, color: e.target.value } : x,
                  );
                  onPatch({ accents: next });
                }}
              />
              <button
                style={{ cursor: 'pointer' }}
                title="删除该组"
                onClick={() => {
                  const next = groups.filter((_, i) => i !== gi);
                  onPatch({ accents: next });
                }}
              >
                ×
              </button>
            </div>
          ))}
          {addOpen ? (
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <input
                autoFocus
                style={{ flex: 1, minWidth: 0 }}
                placeholder="要染色的词,逗号分隔"
                value={addDraft}
                onChange={(e) => setAddDraft(e.target.value)}
                onBlur={() => setAddOpen(false)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const words = addDraft
                      .split(/[,，]/)
                      .map((s) => s.trim())
                      .filter(Boolean);
                    if (words.length) {
                      onPatch({ accents: [...groups, { words, color: 'accent' }] });
                      onActivateWord?.(words[0]);
                    }
                    setAddOpen(false);
                    setAddDraft('');
                  }
                }}
              />
            </div>
          ) : (
            <button style={{ cursor: 'pointer' }} onClick={() => setAddOpen(true)}>
              + 高亮词
            </button>
          )}
          <small style={{ color: '#888', display: 'block' }}>
            新组染色保存后重渲生效;点图上的染色词可单独调色
          </small>
        </div>
      )}

      <div>
        图层透明度{' '}
        <input
          type="range"
          min={0}
          max={100}
          style={{ width: 120, verticalAlign: 'middle' }}
          value={Math.round((appearance.opacity ?? 1) * 100)}
          onChange={(e) => onPatch({ opacity: Number(e.target.value) / 100 })}
        />{' '}
        <span>{Math.round((appearance.opacity ?? 1) * 100)}%</span>
      </div>
      <small style={{ color: '#888' }}>
        颜色透明度只淡色值;图层透明度整层淡出(含描边)。
      </small>
    </div>
  );
}
