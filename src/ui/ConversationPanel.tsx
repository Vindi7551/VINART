import { useRef, useState } from 'react';
import type { Message } from './types';

interface ConversationPanelProps {
  messages: Message[];
  isGenerating: boolean;
  onSend: (text: string, files?: File[]) => void;
  /** 当前会话的工作目录(📂 设置;null=未选,此时不允许发消息——会话跟着目录走) */
  workDir: string | null;
  /** 会话是否已绑定目录(已绑定 → 📂 置灰:换目录 = 新开会话) */
  dirLocked?: boolean;
  /** 打开应用内目录浏览器 */
  onPickDir: () => void;
  onSetWorkDir: (dir: string) => void;
}

export function ConversationPanel({
  messages,
  isGenerating,
  onSend,
  workDir,
  dirLocked = false,
  onPickDir,
  onSetWorkDir,
}: ConversationPanelProps) {
  const [input, setInput] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** 待发送图片：file + 预览用 objectURL（移除/发送时 revoke，防内存泄漏） */
  const [pendingFiles, setPendingFiles] = useState<Array<{ file: File; url: string }>>([]);
  const streamRef = useRef<HTMLDivElement>(null);
  const [dirInputOpen, setDirInputOpen] = useState(false);
  const [dirDraft, setDirDraft] = useState('');

  /** 没选目录 = 没有产物的家，聊天被门禁挡住（与后端 400 同一条规则） */
  const noWorkDir = !workDir;

  const addFiles = (files: File[]) => {
    setPendingFiles((prev) => [
      ...prev,
      ...files
        .filter((f) => f.type.startsWith('image/'))
        .map((file) => ({ file, url: URL.createObjectURL(file) })),
    ]);
  };

  const handleSend = () => {
    const text = input.trim();
    if (!text && pendingFiles.length === 0) return;
    if (noWorkDir) return; // 双保险：按钮已 disabled
    onSend(text, pendingFiles.length > 0 ? pendingFiles.map((p) => p.file) : undefined);
    pendingFiles.forEach((p) => URL.revokeObjectURL(p.url));
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

  /** 直接粘贴图片进输入框（截图/复制图后 Ctrl+V 即挂到待发送区） */
  const handlePaste = (e: React.ClipboardEvent) => {
    const imgs = Array.from(e.clipboardData?.items ?? [])
      .filter((it) => it.type.startsWith('image/'))
      .map((it) => it.getAsFile())
      .filter((f): f is File => !!f);
    if (imgs.length === 0) return;
    e.preventDefault();
    addFiles(imgs);
  };

  const removeFile = (i: number) => {
    setPendingFiles((prev) => {
      URL.revokeObjectURL(prev[i].url);
      return prev.filter((_, idx) => idx !== i);
    });
  };

  return (
    <aside className="conversation-panel">
      {/* 会话切换已移至左侧对话列表（SessionListPanel）；此处只管工作目录/项目/聊天 */}
      {/* 工作目录:📂 设置(该会话的产物落这里;产品图只读引用原位)。
          一个工作目录就是一个项目——不再有项目条;会话绑定后 📂 置灰(换目录 = 新开会话) */}
      <div
        className="workdir-bar"
        style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '5px 10px', borderBottom: '1px solid var(--border-light)', fontSize: 12 }}
      >
        <button
          style={{
            cursor: dirLocked ? 'not-allowed' : 'pointer',
            opacity: dirLocked ? 0.45 : 1,
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            padding: '1px 7px',
          }}
          disabled={dirLocked}
          title={
            dirLocked
              ? `本会话已绑定:${workDir}\n工作目录创建时绑定、不可更改——要换目录请新建对话`
              : workDir
                ? `当前:${workDir}\n点击重新选择`
                : '点击浏览并选择工作目录'
          }
          onClick={onPickDir}
        >
          📂
        </button>
        {dirInputOpen ? (
          <div style={{ flex: 1, display: 'flex', gap: 4 }}>
            <input
              autoFocus
              style={{ flex: 1, minWidth: 0, fontSize: 12, border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '2px 6px' }}
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
            <span style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }} title={workDir ?? ''}>
              {workDir ?? '未选工作目录——先点 📂 选一个目录才能开始对话'}
            </span>
            {!dirLocked && !workDir && (
              <a style={{ color: 'var(--accent)', cursor: 'pointer', fontSize: 11 }} onClick={() => setDirInputOpen(true)}>
                手输
              </a>
            )}
          </>
        )}
      </div>
      <div className="chat-stream" ref={streamRef}>
        {messages.length === 0 && (
          <div className="chat-empty">
            {noWorkDir ? '先选一个工作目录——会话与产物都跟着它走' : '描述你的设计需求，开始创作'}
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
            {/* 纯委派卡片消息（text 空）：不渲染气泡，只渲染 delegation-list */}
            {(msg.text || !msg.delegations || msg.delegations.length === 0) && (
              <div className="chat-bubble">{msg.text}</div>
            )}
            {msg.delegations && msg.delegations.length > 0 && (
              <div className="delegation-list" style={{ marginTop: msg.text ? 6 : 0 }}>
                {msg.delegations.map((d, i) => (
                  <div key={i} className={`delegation-item ${d.status}`}>
                    <span className="delegation-icon">
                      {d.status === 'running' ? '⏳' : d.status === 'failed' ? '⚠️' : '✅'}
                    </span>
                    <span className="delegation-agent">
                      @{d.agent}
                      {d.name && d.name !== d.agent ? `（${d.name}）` : ''}
                    </span>
                    <span className="delegation-task">
                      {(d.result ?? d.task).slice(0, 80)}{(d.result ?? d.task).length > 80 ? '…' : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

      </div>

      {pendingFiles.length > 0 && (
        <div style={{ display: 'flex', gap: 4, padding: '0 16px 4px', flexWrap: 'wrap' }}>
          {pendingFiles.map((p, i) => (
            <span key={i} className="file-badge">
              <img
                src={p.url}
                alt=""
                style={{ width: 26, height: 26, objectFit: 'cover', borderRadius: 3, verticalAlign: 'middle' }}
              />
              {p.file.name.length > 12 ? p.file.name.slice(0, 12) + '…' : p.file.name}
              <button onClick={() => removeFile(i)}>×</button>
            </span>
          ))}
        </div>
      )}

      <div className="input-area">
        <div className="input-toolbar">
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
            if (e.target.files) addFiles(Array.from(e.target.files));
            e.target.value = '';
          }}
        />
        <div className="input-row">
          <textarea
            rows={1}
            placeholder={
              noWorkDir
                ? '未选工作目录——不允许开始对话（先点上方 📂 选目录）'
                : '描述你的设计想法，可直接粘贴图片（Ctrl+V）…'
            }
            value={input}
            disabled={noWorkDir}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
          />
          <button
            className="btn-icon primary"
            title={noWorkDir ? '未选工作目录，不允许开始对话' : '发送'}
            onClick={handleSend}
            disabled={noWorkDir || isGenerating || (!input.trim() && pendingFiles.length === 0)}
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
