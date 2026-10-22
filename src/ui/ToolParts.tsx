import { useState } from 'react';
import type { TurnToolPart } from '../designharness/session/turn-parts';

function formatMs(ms?: number): string {
  if (typeof ms !== 'number') return '';
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function ToolRow({ tool }: { tool: TurnToolPart }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const mark = tool.status === 'running' ? '◌' : tool.status === 'failed' ? '✗' : '✓';

  const copy = async () => {
    if (!tool.result) return;
    try {
      await navigator.clipboard.writeText(tool.result);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      /* 剪贴板不可用就算了 */
    }
  };

  return (
    <div className={`tool-row ${tool.status}${open ? ' open' : ''}`}>
      <button
        type="button"
        className="tool-summary"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title={tool.args ?? tool.name}
      >
        <span className={`tool-state ${tool.status}`} aria-hidden="true">
          {mark}
        </span>
        <span className="tool-name">{tool.name}</span>
        {tool.args ? <span className="tool-brief">{tool.args}</span> : null}
        <span className="tool-ms">{formatMs(tool.ms)}</span>
      </button>

      <div className={`tool-collapse${open ? ' open' : ''}`}>
        <div className="tool-collapse-inner">
          <div className="tool-body">
            {tool.args ? (
              <>
                <div className="tool-label">参数</div>
                <pre>{tool.args}</pre>
              </>
            ) : null}
            {tool.result ? (
              <>
                <div className="tool-body-head">
                  <div className="tool-label">{tool.status === 'failed' ? '错误' : '结果'}</div>
                  <button type="button" className="tool-copy" onClick={() => void copy()}>
                    {copied ? '已复制' : '复制'}
                  </button>
                </div>
                <pre>{tool.result}</pre>
              </>
            ) : null}
            {tool.status === 'running' ? <div className="tool-running">运行中…</div> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 连续工具调用合并成一组：组头显示步骤数与总耗时，组内每个工具仍是可折叠的一行。
 * 单工具不显示组头，直接一行；外层仍用同一个组容器，保证过程轨道连续。
 */
export function ToolGroup({ tools }: { tools: TurnToolPart[] }) {
  if (tools.length === 0) return null;
  const totalMs = tools.reduce((sum, t) => sum + (t.ms ?? 0), 0);
  return (
    <div className={`tool-group${tools.length === 1 ? ' single' : ''}`}>
      {tools.length > 1 ? (
        <div className="tool-group-head">
          {tools.length} 个步骤
          {totalMs > 0 ? ` · ${formatMs(totalMs)}` : ''}
        </div>
      ) : null}
      {tools.map((t) => (
        <ToolRow key={t.callId} tool={t} />
      ))}
    </div>
  );
}
