import type { ChatMessage, ChatChunk, ChatOptions } from '../type/chat';
import type { ImageGenerateParams, ImageResult } from '../type/image';

/**
 * 对话/代码生成 Provider 接口。
 * 每个实现封装一种 API 协议的请求格式和 SSE 流解析逻辑。
 */
export interface ChatProvider {
  /** Provider 标识，如 "openai:deepseek-v4-flash"，用于日志和降级定位 */
  readonly name: string;

  /** 发送消息并返回流式响应（AsyncIterable，支持 for await...of） */
  stream(messages: ChatMessage[], opts?: ChatOptions): AsyncIterable<ChatChunk>;
}

/**
 * 图片生成 Provider 接口。
 * 每个实现封装一种图片生成 API 的请求格式和响应解析。
 */
export interface ImageProvider {
  readonly name: string;

  /** 提交生图请求并等待完成，返回图片 URL 列表 */
  generate(params: ImageGenerateParams): Promise<ImageResult>;
}
