import { useEffect, useRef, useState } from 'react';
import { LayerInspector } from './LayerInspector';
import type { LayoutData } from './types';

/**
 * 右侧栏顶部的版式编辑面板(可收起):
 * 图层清单 ↔ 选中元素参数,加保存/重渲。位于「一键生成套图」上方,不替换它。
 */
interface EditPanelProps {
  layout: LayoutData;
  selectedLayer: string | null;
  /** 当前激活的染色词(点图上染色片段切换) */
  activeWord: string | null;
  busy: boolean;
  open: boolean;
  onToggle: () => void;
  onSelectLayer: (id: string) => void;
  /** 新增高亮词(宿主设为激活) */
  onActivateWord: (word: string) => void;
  /** 参数面板改属性(React 数据 + iframe 由宿主统一转发) */
  onLayerPatch: (id: string, patch: Record<string, unknown>) => void;
  onSave: () => void;
  onRender: () => void;
}

export function EditPanel({
  layout,
  selectedLayer,
  activeWord,
  busy,
  open,
  onToggle,
  onSelectLayer,
  onActivateWord,
  onLayerPatch,
  onSave,
  onRender,
}: EditPanelProps) {
  const lastRectSync = useRef(0);

  // 选中后面板内容(清单 ↔ 检查器)
  const [mode, setMode] = useState<'list' | 'inspect'>(selectedLayer ? 'inspect' : 'list');
  useEffect(() => {
    setMode(selectedLayer ? 'inspect' : 'list');
  }, [selectedLayer]);

  const layer = selectedLayer ? layout.spec.layers.find((x) => x.id === selectedLayer) : undefined;
  const al =
    (selectedLayer ? layout.appearance.layers?.[selectedLayer] : undefined) ?? {};

  if (!open) {
    return (
      <div
        onClick={onToggle}
        style={{
          cursor: 'pointer',
          background: '#1e2430',
          color: '#fff',
          font: '12px/34px system-ui',
          textAlign: 'center',
          letterSpacing: 1,
        }}
        title="展开版式编辑"
      >
        ‹ 版式编辑 ›
      </div>
    );
  }

  return (
    <div
      style={{
        flex: 'none',
        maxHeight: '46%',
        display: 'flex',
        flexDirection: 'column',
        background: '#fff',
        borderBottom: '2px solid #1e2430',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '0 10px',
          height: 32,
          background: '#1e2430',
          color: '#fff',
          font: '12px/32px system-ui',
        }}
      >
        <b>版式编辑</b>
        <span style={{ opacity: 0.7 }}>{layout.name}</span>
        {layer && (
          <span style={{ opacity: 0.9 }}>
            · {layer.id} <small style={{ opacity: 0.7 }}>({layer.type})</small>
          </span>
        )}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button disabled={busy} onClick={onSave} style={{ cursor: busy ? 'wait' : 'pointer' }}>
            {busy ? '…' : '💾 保存'}
          </button>
          <button disabled={busy} onClick={onRender} style={{ cursor: busy ? 'wait' : 'pointer' }}>
            {busy ? '…' : '⟳ 重渲'}
          </button>
          <button onClick={onToggle} style={{ cursor: 'pointer' }} title="收起">
            »
          </button>
        </span>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '8px 12px', fontSize: 12, lineHeight: 1.9 }}>
        {mode === 'list' || !layer ? (
          <>
            <div style={{ marginBottom: 4, color: '#888' }}>
              图层({layout.spec.layers.length})——点击选中,图上直接拖拽/改字
            </div>
            {layout.spec.layers.map((l) => (
              <div
                key={l.id}
                onClick={() => onSelectLayer(l.id)}
                style={{
                  padding: '4px 8px',
                  cursor: 'pointer',
                  borderRadius: 4,
                  background: l.id === selectedLayer ? '#eef3ff' : undefined,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#eef3ff')}
                onMouseLeave={(e) => (e.currentTarget.style.background = l.id === selectedLayer ? '#eef3ff' : '')}
              >
                <b>{l.id}</b> <span style={{ color: '#888' }}>{l.type}</span>
              </div>
            ))}
          </>
        ) : (
          <>
            <div style={{ marginBottom: 4 }}>
              <span
                onClick={() => setMode('list')}
                style={{ cursor: 'pointer', color: '#1b6fd1' }}
              >
                « 图层清单
              </span>
            </div>
            <LayerInspector
              layer={layer}
              appearance={al}
              activeWord={activeWord}
              onActivateWord={onActivateWord}
              palette={
                typeof layout.appearance.palette === 'object' && layout.appearance.palette
                  ? (layout.appearance.palette as Record<string, string>)
                  : {}
              }
              onPatch={(patch) => {
                // 抑制高频重复(rect 拖拽同步),30ms 内只发一次同 id patch
                const now = Date.now();
                if (now - lastRectSync.current < 30 && 'rect' in patch) return;
                lastRectSync.current = now;
                onLayerPatch(layer.id, patch);
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}
