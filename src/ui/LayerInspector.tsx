import { useEffect, useState } from 'react';
import {
  Button,
  ColorSwatch,
  Field,
  NumberInput,
  Row,
  Section,
  SliderField,
  TextArea,
  TextInput,
} from './primitives';
import type { LayerAppearance, LayoutLayer } from './types';

/**
 * 选中图层的参数检查器。
 *
 * 表现层走 `primitives.tsx` 的基元（样式在 index.css 的 `.ui-*`，token 驱动）——
 * 此前这里是**零类名 + 100% 内联硬编码**（`#888` ×8、`#eef3ff`、`#ddd`…），
 * 与全站不是一套。**逻辑（色值解析 / 染色组 / 本地草稿态）一行未动。**
 */

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
    <>
      {isText && (
        <Section title="文字" hint="双击图上也可就地改；curve 改动保存后重渲生效">
          <TextArea
            rows={2}
            value={textDraft}
            onChange={(e) => setTextDraft(e.target.value)}
            onBlur={() => onPatch({ text: textDraft.includes('\n') ? textDraft.split('\n') : textDraft })}
          />
          <Row>
            <Field label="fontScale">
              <NumberInput
                step={0.005}
                value={layer.fontScale ?? 0.03}
                onChange={(e) => onPatch({ fontScale: num(e.target.value) ?? 0.03 })}
              />
            </Field>
            <Field label="weight">
              <NumberInput
                step={100}
                min={100}
                max={900}
                value={layer.weight ?? 400}
                onChange={(e) => onPatch({ weight: Number(e.target.value) })}
              />
            </Field>
            <Field label="curve">
              <NumberInput
                step={0.1}
                min={0}
                max={1}
                value={layer.curve ?? 0}
                onChange={(e) => onPatch({ curve: Number(e.target.value) })}
              />
            </Field>
          </Row>
        </Section>
      )}

      <Section title="位置与尺寸">
        <Row>
          <Field label="x">
            <NumberInput
              step={0.005}
              value={layer.rect.x}
              onChange={(e) => onPatch({ rect: { ...layer.rect, x: Number(e.target.value) } })}
            />
          </Field>
          <Field label="y">
            <NumberInput
              step={0.005}
              value={layer.rect.y}
              onChange={(e) => onPatch({ rect: { ...layer.rect, y: Number(e.target.value) } })}
            />
          </Field>
        </Row>
        <Row>
          <Field label="w">
            <NumberInput
              step={0.005}
              value={layer.rect.w}
              onChange={(e) => onPatch({ rect: { ...layer.rect, w: Number(e.target.value) } })}
            />
          </Field>
          <Field label="h">
            <NumberInput
              step={0.005}
              value={layer.rect.h}
              onChange={(e) => onPatch({ rect: { ...layer.rect, h: Number(e.target.value) } })}
            />
          </Field>
        </Row>
      </Section>

      {/* ── 颜色:单行,上下文感知——点图上哪个词就编辑哪个词的颜色 ── */}
      <Section
        title="颜色"
        hint={
          onBase
            ? '当前:全部文字(基色)——点击图上的染色词可单独改它'
            : `当前:「${activeWord}」的染色(点图上其他位置切回基色)`
        }
      >
        <div className="ui-row">
          <ColorSwatch
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
          />
          <TextInput
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
        <SliderField
          label="颜色透明度"
          value={alpha}
          onChange={(pct) => {
            setAlpha(pct);
            const next = withAlpha(colorVal, pct / 100, palette);
            if (next) onPatch({ [colorKey]: next });
          }}
        />
      </Section>

      {/* 染色组管理:基色之外的颜色构成,可增删(数量不限) */}
      {isText && (
        <Section
          title={`染色词(${groups.length})`}
          divider
          hint="新组染色保存后重渲生效;点图上的染色词可单独调色"
        >
          {groups.map((g, gi) => (
            <div key={gi} className="ui-row">
              <TextInput
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
              <ColorSwatch
                value={toHex(g.color, palette)}
                onChange={(e) => {
                  const next = groups.map((x, i) =>
                    i === gi ? { ...x, color: e.target.value } : x,
                  );
                  onPatch({ accents: next });
                }}
              />
              <Button
                variant="icon"
                title="删除该组"
                onClick={() => {
                  const next = groups.filter((_, i) => i !== gi);
                  onPatch({ accents: next });
                }}
              >
                ×
              </Button>
            </div>
          ))}
          {addOpen ? (
            <div className="ui-row">
              <TextInput
                autoFocus
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
            <Button onClick={() => setAddOpen(true)}>+ 高亮词</Button>
          )}
        </Section>
      )}

      <Section hint="颜色透明度只淡色值;图层透明度整层淡出(含描边)。">
        <SliderField
          label="图层透明度"
          value={Math.round((appearance.opacity ?? 1) * 100)}
          onChange={(pct) => onPatch({ opacity: pct / 100 })}
        />
      </Section>
    </>
  );
}
