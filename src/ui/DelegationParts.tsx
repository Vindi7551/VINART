import { useState } from 'react';
import type { TurnDelegationPart } from '../designharness/session/turn-parts';

/** 子 agent 委派：一行摘要，展开看任务/结果/产物。 */
export function DelegationRow({ part }: { part: TurnDelegationPart }) {
  const [open, setOpen] = useState(false);
  const mark = part.status === 'running' ? '◌' : part.status === 'failed' ? '✗' : '✓';
  return (
    <div className={`agent-row ${part.status}${open ? ' open' : ''}`}>
      <button type="button" className="agent-summary" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className={`agent-state ${part.status}`} aria-hidden="true">
          {mark}
        </span>
        <span className="agent-label">@{part.label}</span>
        {part.name ? <span className="agent-name">{part.name}</span> : null}
        <span className="agent-ms">子 agent</span>
      </button>
      <div className={`agent-collapse${open ? ' open' : ''}`}>
        <div className="agent-collapse-inner">
          <div className="agent-body">
            {part.task ? (
              <>
                <div className="tool-label">任务</div>
                <pre>{part.task}</pre>
              </>
            ) : null}
            {part.summary ? (
              <>
                <div className="tool-label">{part.status === 'failed' ? '失败原因' : '结果'}</div>
                <pre>{part.summary}</pre>
              </>
            ) : null}
            {part.artifacts && part.artifacts.length > 0 ? (
              <>
                <div className="tool-label">产物</div>
                <pre>{part.artifacts.join('\n')}</pre>
              </>
            ) : null}
            {part.status === 'running' ? <div className="tool-running">运行中…</div> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
