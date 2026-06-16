import { useRef, useState } from 'react';
import type { Message } from './types';
import { PipelineDebug } from './PipelineDebug';
import { TemplateSection } from './TemplateSection';

interface ConversationPanelProps {
  messages: Message[];
  isGenerating: boolean;
  onSend: (text: string, files?: File[]) => void;
}

export function ConversationPanel({ messages, isGenerating, onSend }: ConversationPanelProps) {
  const [input, setInput] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const streamRef = useRef<HTMLDivElement>(null);

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
      <div className="chat-stream" ref={streamRef}>
        {messages.length === 0 && (
          <div className="chat-empty">
            描述你的设计需求，开始创作
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`chat-msg ${msg.role}`}>
            {msg.attachments && msg.attachments.length > 0 && (
              <div className="chat-attachments">
                {msg.attachments.map((url, i) => (
                  <img key={i} className="chat-attachment" src={url} alt={`素材 ${i + 1}`} />
                ))}
              </div>
            )}
            <div className="chat-bubble">{msg.text}</div>
          </div>
        ))}

        {messages.length > 0 && (
          <TemplateSection />
        )}
      </div>

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
