import { useState, type CSSProperties } from 'react';

import {
  DEFAULT_STOPS,
  parsePaintCss,
  serializePaint,
  type PaintDraft,
  type PaintType,
} from '../editor/paint';
import { Button, ColorSwatch, Dialog, NumberInput, Select, TextInput } from './primitives';

/**
 * **颜色 / 渐变编辑器** —— 面板里所有 `paint` 字段共用。
 *
 * 支持：
 * - 纯色 / 线性渐变 / 径向渐变；
 * - 渐变停靠点（颜色 + 偏移）、角度、radial 形状/位置/尺寸；
 * - 多层 fill（数组靠前在底层、靠后在顶层；列表按“顶层在上”展示）；
 * - 解析不了的值（conic、图片、`in oklab` 等）走“原始 CSS”编辑，不丢原值。
 *
 * 渲染侧解析在 `render/vocabulary/emit.ts`；这里只负责“人怎么填”。
 */

const isGradient = (s: string): boolean => /gradient\(/i.test(s);

function toLayers(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string' && !!v.trim());
  if (typeof value === 'string' && value.trim()) return [value];
  return [];
}

/** 预览：渐变/图片层叠在纯色底上（CSS background-image 的第一个在最上） */
function previewStyle(layers: string[]): CSSProperties {
  const checker = 'linear-gradient(45deg, #e6e6ec 25%, transparent 25%, transparent 75%, #e6e6ec 75%)';
  if (!layers.length) return { background: '#e9e9ef' };
  const images = layers.filter((l) => isGradient(l) || /^url\(/i.test(l));
  const solids = layers.filter((l) => !images.includes(l));
  const base = [...solids].reverse()[0];
  const imagesCss = [...images].reverse();
  const sizes = [...imagesCss.map(() => 'auto'), '10px 10px', '10px 10px'];
  const positions = [...imagesCss.map(() => '0 0'), '0 0', '5px 5px'];
  return {
    backgroundColor: base ?? '#f5f5f5',
    backgroundImage: [...imagesCss, checker, checker].join(', '),
    backgroundSize: sizes.join(', '),
    backgroundPosition: positions.join(', '),
  };
}

export function PaintControl({
  value,
  disabled,
  allowLayers,
  hint,
  onCommit,
}: {
  value: unknown;
  disabled?: boolean;
  allowLayers?: boolean;
  hint?: string;
  onCommit: (v: string | string[] | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const arr = Array.isArray(value) ? toLayers(value) : [];
  const single = typeof value === 'string' ? value : '';
  const layers = arr.length ? arr : single ? [single] : [];
  const summary = !layers.length ? '' : arr.length > 1 ? `${arr.length} 层` : single || arr[0] || '';

  return (
    <>
      <span className="ui-paint-row">
        <button
          type="button"
          className="ui-paint-preview"
          style={previewStyle(layers)}
          disabled={disabled}
          title="编辑颜色 / 渐变"
          onClick={() => !disabled && setOpen(true)}
        />
        {arr.length ? (
          <TextInput className="ui-paint-text" disabled value={summary} readOnly />
        ) : (
          <TextInput
            className="ui-paint-text"
            disabled={disabled}
            value={single}
            placeholder="纯色 / 渐变"
            onChange={(e) => onCommit(e.target.value.trim() ? e.target.value : undefined)}
          />
        )}
        <Button
          variant="ghost"
          className="sq tiny"
          disabled={disabled}
          title="编辑颜色 / 渐变"
          onClick={() => setOpen(true)}
        >
          编辑
        </Button>
        {layers.length ? (
          <Button
            variant="ghost"
            className="sq tiny"
            disabled={disabled}
            title="清除"
            onClick={() => onCommit(undefined)}
          >
            ✕
          </Button>
        ) : null}
      </span>
      {open ? (
        <PaintDialog
          value={value}
          allowLayers={!!allowLayers}
          hint={hint}
          onClose={() => setOpen(false)}
          onApply={(v) => {
            onCommit(v);
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

function PaintDialog({
  value,
  allowLayers,
  hint,
  onClose,
  onApply,
}: {
  value: unknown;
  allowLayers: boolean;
  hint?: string;
  onClose: () => void;
  onApply: (v: string | string[] | undefined) => void;
}) {
  const wasArray = Array.isArray(value);
  const initial = toLayers(value);
  const [drafts, setDrafts] = useState<PaintDraft[]>(() => {
    const list = initial.length ? initial : ['#000000'];
    return list.map((s) => parsePaintCss(s));
  });
  const [selected, setSelected] = useState(() => Math.max(0, drafts.length - 1));
  const d = drafts[selected] ?? parsePaintCss('#000000');

  const update = (patch: Partial<PaintDraft>) =>
    setDrafts((ds) => ds.map((x, i) => (i === selected ? { ...x, ...patch } : x)));
  const updateStop = (idx: number, patch: Partial<PaintDraft['stops'][number]>) =>
    setDrafts((ds) =>
      ds.map((x, i) =>
        i === selected ? { ...x, stops: x.stops.map((s, j) => (j === idx ? { ...s, ...patch } : s)) } : x,
      ),
    );

  const setType = (type: PaintType) => {
    update({
      type,
      parsed: true,
      ...(type !== 'solid' && d.stops.length < 2 ? { stops: DEFAULT_STOPS.map((s) => ({ ...s })) } : {}),
    });
  };

  const addLayer = () => {
    const next = [...drafts, parsePaintCss('#000000')];
    setDrafts(next);
    setSelected(next.length - 1);
  };
  const removeLayer = () => {
    if (drafts.length <= 1) return;
    const next = drafts.filter((_, i) => i !== selected);
    setDrafts(next);
    setSelected(Math.max(0, Math.min(selected, next.length - 1)));
  };
  const moveLayer = (dir: 1 | -1) => {
    const j = selected + dir;
    if (j < 0 || j >= drafts.length) return;
    const next = [...drafts];
    [next[selected], next[j]] = [next[j]!, next[selected]!];
    setDrafts(next);
    setSelected(j);
  };

  const apply = () => {
    const css = drafts.map((x) => serializePaint(x)).filter(Boolean);
    if (!css.length) {
      onApply(undefined);
      onClose();
      return;
    }
    const out: string | string[] = allowLayers
      ? wasArray || css.length > 1
        ? css
        : css[0]!
      : css[0]!;
    onApply(out);
    onClose();
  };

  const stack = drafts.map((x) => serializePaint(x));
  const typeOptions: Array<{ v: PaintType; label: string }> = [
    { v: 'solid', label: '纯色' },
    { v: 'linear', label: '线性渐变' },
    { v: 'radial', label: '径向渐变' },
  ];

  return (
    <Dialog
      open
      onClose={onClose}
      title="颜色 / 渐变"
      width={680}
      maxHeight={660}
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={apply}>
            应用
          </Button>
        </>
      }
    >
      <div className="ui-paint-dialog">
        <div className="ui-paint-big-preview" style={previewStyle(stack)} />
        {hint ? <div className="ui-paint-hint">{hint}</div> : null}

        {allowLayers ? (
          <div className="ui-paint-layers">
            <div className="ui-paint-layers-head">
              <span>图层（顶层在上）</span>
              <span className="ui-paint-layers-actions">
                <Button variant="ghost" className="sq tiny" title="上移一层" onClick={() => moveLayer(1)}>
                  ↑
                </Button>
                <Button variant="ghost" className="sq tiny" title="下移一层" onClick={() => moveLayer(-1)}>
                  ↓
                </Button>
                <Button variant="ghost" className="sq tiny" title="删除这一层" onClick={removeLayer}>
                  ✕
                </Button>
              </span>
            </div>
            {[...drafts]
              .map((x, i) => (
                <button
                  type="button"
                  key={i}
                  className={`ui-paint-layer${i === selected ? ' active' : ''}`}
                  onClick={() => setSelected(i)}
                >
                  <span className="ui-paint-layer-preview" style={previewStyle([serializePaint(x)])} />
                  <span className="ui-paint-layer-name">
                    {i === drafts.length - 1 ? '顶层' : i === 0 ? '底层' : `第 ${i + 1} 层`}
                  </span>
                  <span className="ui-paint-layer-kind">
                    {!x.parsed ? '原始 CSS' : x.type === 'solid' ? '纯色' : x.type === 'linear' ? '线性' : '径向'}
                  </span>
                </button>
              ))
              .reverse()}
            <Button className="ui-paint-add" onClick={addLayer}>
              ＋ 添加一层
            </Button>
          </div>
        ) : null}

        <div className="ui-paint-editor">
          <div className="ui-paint-rowline">
            <span className="ui-paint-label">类型</span>
            <Select value={d.parsed ? d.type : 'raw'} onChange={(e) => (e.target.value === 'raw' ? undefined : setType(e.target.value as PaintType))}>
              {typeOptions.map((o) => (
                <option key={o.v} value={o.v}>
                  {o.label}
                </option>
              ))}
              {!d.parsed ? <option value="raw">原始 CSS</option> : null}
            </Select>
          </div>

          {!d.parsed ? (
            <>
              <div className="ui-paint-hint">当前值不是简单的纯色 / 线性 / 径向渐变，可直接编辑原始 CSS；也可以在上面选一种类型重写。</div>
              <TextInput
                value={d.raw}
                placeholder="例如 linear-gradient(90deg, #C8323C, #B8722F)"
                onChange={(e) => update({ raw: e.target.value, parsed: false })}
              />
            </>
          ) : d.type === 'solid' ? (
            <div className="ui-paint-rowline">
              <span className="ui-paint-label">颜色</span>
              <span className="ui-paint-color">
                <ColorSwatch
                  value={/^#[0-9a-f]{6}$/i.test(d.solid) ? d.solid : '#000000'}
                  onChange={(e) => update({ solid: e.target.value, parsed: true })}
                />
                <TextInput value={d.solid} onChange={(e) => update({ solid: e.target.value, parsed: true })} />
              </span>
            </div>
          ) : (
            <>
              {d.type === 'linear' ? (
                <div className="ui-paint-rowline">
                  <span className="ui-paint-label">角度</span>
                  <NumberInput
                    value={Math.round(d.angle)}
                    min={0}
                    max={360}
                    step={1}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (e.target.value !== '' && Number.isFinite(v)) update({ angle: v });
                    }}
                  />
                  <span className="ui-suffix">°</span>
                </div>
              ) : (
                <>
                  <div className="ui-paint-rowline">
                    <span className="ui-paint-label">形状</span>
                    <Select value={d.shape} onChange={(e) => update({ shape: e.target.value as 'circle' | 'ellipse' })}>
                      <option value="circle">circle</option>
                      <option value="ellipse">ellipse</option>
                    </Select>
                    <span className="ui-paint-label">尺寸</span>
                    <Select value={d.size} onChange={(e) => update({ size: e.target.value })}>
                      <option value="">默认（farthest-corner）</option>
                      <option value="closest-side">closest-side</option>
                      <option value="closest-corner">closest-corner</option>
                      <option value="farthest-side">farthest-side</option>
                      <option value="farthest-corner">farthest-corner</option>
                      <option value="custom">自定义 %</option>
                    </Select>
                  </div>
                  <div className="ui-paint-rowline">
                    <span className="ui-paint-label">圆心</span>
                    <NumberInput
                      value={Math.round(d.cx)}
                      min={0}
                      max={100}
                      step={1}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (e.target.value !== '' && Number.isFinite(v)) update({ cx: v });
                      }}
                    />
                    <span className="ui-suffix">%</span>
                    <NumberInput
                      value={Math.round(d.cy)}
                      min={0}
                      max={100}
                      step={1}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (e.target.value !== '' && Number.isFinite(v)) update({ cy: v });
                      }}
                    />
                    <span className="ui-suffix">%</span>
                  </div>
                  {d.size === 'custom' ? (
                    <div className="ui-paint-rowline">
                      <span className="ui-paint-label">半径</span>
                      <NumberInput
                        value={Math.round(d.rx)}
                        min={1}
                        max={200}
                        step={1}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          if (e.target.value !== '' && Number.isFinite(v)) update({ rx: v });
                        }}
                      />
                      <span className="ui-suffix">%</span>
                      {d.shape === 'ellipse' ? (
                        <>
                          <NumberInput
                            value={Math.round(d.ry)}
                            min={1}
                            max={200}
                            step={1}
                            onChange={(e) => {
                              const v = Number(e.target.value);
                              if (e.target.value !== '' && Number.isFinite(v)) update({ ry: v });
                            }}
                          />
                          <span className="ui-suffix">%</span>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </>
              )}

              <div className="ui-paint-stops">
                <div className="ui-paint-stops-head">
                  <span>色标</span>
                  <Button
                    variant="ghost"
                    className="sq tiny"
                    title="添加色标"
                    onClick={() => update({ stops: [...d.stops, { color: '#ffffff', offset: 50 }] })}
                  >
                    ＋
                  </Button>
                </div>
                {d.stops.map((s, i) => (
                  <div className="ui-paint-stop" key={i}>
                    <span className="ui-paint-color">
                      <ColorSwatch
                        value={/^#[0-9a-f]{6}$/i.test(s.color) ? s.color : '#000000'}
                        onChange={(e) => updateStop(i, { color: e.target.value })}
                      />
                      <TextInput value={s.color} onChange={(e) => updateStop(i, { color: e.target.value })} />
                    </span>
                    <NumberInput
                      value={Math.round(s.offset)}
                      min={0}
                      max={100}
                      step={1}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (e.target.value !== '' && Number.isFinite(v)) updateStop(i, { offset: v });
                      }}
                    />
                    <Button
                      variant="ghost"
                      className="sq tiny"
                      title="删除这个色标"
                      disabled={d.stops.length <= 2}
                      onClick={() => update({ stops: d.stops.filter((_, j) => j !== i) })}
                    >
                      ✕
                    </Button>
                  </div>
                ))}
              </div>

              <div className="ui-paint-raw">
                <span className="ui-paint-label">高级：原始 CSS</span>
                <TextInput
                  value={serializePaint(d)}
                  onChange={(e) => update({ raw: e.target.value, parsed: false })}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}
