import { useEffect, useRef, useState } from 'react';
import { Markdown } from './Markdown';
import {
  ComposerInput,
  type ComposerInputHandle,
  type MentionItem,
  type ChatReference,
} from './ComposerInput';
import type { Message, ThinkingLevel } from './types';

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
  onSend: (text: string, files?: File[], references?: ChatReference[]) => void;
  /** 当前版式的元素，供输入框 `@` 引用 */
  mentions: MentionItem[];
  /** 当前会话的工作目录(📂 设置;null=未选,此时不允许发消息——会话跟着目录走) */
  workDir: string | null;
  /** 会话是否已绑定目录(已绑定 → 📂 置灰:换目录 = 新开会话) */
  dirLocked?: boolean;
  /** 当前 chat 模型名（只读；来自服务端 /api/models） */
  modelName?: string | null;
  /** 思考档位（off/low/high/max）——由 App 持有并持久化 */
  thinking?: ThinkingLevel;
  onThinkingChange?: (v: ThinkingLevel) => void;
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

/** 毫秒 → 人类可读时长：<1s 显示毫秒，<60s 显示一位小数的秒，其余显示分秒 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}分${Math.round(s - m * 60)}秒`;
}

/**
 * 运行中计时器 —— 只对 `streaming` 的消息走表（每 100ms 一帧）。
 *
 * 为什么单独一个组件：走表靠 setState，若挂在 ConversationPanel 顶层会让
 * **整个消息列表**每 100ms 重渲一次；隔离到这条消息内部，重渲范围最小。
 * 停表后不再订阅 tick，静态显示服务端给的最终 durationMs。
 */
function ElapsedTimer({ startedAt, durationMs, streaming }: {
  startedAt?: number;
  durationMs?: number;
  streaming?: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!streaming) return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [streaming]);

  // 无起始时间也无最终耗时（如纯委派卡片消息）→ 不显示
  if (startedAt == null && durationMs == null) return null;
  const ms = streaming ? now - (startedAt ?? now) : (durationMs ?? 0);

  return (
    <span className={`msg-timer${streaming ? ' running' : ''}`} title={streaming ? '已用时（含工具执行）' : '本轮总用时（含工具执行）'}>
      {streaming ? `已用时 ${formatDuration(ms)}` : `用时 ${formatDuration(ms)}`}
    </span>
  );
}

/**
 * 思考块 —— 默认折叠（用户明确要求），点击标题展开/收起。
 *
 * 收起了也必须"有信号"：标题行始终在，显示"已完成思考 / 正在思考…"，
 * 否则用户不知道这轮模型思考过（可发现性 > 界面干净）。
 */
function ReasoningBlock({ text, streaming }: { text: string; streaming?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!text.trim() && !streaming) return null;
  return (
    <div className={`reasoning-block${open ? ' open' : ''}`}>
      <button className="reasoning-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="reasoning-caret">{open ? '▾' : '▸'}</span>
        <span className="reasoning-label">{streaming ? '正在思考…' : '已完成思考'}</span>
      </button>
      {open && <div className="reasoning-body">{text}</div>}
    </div>
  );
}

export function ConversationPanel({
  messages,
  isGenerating,
  onSend,
  mentions,
  workDir,
  dirLocked = false,
  modelName = null,
  thinking = 'off',
  onThinkingChange,
  onPickDir,
  onSetWorkDir,
}: ConversationPanelProps) {
  const composerRef = useRef<ComposerInputHandle>(null);
  const streamRef = useRef<HTMLDivElement>(null);
  const [dirInputOpen, setDirInputOpen] = useState(false);
  const [dirDraft, setDirDraft] = useState('');

  /** 没选目录 = 没有产物的家，聊天被门禁挡住（与后端 400 同一条规则） */
  const noWorkDir = !workDir;
  const canSend = !noWorkDir && !isGenerating;

  const handleComposerSend = (
    text: string,
    files?: File[],
    references?: ChatReference[],
  ) => {
    onSend(text, files, references);
    requestAnimationFrame(() => {
      streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight, behavior: 'smooth' });
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
            {msg.references && msg.references.length > 0 && (
              <div className="chat-references">
                {msg.references.map((r, i) => (
                  <span key={`${r.layout}:${r.id}:${i}`} className="chat-ref-chip">
                    @{r.name}
                  </span>
                ))}
              </div>
            )}
            {/* 思考块：仅助手消息（日志/用户不渲染思考）。默认折叠，见 ReasoningBlock */}
            {msg.role === 'assistant' && msg.kind !== 'log' && (
              <ReasoningBlock text={msg.reasoning ?? ''} streaming={msg.streaming} />
            )}
            {/* 纯委派卡片消息（text 空）：不渲染气泡，只渲染 delegation-list */}
            {(msg.text || !msg.delegations || msg.delegations.length === 0) && (
              <div className="chat-bubble">
                {/* 助手的普通消息按 Markdown 渲染；用户输入与管线日志保持原样
                    （理由见 Markdown.tsx 头注释） */}
                {msg.role === 'assistant' && msg.kind !== 'log' ? (
                  <Markdown text={msg.text} />
                ) : (
                  msg.text
                )}
              </div>
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
            {/* 耗时：所有助手消息都带（委派卡片是独立消息，故放在最外层而不是气泡内） */}
            {msg.role === 'assistant' && msg.kind !== 'log' && (
              <div className="msg-footer">
                <ElapsedTimer startedAt={msg.startedAt} durationMs={msg.durationMs} streaming={msg.streaming} />
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="input-area">
        <div className="composer">
          <ComposerInput
            ref={composerRef}
            disabled={noWorkDir || isGenerating}
            placeholder={
              noWorkDir
                ? '未选工作目录——不允许开始对话（先点下方 📂 选目录）'
                : '描述你的设计想法，可直接粘贴图片（Ctrl+V），@ 引用当前元素…'
            }
            mentions={mentions}
            onSend={handleComposerSend}
          />

          <div className="input-toolbar">
            <button className="composer-tool" title="上传素材" onClick={() => composerRef.current?.pickFiles()}>
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
            <label
              className="composer-thinking"
              title="思考强度：关 = 更快更省；低/高/最高 = 更慢、更贵，复杂任务更稳"
            >
              <span>思考</span>
              <select
                value={thinking}
                onChange={(e) => onThinkingChange?.(e.target.value as ThinkingLevel)}
                aria-label="思考强度"
              >
                <option value="off">关</option>
                <option value="low">低</option>
                <option value="high">高</option>
                <option value="max">最高</option>
              </select>
            </label>
            {modelName && (
              <span className="composer-model" title={`当前模型：${modelName}（配置在 keys.json）`}>
                {modelName}
              </span>
            )}

            <button
              className="composer-send"
              title={noWorkDir ? '未选工作目录，不允许开始对话' : '发送'}
              onClick={() => composerRef.current?.submit()}
              disabled={!canSend}
            >
              <SendIcon />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
