import { useState, useRef, useCallback } from 'react';
import { Header } from './Header';
import { PreviewPanel } from './PreviewPanel';
import { ConversationPanel } from './ConversationPanel';
import type { Message } from './types';
import {
  createDesignDirector,
  createWriteBrief,
  createDefineVisual,
  createWriteCopy,
  createGenerateLayout,
  createGenerateImage,
} from '../agent/index';
import type { RunnerEvent } from '../agent/index';
import { getChatGateway, getImageGateway } from '../config';
import { createChatContext } from '../context/index';

/**
 * 创建 Design Director 单例（懒初始化）。
 * 浏览器环境不传 renderer（assemble 仅返回 HTML，不渲染成品图）。
 */
function createDirector() {
  const chatGateway = getChatGateway();
  const imageGateway = getImageGateway();
  const chatContext = createChatContext();

  return createDesignDirector({
    gateway: chatGateway,
    context: chatContext,
    subagents: {
      write_brief: createWriteBrief({ gateway: chatGateway, context: chatContext }),
      define_visual: createDefineVisual({ gateway: chatGateway, context: chatContext }),
      write_copy: createWriteCopy({ gateway: chatGateway, context: chatContext }),
      generate_layout: createGenerateLayout({ gateway: chatGateway, context: chatContext }),
      generate_image: createGenerateImage({ imageGateway, outputDir: '', format: 'png' }),
    },
  });
}

/** 从文本中提取 HTML 代码块 */
function extractHtml(text: string): string | null {
  const match = text.match(/```html\s*([\s\S]*?)```/);
  return match ? match[1].trim() : null;
}

export function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedElements, setSelectedElements] = useState<Set<string>>(new Set());
  const [isGenerating, setIsGenerating] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [htmlCode, setHtmlCode] = useState<string | undefined>(undefined);

  const directorRef = useRef<ReturnType<typeof createDirector> | null>(null);
  const abortRef = useRef(false);

  const handleSend = useCallback(async (text: string, files?: File[]) => {
    if (!text.trim()) return;

    // 初始化 Director
    if (!directorRef.current) {
      directorRef.current = createDirector();
    }

    const director = directorRef.current;
    abortRef.current = false;

    // User message
    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      text,
      attachments: files?.map((f) => URL.createObjectURL(f)) ?? [],
    };

    // Pending assistant message
    const assistantId = crypto.randomUUID();
    const assistantMsg: Message = { id: assistantId, role: 'assistant', text: '', delegations: [] };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setIsGenerating(true);

    try {
      for await (const event of director.run(text)) {
        if (abortRef.current) break;
        handleRunnerEvent(event, assistantId, setMessages, setHtmlCode);
      }
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, text: m.text + `\n\n❌ 出错了：${err instanceof Error ? err.message : String(err)}` }
            : m,
        ),
      );
    } finally {
      setIsGenerating(false);
    }
  }, []);

  const handleNewChat = useCallback(() => {
    abortRef.current = true;
    setMessages([]);
    setPreviewUrl(null);
    setHtmlCode(undefined);
    setSelectedElements(new Set());
  }, []);

  const handleExport = useCallback(() => {
    if (!htmlCode) return;
    // 直接下载 HTML 文件，不走 Agent
    const blob = new Blob([htmlCode], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vinart-${Date.now()}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }, [htmlCode]);

  return (
    <div className="app">
      <Header onNewChat={handleNewChat} />
      <div className="main">
        <PreviewPanel
          htmlCode={htmlCode}
          previewUrl={previewUrl}
          selectedElements={selectedElements}
          onToggleElement={(id) => {
            setSelectedElements((prev) => {
              const next = new Set(prev);
              next.has(id) ? next.delete(id) : next.add(id);
              return next;
            });
          }}
          onRegenerateSelected={() => {
            /* TODO: wire to agent pipeline */
          }}
          onExport={htmlCode ? handleExport : undefined}
        />
        <ConversationPanel
          messages={messages}
          isGenerating={isGenerating}
          onSend={handleSend}
        />
      </div>
    </div>
  );
}

/** 处理 Runner 事件，更新消息和预览 */
function handleRunnerEvent(
  event: RunnerEvent,
  assistantId: string,
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
  setHtmlCode: React.Dispatch<React.SetStateAction<string | undefined>>,
) {
  switch (event.type) {
    case 'text':
      // 追加文本到 assistant 消息
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, text: m.text + event.content } : m,
        ),
      );
      break;

    case 'delegate': {
      // 添加委派记录（running 状态）
      const record = { agent: event.agent, task: event.task, status: 'running' as const };
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, delegations: [...(m.delegations ?? []), record] }
            : m,
        ),
      );
      break;
    }

    case 'result':
      // 更新委派记录为完成（从后往前找第一个 matching running）
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== assistantId || !m.delegations) return m;
          const updated = [...m.delegations];
          for (let i = updated.length - 1; i >= 0; i--) {
            if (updated[i].agent === event.agent && updated[i].status === 'running') {
              updated[i] = { ...updated[i], status: 'done', result: event.content };
              break;
            }
          }
          return { ...m, delegations: updated };
        }),
      );

      // 尝试从结果中提取 HTML
      const html = extractHtml(event.content);
      if (html) setHtmlCode(html);
      break;

    case 'done':
      // 尝试从最终文本中提取 HTML
      setMessages((prev) => {
        const msg = prev.find((m) => m.id === assistantId);
        if (msg) {
          const html = extractHtml(msg.text);
          if (html) setHtmlCode(html);
        }
        return prev;
      });
      break;
  }
}
