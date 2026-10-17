import { IconRedo, IconRender, IconSave, IconUndo } from './icons';
import { TOOLS, type ToolId } from './tools';
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
 * - **下面 4 个 = 动作**：撤销 / 重做 / 保存 / 出图。点一下就走，**不留高亮**。
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
  onSignal,
  onSave,
  onRender,
}: {
  tool: ToolId;
  onTool: (t: ToolId) => void;
  busy: boolean;
  onSignal: (sig: Omit<HostSignal, 'seq'>) => void;
  onSave: () => void;
  onRender: () => void;
}) {
  return (
    <div className="toolbar">
      <div className="toolbar-group">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`tool-btn${tool === t.id ? ' active' : ''}`}
            onClick={() => onTool(t.id)}
            title={`${t.label} —— ${t.hint}`}
            aria-pressed={tool === t.id}
          >
            {t.icon}
          </button>
        ))}
      </div>

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
        <button type="button" className="tool-btn" disabled={busy} onClick={onRender} title="出图（渲染 PNG）">
          <IconRender />
        </button>
      </div>
    </div>
  );
}
