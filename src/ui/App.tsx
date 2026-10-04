import { useState, useCallback } from 'react';
import { Header } from './Header';
import { PreviewPanel } from './PreviewPanel';
import { ConversationPanel } from './ConversationPanel';
import type { Message } from './types';

// ══════════════════════════════════════════════════════════
// ⚠️ Agent 层已清空，等待重新设计
// ══════════════════════════════════════════════════════════
//
// 旧的 agent 层（design-director / runner / worker + 结构化那套）
// 已整体移到 .backup/ 下，不在源码树中。
//
// 清空原因：
//   - Manager-Subagent 对话式协作依赖自然语言转述，设计意图每跳一次有损压缩
//   - @name 正则把控制流藏在散文里，任务文本 <10 字会被静默丢弃
//   - 多个 agent 共用同一个 chatContext，并行时 token 预算状态互撞
//
// 重建方向（待定）：代码编排的扁平管线，每步输入输出都是结构化对象，
// 可单独调用、单独验证。
//
// src/schema/（旧设计的合同产物，704 行纯类型）也已移入 .backup/：
//   - schema-*/copy-deck.ts / creative-brief.ts / image-asset.ts
//   - schema-*/slot-spec.ts / visual-direction.ts
//   删除理由：agent 层清空后全项目零引用；与当前「Listing 图方案」这一步无关。
//
// 参考 .backup/：
//   - agent-*/shared/prompt-builder.ts  → assemblePrompt（KV-cache 前缀复用）
//   - agent-*/art-director/prompt.ts    → 视觉方向 prompt（135 行，有复用价值）
//   - agent-*/designer/prompt.ts        → 结构化字段注入 prompt 的正确范式
//   - test-agent-*/                     → 各 agent 的输入输出契约
//   - run-scripts-*/                    → 单步验证脚本（可改造为验证工具）
//
// ══════════════════════════════════════════════════════════

/** agent 层清空后，这里暂时没有可用的生成能力 */
const AGENT_LAYER_EMPTY = true;

export function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedElements, setSelectedElements] = useState<Set<string>>(new Set());
  const [isGenerating, setIsGenerating] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [htmlCode, setHtmlCode] = useState<string | undefined>(undefined);

  const handleSend = useCallback(async (text: string) => {
    if (!text.trim()) return;

    // TODO: agent 层重建后接入
    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      text,
    };
    const noticeMsg: Message = {
      id: crypto.randomUUID(),
      role: 'assistant',
      text: '⚠️ Agent 层已清空，等待重新设计。\n\n当前无法生成内容。重建后此处会接入新的管线。',
    };
    setMessages((prev) => [...prev, userMsg, noticeMsg]);
  }, []);

  const handleNewChat = useCallback(() => {
    setMessages([]);
    setPreviewUrl(null);
    setHtmlCode(undefined);
    setSelectedElements(new Set());
  }, []);

  const handleExport = useCallback(() => {
    if (!htmlCode) return;
    const blob = new Blob([htmlCode], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vinart-${Date.now()}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }, [htmlCode]);

  // 供 UI 判断：agent 层是否可用
  void AGENT_LAYER_EMPTY;
  void setIsGenerating;

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
            /* TODO: agent 层重建后接入 */
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
