import { useEffect, useRef, useState } from 'react';
import type { ThinkingLevel } from './types';

const LEVELS = ['off', 'low', 'high', 'max'] as const satisfies readonly ThinkingLevel[];
const LABELS: Record<ThinkingLevel, string> = {
  off: '关',
  low: '低',
  high: '高',
  max: '极高',
};

/**
 * 推理强度控制：折叠态就是「模型名 + 当前档位 + ▾」，
 * 展开后是一张滑杆卡（4 档：关 / 低 / 高 / 极高）。
 *
 * - 拖动时旋钮**连续跟手**，松手才吸附到最近档位；
 * - 点轨道 / 键盘 ← → / Home / End 也能切档；
 * - 点外部或 Esc 关闭；↺ 重置为「关」。
 */
export function ThinkingControl({
  modelName,
  value,
  onChange,
}: {
  modelName?: string | null;
  value: ThinkingLevel;
  onChange: (v: ThinkingLevel) => void;
}) {
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dragPct, setDragPct] = useState(0);
  const [dragIdx, setDragIdx] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const dragPctRef = useRef(0);
  const dragIdxRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const lastXRef = useRef(0);

  const idx = Math.max(0, LEVELS.indexOf(value));
  const stopPct = (idx / (LEVELS.length - 1)) * 100;
  const activeIdx = dragging ? dragIdx : idx;
  const displayPct = dragging ? dragPct : stopPct;

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

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  const applyDrag = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (clientX - r.left) / Math.max(1, r.width)));
    dragPctRef.current = t * 100;
    dragIdxRef.current = Math.round(t * (LEVELS.length - 1));
    setDragPct(dragPctRef.current);
    setDragIdx(dragIdxRef.current);
  };

  const scheduleDrag = (clientX: number) => {
    lastXRef.current = clientX;
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      applyDrag(lastXRef.current);
    });
  };

  const cancelFrame = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  const move = (delta: number) => {
    const next = Math.min(LEVELS.length - 1, Math.max(0, idx + delta));
    onChange(LEVELS[next]!);
  };

  return (
    <div className="thinking-wrap" ref={rootRef}>
      <button
        type="button"
        className="thinking-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="推理强度"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="thinking-model">{modelName ?? '模型'}</span>
        {value !== 'off' && <span className="thinking-current">{LABELS[value]}</span>}
        <svg
          className="thinking-chevron"
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M2 3.5 5 6.5 8 3.5"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div className="thinking-popover" role="dialog" aria-label="推理强度">
          <div className="thinking-head">
            <span className="thinking-title">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="M6.6 0.8 2.4 6.6h2.7l-.7 4.6 4.2-5.8H5.9z" fill="currentColor" />
              </svg>
              {LABELS[LEVELS[activeIdx]!]}
            </span>
            <button
              type="button"
              className="thinking-reset"
              title="重置为关"
              onClick={() => onChange('off')}
            >
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
                <path
                  d="M2.2 4.6a4.4 4.4 0 1 1-.2 3.6M2.2 4.6V1.9M2.2 4.6h2.7"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>

          <div
            className={`thinking-slider${dragging ? ' dragging' : ''}`}
            role="slider"
            tabIndex={0}
            aria-label="推理强度"
            aria-valuemin={0}
            aria-valuemax={LEVELS.length - 1}
            aria-valuenow={activeIdx}
            aria-valuetext={LABELS[LEVELS[activeIdx]!]}
            onPointerDown={(e) => {
              e.preventDefault();
              draggingRef.current = true;
              setDragging(true);
              applyDrag(e.clientX);
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (draggingRef.current) scheduleDrag(e.clientX);
            }}
            onPointerUp={(e) => {
              if (!draggingRef.current) return;
              cancelFrame();
              applyDrag(e.clientX);
              draggingRef.current = false;
              setDragging(false);
              onChange(LEVELS[dragIdxRef.current]!);
              if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                e.currentTarget.releasePointerCapture(e.pointerId);
              }
            }}
            onPointerCancel={() => {
              cancelFrame();
              draggingRef.current = false;
              setDragging(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
                e.preventDefault();
                move(1);
              } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
                e.preventDefault();
                move(-1);
              } else if (e.key === 'Home') {
                e.preventDefault();
                onChange('off');
              } else if (e.key === 'End') {
                e.preventDefault();
                onChange('max');
              }
            }}
          >
            <div className="thinking-track" ref={trackRef}>
              <div
                className="thinking-fill"
                style={{ clipPath: `inset(0 ${100 - displayPct}% 0 0)` }}
              />
              {LEVELS.map((l, i) => (
                <span
                  key={l}
                  className={`thinking-dot${i === activeIdx ? ' active' : ''}`}
                  style={{ left: `${(i / (LEVELS.length - 1)) * 100}%` }}
                />
              ))}
              <span className="thinking-knob" style={{ left: `${displayPct}%` }} />
            </div>
          </div>

          <div className="thinking-labels">
            {LEVELS.map((l) => (
              <button
                key={l}
                type="button"
                className={l === value ? 'active' : ''}
                onClick={() => onChange(l)}
              >
                {LABELS[l]}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
