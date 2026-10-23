import { IconRedo, IconRender, IconSave, IconUndo } from './icons';
import { TOOLS, SHAPE_KINDS, type ShapeKind, type ToolId } from './tools';
import { ContextMenu } from './primitives';
import { useState } from 'react';
import type { HostSignal } from './types';

/**
 * **主工具栏** —— 最左边那一栏（44px 固定宽，不参与拖拽）。
 *
 * 路线图位置：`docs/EDITOR-EVOLUTION.md` 的 **M3 = 工具状态机 + 图层管理**
 * （"显式工具枚举 + 光标/快捷键"）—— 这里是它的**界面那一半**。
 *
 * ## 两段，一条分隔线（PS 的分组感）
 *
 * - **上面 6 个 = 工具**：单选、有高亮态。选谁，右边检查器就整块换成谁那一页。
 * - **下面 4 个 = 动作**：撤销 / 重做 / 保存 / 出图。前三个点一下就走；出图会先开
 *   **设置弹窗**（倍率 / 格式 / 保存位置），确认后才请求。动作**不留高亮**。
 *
 * ⚠️ 动作**只有这一处入口** —— 原来它们挂在检查器栏表头，工具栏一建就会变成
 *    同一个动作两个地方能点。搬过来之后检查器表头只剩标题。
 *
 * ⚠️ 为什么不用基元层的 `Button`：`.ui-btn` 是**面板里**的按钮（有边框、有内边距），
 *    工具栏按钮是另一种东西（无边框、方形、常驻高亮态）。样式落 `.tool-btn`，
 *    一样走设计 token，不给这里写内联颜色。
 */
export function ToolBar({
  tool,
  onTool,
  busy,
  canRender,
  onSignal,
  onSave,
  onRender,
  shapeKind,
  onShapeKind,
}: {
  tool: ToolId;
  onTool: (t: ToolId) => void;
  busy: boolean;
  /** 没有打开的版式时禁用「出图」（弹窗没有可出的 doc） */
  canRender: boolean;
  onSignal: (sig: Omit<HostSignal, 'seq'>) => void;
  onSave: () => void;
  onRender: () => void;
  /** ⭐ 形状工具当前种类（右键菜单要标出当前那一项） */
  shapeKind: ShapeKind;
  onShapeKind: (k: ShapeKind) => void;
}) {
  /** ⭐ 右键「形状」图标时弹出的形状候选（坐标 = 鼠标点） */
  const [ctx, setCtx] = useState<{ x: number; y: number } | null>(null);
  return (
    <div className="toolbar">
      <div className="toolbar-group">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`tool-btn${tool === t.id ? ' active' : ''}`}
            onClick={() => onTool(t.id)}
            // ⭐ **形状工具**：右键（PS 那种）弹候选 —— 改的和形状页里的枚举是**同一个 state**
            onContextMenu={
              t.id === 'shape'
                ? (e) => {
                    e.preventDefault();
                    setCtx({ x: e.clientX, y: e.clientY });
                  }
                : undefined
            }
            title={
              t.id === 'shape' ? `${t.label} —— ${t.hint}（右键选种类）` : `${t.label} —— ${t.hint}`
            }
            aria-pressed={tool === t.id}
          >
            {t.icon}
          </button>
        ))}
      </div>
      {ctx ? (
        <ContextMenu
          x={ctx.x}
          y={ctx.y}
          items={SHAPE_KINDS.map((k) => ({
            key: k.id,
            label: k.label,
            active: k.id === shapeKind,
            onPick: () => onShapeKind(k.id),
          }))}
          onClose={() => setCtx(null)}
        />
      ) : null}

      <div className="toolbar-sep" />

      <div className="toolbar-group">
        <button
          type="button"
          className="tool-btn"
          disabled={busy}
          onClick={() => onSignal({ type: 'undo' })}
          title="撤销（Ctrl+Z）"
        >
          <IconUndo />
        </button>
        <button
          type="button"
          className="tool-btn"
          disabled={busy}
          onClick={() => onSignal({ type: 'redo' })}
          title="重做（Ctrl+Shift+Z）"
        >
          <IconRedo />
        </button>
        <button type="button" className="tool-btn" disabled={busy} onClick={onSave} title="保存（写回 doc.json）">
          <IconSave />
        </button>
        <button
          type="button"
          className="tool-btn"
          disabled={busy || !canRender}
          onClick={onRender}
          title={canRender ? '出图…（设置倍率 / 格式 / 保存位置）' : '出图（先打开一个版式）'}
        >
          <IconRender />
        </button>
      </div>
    </div>
  );
}
