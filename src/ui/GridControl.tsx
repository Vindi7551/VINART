import { useEffect, useRef, useState } from 'react';
import { IconGrid } from './icons';
import { DEFAULT_GRID, type GridConfig } from './grid';

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/**
 * 网格开关 + 参数卡。
 *
 * 放在右下角缩放控件里，和 zoom 同属“画布视图”，不混进左侧工具。
 * 配置本身由 PreviewPanel 持有并持久化；这里只发整份新 config。
 */
export function GridControl({
  config,
  onChange,
}: {
  config: GridConfig;
  onChange: (next: GridConfig) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const patch = (part: Partial<GridConfig>) => onChange({ ...config, ...part });
  const setInt = (key: 'columns' | 'rows' | 'margin' | 'gutter', v: number) => {
    const max = key === 'columns' || key === 'rows' ? 24 : key === 'margin' ? 1000 : 400;
    patch({ [key]: clamp(Math.round(v || 0), 0, max) });
  };

  return (
    <div className="grid-control" ref={rootRef}>
      <button
        type="button"
        className={`zoom-btn grid-btn${config.enabled ? ' active' : ''}`}
        aria-pressed={config.enabled}
        aria-expanded={open}
        title="网格（列 / 行）"
        onClick={() => setOpen((v) => !v)}
      >
        <IconGrid size={15} />
      </button>

      {open ? (
        <div className="grid-popover" role="dialog" aria-label="网格设置">
          <div className="grid-pop-head">
            <span className="grid-pop-title">网格</span>
            <span className="grid-pop-actions">
              <button
                type="button"
                className="grid-reset"
                title="重置网格"
                onClick={() => onChange({ ...DEFAULT_GRID, enabled: config.enabled })}
              >
                ↺
              </button>
              <button
                type="button"
                className={`grid-switch${config.enabled ? ' on' : ''}`}
                role="switch"
                aria-checked={config.enabled}
                aria-label="开启网格"
                onClick={() => patch({ enabled: !config.enabled })}
              >
                <span />
              </button>
            </span>
          </div>

          <div className="grid-pair">
            <label className="grid-field">
              列数
              <input
                className="grid-num"
                type="number"
                min={0}
                max={24}
                step={1}
                value={config.columns}
                onChange={(e) => setInt('columns', Number(e.target.value))}
              />
            </label>
            <label className="grid-field">
              行数
              <input
                className="grid-num"
                type="number"
                min={0}
                max={24}
                step={1}
                value={config.rows}
                onChange={(e) => setInt('rows', Number(e.target.value))}
              />
            </label>
          </div>

          <div className="grid-pair">
            <label className="grid-field">
              边距 px
              <input
                className="grid-num"
                type="number"
                min={0}
                max={1000}
                step={1}
                value={config.margin}
                onChange={(e) => setInt('margin', Number(e.target.value))}
              />
            </label>
            <label className="grid-field">
              间隔 px
              <input
                className="grid-num"
                type="number"
                min={0}
                max={400}
                step={1}
                value={config.gutter}
                onChange={(e) => setInt('gutter', Number(e.target.value))}
              />
            </label>
          </div>

          <div className="grid-row">
            <label className="grid-inline">
              线条颜色
              <input
                className="grid-color"
                type="color"
                value={config.color}
                onChange={(e) => patch({ color: e.target.value })}
              />
            </label>
            <label className="grid-inline grid-opacity">
              透明度
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round(config.opacity * 100)}
                onChange={(e) => patch({ opacity: Number(e.target.value) / 100 })}
              />
              <span className="grid-pct">{Math.round(config.opacity * 100)}%</span>
            </label>
          </div>

          {config.columns === 0 && config.rows === 0 ? (
            <div className="grid-hint">至少 1 列或 1 行</div>
          ) : null}
          <div className="grid-hint">颜色只影响参考线，不会改画布底色。</div>
        </div>
      ) : null}
    </div>
  );
}
