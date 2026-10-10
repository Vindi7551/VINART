import { useEffect, useRef, useState } from 'react';
import { LayerInspector } from './LayerInspector';
import { Button, Hint, ListItem, Panel, PanelBody, PanelHeader } from './primitives';
import type { LayoutData } from './types';

/**
 * 版式编辑面板 —— **独立一栏**（`.inspector-col`，贴在画布右侧），不再与对话同栏。
 *
 * 职责：图层清单 ↔ 选中元素参数 + 保存/重渲。
 * 折叠由**整栏**负责（`.inspector-toggle`），面板内不再有第二层折叠。
 * 表现层全部走 `primitives.tsx` 的基元（样式在 index.css 的 `.ui-*`，token 驱动）。
 */
interface EditPanelProps {
  layout: LayoutData;
  selectedLayer: string | null;
  /** 当前激活的染色词(点图上染色片段切换) */
  activeWord: string | null;
  busy: boolean;
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

  return (
    <Panel>
      <PanelHeader
        title="版式编辑"
        subtitle={
          // 图层信息排在前：窄栏（默认 320px）里会截断，版式名可以让位
          layer ? (
            <>
              <b>{layer.id}</b> <span className="ui-hint">({layer.type})</span>
              {' · '}
              {layout.name}
            </>
          ) : (
            layout.name
          )
        }
        actions={
          <>
            <Button disabled={busy} onClick={onSave}>
              {busy ? '…' : '💾 保存'}
            </Button>
            <Button disabled={busy} onClick={onRender}>
              {busy ? '…' : '⟳ 重渲'}
            </Button>
          </>
        }
      />
      <PanelBody>
        {mode === 'list' || !layer ? (
          <>
            <Hint>图层({layout.spec.layers.length})——点击选中,图上直接拖拽/改字</Hint>
            {layout.spec.layers.map((l) => (
              <ListItem key={l.id} active={l.id === selectedLayer} onClick={() => onSelectLayer(l.id)}>
                <b>{l.id}</b> <span className="ui-hint">{l.type}</span>
              </ListItem>
            ))}
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setMode('list')}>
              « 图层清单
            </Button>
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
      </PanelBody>
    </Panel>
  );
}
