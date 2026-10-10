import { useRef, useState } from 'react';
import type { Message } from './types';

/**
 * 右栏对话面板 —— 消息流 + **单卡片式输入区**。
 *
 * 输入区结构（2026-10-10 改版，参照 WorkBuddy 的 composer）：
 *
 *   ┌─ .composer ───────────────────────────────┐
 *   │ [缩略图 …]            ← 待发图片（卡片内）  │
 *   │ 文字…                 ← .input-row/textarea │
 *   │ ＋  📂 目录  ⇢  ⟳ 模型  ↑ ← .input-toolbar  │
 *   └───────────────────────────────────────────┘
 *
 * 改版要点：
 * - **去掉 Agent 药丸**（`.agent-select`）：它是个没绑任何 onClick 的纯装饰控件。
 * - 工作目录（📂 + 路径 + 手输）从右栏顶部独立一条，**下移进工具条**。
 * - 待发图片从输入框上方挪进**卡片内部**，保留缩略图（这是一个以图为主的 app）。
 * - 发送键保留项目强调色（紫），改为圆形 ↑。
 * - 模型名**只读展示**，来源服务端注册表（`/api/models`）——不在前端硬编码。
 */
interface ConversationPanelProps {
  messages: Message[];
  isGenerating: boolean;
  onSend: (text: string, files?: File[]) => void;
  /** 当前会话的工作目录(📂 设置;null=未选,此时不允许发消息——会话跟着目录走) */
  workDir: string | null;
  /** 会话是否已绑定目录(已绑定 → 📂 置灰:换目录 = 新开会话) */
  dirLocked?: boolean;
  /** 当前 chat 模型名（只读；来自服务端 /api/models） */
  modelName?: string | null;
  /** 打开应用内目录浏览器 */
  onPickDir: () => void;
  onSetWorkDir: (dir: string) => void;
}

/** 工具条：上传素材（加号） */
function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

/** 发送（向上箭头） */
function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" y1="19" x2="12" y2="6" />
      <polyline points="6 12 12 6 18 12" />
    </svg>
  );
}

/** 待发图片的文件名（过长截断） */
function shortName(name: string): string {
  return name.length > 12 ? name.slice(0, 12) + '…' : name;
}

export function ConversationPanel({
  messages,
  isGenerating,
  onSend,
  workDir,
  dirLocked = false,
  modelName = null,
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
  const canSend = !noWorkDir && !isGenerating && (!!input.trim() || pendingFiles.length > 0);

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

  const commitDirDraft = () => {
    if (!dirDraft.trim()) return;
    onSetWorkDir(dirDraft.trim());
    setDirInputOpen(false);
    setDirDraft('');
  };

  return (
    <aside className="conversation-panel">
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

      <div className="input-area">
        <div className="composer">
          {pendingFiles.length > 0 && (
            <div className="composer-files">
              {pendingFiles.map((p, i) => (
                <span key={i} className="file-badge">
                  <img className="file-badge-thumb" src={p.url} alt="" />
                  <span className="file-badge-name">{shortName(p.file.name)}</span>
                  <button onClick={() => removeFile(i)} title="移除">×</button>
                </span>
              ))}
            </div>
          )}

          <div className="input-row">
            <textarea
              rows={1}
              placeholder={
                noWorkDir
                  ? '未选工作目录——不允许开始对话（先点下方 📂 选目录）'
                  : '描述你的设计想法，可直接粘贴图片（Ctrl+V）…'
              }
              value={input}
              disabled={noWorkDir}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
            />
          </div>

          <div className="input-toolbar">
            <button className="composer-tool" title="上传素材" onClick={() => fileInputRef.current?.click()}>
              <PlusIcon />
            </button>

            {/* 工作目录：📂 选目录 / 路径 / 手输。类名沿用 workdir-bar（探针依赖它当锚点） */}
            <div className="workdir-bar">
              <button
                className="workdir-pick"
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
                <>
                  <input
                    className="workdir-input"
                    autoFocus
                    placeholder="输入工作目录的完整路径,如 D:\我的设计\秋季系列"
                    value={dirDraft}
                    onChange={(e) => setDirDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitDirDraft();
                      if (e.key === 'Escape') setDirInputOpen(false);
                    }}
                  />
                  <button className="workdir-ok" onClick={commitDirDraft}>确定</button>
                </>
              ) : (
                <>
                  <span className="workdir-path" title={workDir ?? '未选工作目录——先点 📂 选一个目录才能开始对话'}>
                    {workDir ?? '未选工作目录'}
                  </span>
                  {!dirLocked && !workDir && (
                    <a className="workdir-manual" onClick={() => setDirInputOpen(true)}>手输</a>
                  )}
                </>
              )}
            </div>

            <div className="composer-spacer" />

            {isGenerating && <span className="composer-spinner" title="生成中…" role="status" aria-label="生成中" />}
            {modelName && (
              <span className="composer-model" title={`当前模型：${modelName}（配置在 keys.json）`}>
                {modelName}
              </span>
            )}

            <button
              className="composer-send"
              title={noWorkDir ? '未选工作目录，不允许开始对话' : '发送'}
              onClick={handleSend}
              disabled={!canSend}
            >
              <SendIcon />
            </button>
          </div>
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
      </div>
    </aside>
  );
}
