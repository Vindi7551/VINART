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
 *
 * **图层眼睛（2026-10-10）**：清单每行左侧一个可视性开关，只改**画布显示**。
 * 点眼睛**不顺带选中**该行（stopPropagation）；按住 Alt 点 = **独奏**（只看这一层，
 * 再 Alt 点一次还原）。隐藏态与宿主态同在 `hiddenLayers`（**不进 spec**，
 * 见 `layer-visibility.ts`），所以 💾 保存 / ⟳ 重渲都不会把它带进成品图。
 */
interface EditPanelProps {
  layout: LayoutData;
  selectedLayer: string | null;
  /** 当前激活的染色词(点图上染色片段切换) */
  activeWord: string | null;
  busy: boolean;
  /** 被隐藏的图层(编辑器视角态,不进 spec) */
  hiddenLayers: ReadonlySet<string>;
  onSelectLayer: (id: string) => void;
  /** 新增高亮词(宿主设为激活) */
  onActivateWord: (word: string) => void;
  /** 切换图层可视性(solo = Alt 独奏) */
  onToggleVisible: (id: string, solo: boolean) => void;
  /** 全部显示(独奏/多藏之后一键还原) */
  onShowAll: () => void;
  /** 参数面板改属性(React 数据 + iframe 由宿主统一转发) */
  onLayerPatch: (id: string, patch: Record<string, unknown>) => void;
  onSave: () => void;
  onRender: () => void;
}

/** 眼睛图标:可见 / 不可见(Lucide `eye` / `eye-off` 路径,描边随 currentColor) */
function EyeIcon({ hidden }: { hidden: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {hidden ? (
        <>
          <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
          <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
          <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" />
          <path d="m2 2 20 20" />
        </>
      ) : (
        <>
          <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}

export function EditPanel({
  layout,
  selectedLayer,
  activeWord,
  busy,
  hiddenLayers,
  onSelectLayer,
  onActivateWord,
  onToggleVisible,
  onShowAll,
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
            <Hint>
              图层({layout.spec.layers.length})——点击选中,图上直接拖拽/改字
              {hiddenLayers.size > 0
                ? `;已隐藏 ${hiddenLayers.size}(Alt+点眼睛 = 只看这一层)`
                : ''}
            </Hint>
            {hiddenLayers.size > 0 && <Button onClick={onShowAll}>全部显示</Button>}
            {layout.spec.layers.map((l) => {
              const hidden = hiddenLayers.has(l.id);
              return (
                <ListItem
                  key={l.id}
                  active={l.id === selectedLayer}
                  className={hidden ? 'layer-hidden' : undefined}
                  onClick={() => onSelectLayer(l.id)}
                >
                  <button
                    type="button"
                    className={`layer-eye${hidden ? ' off' : ''}`}
                    aria-pressed={hidden}
                    title={
                      hidden
                        ? '显示该图层（Alt+点击：只看这一层）'
                        : '隐藏该图层（Alt+点击：只看这一层）'
                    }
                    onClick={(e) => {
                      // 点眼睛只切可视性,不该顺带把这一行选中(否则面板会跳进检查器)
                      e.stopPropagation();
                      onToggleVisible(l.id, e.altKey);
                    }}
                  >
                    <EyeIcon hidden={hidden} />
                  </button>
                  <span className="layer-name">
                    <b>{l.id}</b> <span className="ui-hint">{l.type}</span>
                  </span>
                </ListItem>
              );
            })}
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
