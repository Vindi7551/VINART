import { useRef, useState } from 'react';
import type { Message, SessionItem } from './types';
import { PipelineDebug } from './PipelineDebug';
import { StepPanel } from './StepPanel';
import { NewPipelineForm, type PipelineFormValues } from './NewPipelineForm';

interface ConversationPanelProps {
  messages: Message[];
  isGenerating: boolean;
  onSend: (text: string, files?: File[]) => void;
  /** 点管线步骤按钮 → App 里起 SSE 日志流 */
  onRunStep: (id: string, label: string, query?: string) => void;
  /** 一键生成:图 + 卖点 → 自动跑完整链 */
  onRunPipeline: (v: PipelineFormValues) => void;
  /** 会话列表 + 当前会话(会话层) */
  sessions: SessionItem[];
  activeSessionId: string | null;
  /** 当前会话的工作目录(📂 设置;null=未设置,落缺省位置) */
  workDir: string | null;
  /** 打开应用内目录浏览器 */
  onPickDir: () => void;
  onSetWorkDir: (dir: string) => void;
  onSwitchSession: (id: string) => void;
  onNewSession: () => void;
}

export function ConversationPanel({
  messages,
  isGenerating,
  onSend,
  onRunStep,
  onRunPipeline,
  sessions,
  activeSessionId,
  workDir,
  onPickDir,
  onSetWorkDir,
  onSwitchSession,
  onNewSession,
}: ConversationPanelProps) {
  const [input, setInput] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const streamRef = useRef<HTMLDivElement>(null);
  const [showForm, setShowForm] = useState(true);
  const [dirInputOpen, setDirInputOpen] = useState(false);
  const [dirDraft, setDirDraft] = useState('');

  const handleSend = () => {
    const text = input.trim();
    if (!text && pendingFiles.length === 0) return;
    onSend(text, pendingFiles.length > 0 ? pendingFiles : undefined);
    setInput('');
    setPendingFiles([]);
    requestAnimationFrame(() => {
      streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight, behavior: 'smooth' });
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const removeFile = (i: number) => {
    setPendingFiles((prev) => prev.filter((_, idx) => idx !== i));
  };

  return (
    <aside className="conversation-panel">
      {/* 会话条:列表切换 + 新建(会话历史持久化在服务端) */}
      <div
        className="session-bar"
        style={{ display: 'flex', gap: 6, padding: '6px 10px', borderBottom: '1px solid #e5e7eb', alignItems: 'center' }}
      >
        <select
          className="session-select"
          style={{ flex: 1, fontSize: 12, border: '1px solid #d1d5db', borderRadius: 4, padding: '2px 4px' }}
          value={activeSessionId ?? ''}
          onChange={(e) => onSwitchSession(e.target.value)}
        >
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
        <button
          className="session-new"
          style={{ cursor: 'pointer', border: '1px solid #d1d5db', borderRadius: 4, padding: '2px 8px' }}
          onClick={onNewSession}
          title="新建会话"
        >
          ＋
        </button>
      </div>
      {/* 工作目录:📂 设置(该会话的产物落这里;产品图只读引用原位) */}
      <div
        className="workdir-bar"
        style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '5px 10px', borderBottom: '1px solid #eef0f3', fontSize: 12 }}
      >
        <button
          style={{ cursor: 'pointer', border: '1px solid #d1d5db', borderRadius: 4, padding: '1px 7px' }}
          title={workDir ? `当前:${workDir}\n点击重新选择` : '点击浏览并选择工作目录'}
          onClick={onPickDir}
        >
          📂
        </button>
        {dirInputOpen ? (
          <div style={{ flex: 1, display: 'flex', gap: 4 }}>
            <input
              autoFocus
              style={{ flex: 1, minWidth: 0, fontSize: 12, border: '1px solid #d1d5db', borderRadius: 4, padding: '2px 6px' }}
              placeholder="输入工作目录的完整路径,如 D:\\我的设计\\秋季系列"
              value={dirDraft}
              onChange={(e) => setDirDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && dirDraft.trim()) {
                  onSetWorkDir(dirDraft.trim());
                  setDirInputOpen(false);
                  setDirDraft('');
                }
                if (e.key === 'Escape') setDirInputOpen(false);
              }}
            />
            <button style={{ cursor: 'pointer' }} onClick={() => {
              if (dirDraft.trim()) { onSetWorkDir(dirDraft.trim()); setDirInputOpen(false); setDirDraft(''); }
            }}>确定</button>
          </div>
        ) : (
          <>
            <span style={{ color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }} title={workDir ?? ''}>
              {workDir ?? '未设置工作目录——点击 📂 弹出选择框'}
            </span>
            <a style={{ color: '#1b6fd1', cursor: 'pointer', fontSize: 11 }} onClick={() => setDirInputOpen(true)}>
              手输
            </a>
          </>
        )}
      </div>
      <div className="chat-stream" ref={streamRef}>
        {messages.length === 0 && (
          <div className="chat-empty">
            描述你的设计需求，开始创作
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`chat-msg ${msg.role}${msg.kind === 'log' ? ' log' : ''}`}>
            {msg.attachments && msg.attachments.length > 0 && (
              <div className="chat-attachments">
                {msg.attachments.map((url, i) => (
                  <img key={i} className="chat-attachment" src={url} alt={`素材 ${i + 1}`} />
                ))}
              </div>
            )}
            <div className="chat-bubble">
              {msg.text}
              {msg.delegations && msg.delegations.length > 0 && (
                <div className="delegation-list">
                  {msg.delegations.map((d, i) => (
                    <div key={i} className={`delegation-item ${d.status}`}>
                      <span className="delegation-icon">
                        {d.status === 'running' ? '⏳' : '✅'}
                      </span>
                      <span className="delegation-agent">@{d.agent}</span>
                      <span className="delegation-task">
                        {d.task.slice(0, 60)}{d.task.length > 60 ? '...' : ''}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

      </div>

      {showForm && (
        <NewPipelineForm running={isGenerating} onSubmit={onRunPipeline} />
      )}

      <StepPanel running={isGenerating} onRun={onRunStep} />

      <PipelineDebug isGenerating={isGenerating} />

      {pendingFiles.length > 0 && (
        <div style={{ display: 'flex', gap: 4, padding: '0 16px 4px', flexWrap: 'wrap' }}>
          {pendingFiles.map((f, i) => (
            <span key={i} className="file-badge">
              {f.name.length > 12 ? f.name.slice(0, 12) + '…' : f.name}
              <button onClick={() => removeFile(i)}>×</button>
            </span>
          ))}
        </div>
      )}

      <div className="input-area">
        <div className="input-toolbar">
          <button
            className={`btn-icon btn-ghost btn-sm${showForm ? ' active' : ''}`}
            title="一键生成表单"
            onClick={() => setShowForm((s) => !s)}
          >
            ＋ 新建套图
          </button>
          <div className="agent-select">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2a4 4 0 0 1 4 4v2a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z" />
              <path d="M8 14s1-2 4-2 4 2 4 2" />
              <line x1="9" y1="18" x2="15" y2="18" />
            </svg>
            Agent
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>
          <div style={{ flex: 1 }} />
          <button className="btn-icon btn-ghost btn-sm" title="上传素材" onClick={() => fileInputRef.current?.click()}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) setPendingFiles((prev) => [...prev, ...Array.from(e.target.files!)]);
            e.target.value = '';
          }}
        />
        <div className="input-row">
          <textarea
            rows={1}
            placeholder="描述你的设计想法，或输入调整意见…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button
            className="btn-icon primary"
            title="发送"
            onClick={handleSend}
            disabled={isGenerating || (!input.trim() && pendingFiles.length === 0)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </div>
    </aside>
  );
}
