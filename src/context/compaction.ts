import type { ChatMessage } from '../gateway/type/chat';
import type { ChatGateway } from '../gateway/index';

/** Compaction 配置 */
export interface CompactionFnConfig {
  /** 用于执行压缩的 gateway（通常用降级模型，省主模型 token） */
  gateway: ChatGateway;
  /** 自定义压缩提示词，默认使用内置模板 */
  systemPrompt?: string;
}

/**
 * 创建一个可用于 ChatContextConfig.compaction.compact 的压缩函数。
 *
 * 原理：
 * - 把旧消息格式化为对话记录
 * - 让模型生成一段精简摘要（保留关键决策、需求、约束）
 * - 返回的摘要字符串会被 context 插回消息列表作为 system message
 *
 * 典型用法：
 *   const compact = createCompactionFn({ gateway: cheapGateway });
 *   const ctx = createChatContext({ compaction: { enabled: true, compact } });
 */
export function createCompactionFn(config: CompactionFnConfig): (messages: ChatMessage[]) => Promise<string> {
  const { gateway, systemPrompt } = config;

  return async (messages: ChatMessage[]): Promise<string> => {
    // 把旧消息格式化为对话记录
    // 过滤 assistant 里的 tool_call 内容（纯 JSON）——
    // 参数动辄几千 token，保留原文无意义。
    // assistant 的思考文本已描述"我在做什么"，压缩模型据此概括即可。
    // TODO: 等 ChatMessage.role 扩展 'tool' 后，同时过滤 role==='tool' 的消息
    const transcript = messages
      .filter((m) => m.role !== 'assistant' || !isToolCallContent(m.content))
      .map((m) => `[${m.role === 'user' ? '用户' : 'AI'}]: ${m.content}`)
      .join('\n\n');

    const compactionSystemPrompt = systemPrompt ?? [
      '你是一个对话摘要助手。',
      '请将以下对话历史压缩为一段精简的摘要（中文）。',
      '',
      '必须保留：',
      '- 用户的所有需求和约束条件',
      '- 做出的关键设计决策及其原因',
      '- 用户对结果的反馈（满意/不满意什么）',
      '- 正在进行中的工作方向',
      '- 任何明确的数据、数值、文件名',
      '',
      '可以省略：',
      '- 过多的代码细节（保留"实现了一个登录组件"而非完整代码）',
      '- 冗余的来回确认',
      '- 已被后续修改覆盖的旧方案',
      '',
      '输出：一段 200-500 token 的中文摘要，不要用列表格式。',
    ].join('\n');

    const compactMessages: ChatMessage[] = [
      { role: 'system', content: compactionSystemPrompt },
      { role: 'user', content: `请压缩以下对话历史：\n\n${transcript}` },
    ];

    // 非流式收集完整摘要
    let summary = '';
    for await (const chunk of gateway.stream(compactMessages, {
      temperature: 0.3,
      maxTokens: 1024,
    })) {
      summary += chunk.content;
    }

    return summary.trim();
  };
}

/**
 * 判断 assistant 消息内容是否为 tool call（而非自然语言）。
 * 后续 ChatMessage 类型扩展 tool_calls 字段后用结构化判断替代。
 */
function isToolCallContent(content: string): boolean {
  // tool call 通常是纯 JSON 或以特定标记开头
  const trimmed = content.trim();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}
