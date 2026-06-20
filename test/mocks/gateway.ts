/**
 * Mock Gateway —— 模拟 AI 响应，零 API 消耗。
 *
 * mockChatGateway：模拟 ChatGateway，返回预设的流式文本。
 * mockImageGateway：模拟 ImageGateway，返回预设图片 URL。
 * mockChatContext：不做压缩/截断的透传 Context。
 */

import type { ChatGateway } from '../../src/gateway/index';
import type { ImageGateway, ImageResult } from '../../src/gateway/index';
import type { ChatChunk } from '../../src/gateway/type/chat';
import type { ChatContext, BuildResult } from '../../src/context/index';
import type { ChatMessage } from '../../src/gateway/type/chat';

// ══════════════════════════════════
// Mock Chat Gateway
// ══════════════════════════════════

export interface MockChatGatewayConfig {
  /** 预设的完整响应文本（会被拆成多个 chunk 逐个吐出） */
  responseText?: string;
  /** 每个 chunk 的延迟 ms，默认 1（几乎瞬时） */
  chunkDelay?: number;
  /** 模拟 token 用量 */
  usage?: { promptTokens: number; completionTokens: number };
}

/**
 * 创建模拟 ChatGateway。
 *
 * 预设的 responseText 会被按 10 字一组拆成多个 chunk 逐个 yield，
 * 最后一个 chunk 带上 usage 信息，模拟真实 streaming 行为。
 */
export function mockChatGateway(config: MockChatGatewayConfig = {}): ChatGateway {
  const {
    responseText = '{"test": "ok"}',
    chunkDelay = 1,
    usage = { promptTokens: 100, completionTokens: 50 },
  } = config;

  return {
    async *stream() {
      const text = responseText;

      // 按换行符拆分，模拟自然的分段流式输出
      // 如果没有换行，按 50 字一组拆分
      const chunks = text.includes('\n')
        ? text.split('\n').flatMap((line, i, arr) =>
            i < arr.length - 1 ? [line + '\n'] : [line],
          )
        : splitString(text, 50);

      for (let i = 0; i < chunks.length; i++) {
        const chunk: ChatChunk = {
          content: chunks[i],
          finishReason: i === chunks.length - 1 ? 'stop' : undefined,
        };

        if (chunkDelay > 0) {
          await new Promise((r) => setTimeout(r, chunkDelay));
        }

        yield chunk;
      }

      // 最后 yield 一个只含 usage 的空 chunk，供 session 处理
      // session 不 yield 带 usage 的 chunk，所以内容不会丢失
      yield {
        content: '',
        finishReason: 'stop',
        usage: {
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          totalTokens: usage.promptTokens + usage.completionTokens,
        },
      };
    },
  };
}

/**
 * 创建返回空响应的 mock ChatGateway。
 */
export function mockEmptyChatGateway(): ChatGateway {
  return {
    async *stream() {
      yield {
        content: '',
        finishReason: 'stop',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      };
    },
  };
}

// ══════════════════════════════════
// Mock Image Gateway
// ══════════════════════════════════

export interface MockImageGatewayConfig {
  /** 预设图片 URL */
  imageUrl?: string;
  /** 图片大小描述 */
  imageSize?: string;
  /** 模拟 token 用量 */
  totalTokens?: number;
  /** 模拟延迟 ms */
  delay?: number;
}

/**
 * 创建模拟 ImageGateway。
 */
export function mockImageGateway(config: MockImageGatewayConfig = {}): ImageGateway {
  const {
    imageUrl = 'https://mock.example.com/test-image.png',
    imageSize = '440x440',
    totalTokens = 500,
    delay = 1,
  } = config;

  return {
    async generate() {
      if (delay > 0) {
        await new Promise((r) => setTimeout(r, delay));
      }

      return {
        images: [{ url: imageUrl, size: imageSize }],
        usage: { generatedImages: 1, totalTokens },
      };
    },
  };
}

// ══════════════════════════════════
// Mock Chat Context（透传，不做任何处理）
// ══════════════════════════════════

/**
 * 创建不做压缩/截断的 mock ChatContext。
 * 所有消息原样透传，estimatedTokens 粗略估算。
 */
export function mockChatContext(): ChatContext {
  return {
    async build(
      messages: ChatMessage[],
      userMessage: string,
    ): Promise<BuildResult> {
      const allMessages = [
        ...messages,
        { role: 'user' as const, content: userMessage },
      ];

      // 粗略估算 token 数：每 4 字符 ≈ 1 token
      const estimatedTokens = allMessages.reduce(
        (sum, m) => sum + Math.ceil((m.content?.length ?? 0) / 4),
        0,
      );

      return {
        messages: allMessages,
        estimatedTokens,
        truncated: false,
        truncatedCount: 0,
        compacted: false,
        compactedCount: 0,
      };
    },

    updateUsage() {
      // no-op
    },
  };
}

// ── 工具 ──

/** 将字符串等分成指定大小的数组 */
function splitString(str: string, size: number): string[] {
  const result: string[] = [];
  for (let i = 0; i < str.length; i += size) {
    result.push(str.slice(i, i + size));
  }
  return result;
}
