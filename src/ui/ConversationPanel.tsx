import { useRef, useState } from 'react';
import type { Message } from './types';

interface ConversationPanelProps {
  messages: Message[];
  isGenerating: boolean;
  onSend: (text: string, files?: File[]) => void;
  /** 当前会话的工作目录(📂 设置;null=未设置,落缺省位置) */
  workDir: string | null;
  /** 项目层:工作目录下的产物分组(下拉切换/新建) */
  projects: Array<{ name: string; displayName: string }>;
  currentProject: string | null;
  onSetProject: (name: string, displayName?: string) => void;
  /** 打开应用内目录浏览器 */
  onPickDir: () => void;
  onSetWorkDir: (dir: string) => void;
}

export function ConversationPanel({
  messages,
  isGenerating,
  onSend,
  workDir,
  projects,
  currentProject,
  onSetProject,
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
  // 项目新建输入:name(目录名,英文) + displayName(展示名,可中文)
  const [projInputOpen, setProjInputOpen] = useState(false);
  const [projNameDraft, setProjNameDraft] = useState('');
  const [projDisplayDraft, setProjDisplayDraft] = useState('');

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
      {/* 项目条:产物按项目分组(<工作目录>/<项目>/designs/…);下拉切换,＋ 新建 */}
      <div
        className="project-bar"
        style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '5px 10px', borderBottom: '1px solid #eef0f3', fontSize: 12 }}
      >
        {projInputOpen ? (
          <div style={{ flex: 1, display: 'flex', gap: 4 }}>
            <input
              autoFocus
              style={{ flex: 1, minWidth: 0, fontSize: 12, border: '1px solid #d1d5db', borderRadius: 4, padding: '2px 6px' }}
              placeholder="项目目录名(英文,如 tshirt-black)"
              value={projNameDraft}
              onChange={(e) => setProjNameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setProjInputOpen(false);
              }}
            />
            <input
              style={{ flex: 1, minWidth: 0, fontSize: 12, border: '1px solid #d1d5db', borderRadius: 4, padding: '2px 6px' }}
              placeholder="展示名(可中文,可选)"
              value={projDisplayDraft}
              onChange={(e) => setProjDisplayDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && projNameDraft.trim()) {
                  onSetProject(projNameDraft.trim(), projDisplayDraft.trim() || undefined);
                  setProjInputOpen(false);
                  setProjNameDraft('');
                  setProjDisplayDraft('');
                }
              }}
            />
            <button
              style={{ cursor: 'pointer' }}
              onClick={() => {
                if (projNameDraft.trim()) {
                  onSetProject(projNameDraft.trim(), projDisplayDraft.trim() || undefined);
                  setProjInputOpen(false);
                  setProjNameDraft('');
                  setProjDisplayDraft('');
                }
              }}
            >
              确定
            </button>
          </div>
        ) : (
          <>
            <span style={{ color: '#6b7280', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {currentProject
                ? `项目:${projects.find((p) => p.name === currentProject)?.displayName ?? currentProject}`
                : '未设置项目——产物暂落工作目录/designs(旧约定)'}
            </span>
            <select
              style={{ maxWidth: 130, fontSize: 12, border: '1px solid #d1d5db', borderRadius: 4, padding: '2px 4px', cursor: 'pointer' }}
              value={currentProject ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                if (v) {
                  const p = projects.find((x) => x.name === v);
                  onSetProject(v, p?.displayName);
                }
              }}
              title="切换项目"
            >
              <option value="" disabled>
                选择项目…
              </option>
              {projects.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.displayName}
                </option>
              ))}
            </select>
            <button
              style={{ cursor: 'pointer', border: '1px solid #d1d5db', borderRadius: 4, padding: '1px 7px' }}
              onClick={() => setProjInputOpen(true)}
              title="新建项目(目录名英文,展示名可中文)"
            >
              ＋
            </button>
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
            placeholder="描述你的设计想法，可直接粘贴图片（Ctrl+V）…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
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
