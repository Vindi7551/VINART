import type { TurnToolPart } from '../designharness/session/turn-parts';

function formatMs(ms?: number): string {
  if (typeof ms !== 'number') return '';
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function ToolRow({ tool }: { tool: TurnToolPart }) {
  const mark = tool.status === 'running' ? '◌' : tool.status === 'failed' ? '✗' : '✓';
  return (
    <details className={`tool-row ${tool.status}`}>
      <summary>
        <span className={`tool-state ${tool.status}`} aria-hidden="true">
          {mark}
        </span>
        <span className="tool-name">{tool.name}</span>
        {tool.args ? <span className="tool-brief">{tool.args}</span> : null}
        <span className="tool-ms">{formatMs(tool.ms)}</span>
      </summary>
      <div className="tool-body">
        {tool.args ? (
          <>
            <div className="tool-label">参数</div>
            <pre>{tool.args}</pre>
          </>
        ) : null}
        {tool.result ? (
          <>
            <div className="tool-label">{tool.status === 'failed' ? '错误' : '结果'}</div>
            <pre>{tool.result}</pre>
          </>
        ) : null}
        {tool.status === 'running' ? <div className="tool-running">运行中…</div> : null}
      </div>
    </details>
  );
}

/**
 * 连续工具调用合并成一组：组头只显示数量，组内每个工具仍是可折叠的一行。
 * 单工具不显示组头，直接一行。
 */
export function ToolGroup({ tools }: { tools: TurnToolPart[] }) {
  if (tools.length === 0) return null;
  if (tools.length === 1) return <ToolRow tool={tools[0]!} />;
  return (
    <div className="tool-group">
      <div className="tool-group-head">工具调用 ×{tools.length}</div>
      {tools.map((t) => (
        <ToolRow key={t.callId} tool={t} />
      ))}
    </div>
  );
}
