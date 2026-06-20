import { useState, useEffect } from 'react';
import { Header } from './Header';
import { PreviewPanel } from './PreviewPanel';
import { ConversationPanel } from './ConversationPanel';
import { MOCK_MESSAGES, MOCK_PREVIEW_SVG } from './mock';
import type { Message } from './types';

export function App() {
  const [messages, setMessages] = useState<Message[]>(MOCK_MESSAGES);
  const [selectedElements, setSelectedElements] = useState<Set<string>>(new Set());
  const [isGenerating, setIsGenerating] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(MOCK_PREVIEW_SVG);
  const [htmlCode, setHtmlCode] = useState<string | undefined>(undefined);

  // Dev: 加载设计师产出的 HTML 做预览测试
  useEffect(() => {
    fetch('/designer-output.html')
      .then((res) => res.text())
      .then((html) => {
        setHtmlCode(html);
        setPreviewUrl(null); // 隐藏占位图
      })
      .catch(() => {
        // 文件不存在就用占位图
      });
  }, []);

  return (
    <div className="app">
      <Header onNewChat={() => {
        setMessages([]);
        setPreviewUrl(null);
        setHtmlCode(undefined);
        setSelectedElements(new Set());
      }} />
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
        />
        <ConversationPanel
          messages={messages}
          isGenerating={isGenerating}
          onSend={(text, files) => {
            setMessages((prev) => [
              ...prev,
              {
                id: crypto.randomUUID(),
                role: 'user',
                text,
                attachments: files?.map((f) => URL.createObjectURL(f)) ?? [],
              },
            ]);
            // Simulate a response
            const replyId = crypto.randomUUID();
            setIsGenerating(false);
            setTimeout(() => {
              setMessages((prev) => [
                ...prev,
                { id: replyId, role: 'assistant', text: '已收到你的调整意见，正在重新生成...（此阶段为 mock 回复）' },
              ]);
            }, 400);
          }}
        />
      </div>
    </div>
  );
}
