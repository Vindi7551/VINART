/**
 * 通用 SSE（Server-Sent Events）流解析器。
 *
 * 只负责传输层的 SSE 协议解析：
 * - 从 ReadableStream 读取字节流
 * - 解码为文本
 * - 按行分割
 * - 识别 "event:"、"data:" 等 SSE 字段
 * - 按空行分隔事件
 *
 * 不关心事件内容的语义——那是 provider 的职责。
 *
 * 格式参考：https://html.spec.whatwg.org/multipage/server-sent-events.html
 */

/** 解析后的 SSE 事件原始数据 */
export interface SSEEvent {
  /** 事件类型（event: 行），非必须 */
  event?: string;
  /** 数据内容（data: 行），可能跨多行 */
  data: string;
}

/**
 * 从 ReadableStream 逐事件 yield SSE 事件。
 *
 * 使用方式：
 *   for await (const evt of parseSSE(response.body)) {
 *     // evt.event → 'content_block_delta'（如果有）
 *     // evt.data  → '{"choices":[...]}'
 *   }
 */
export async function* parseSSE(
  body: ReadableStream<Uint8Array> | null,
): AsyncIterable<SSEEvent> {
  if (!body) return;

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let currentEvent: SSEEvent = { data: '' };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      // 最后一行可能不完整，留到下次处理
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trimEnd();

        // 空行 → 事件结束，yield 当前事件
        if (trimmed === '' || trimmed === '\r') {
          if (currentEvent.event || currentEvent.data) {
            yield currentEvent;
          }
          currentEvent = { data: '' };
          continue;
        }

        // event: 行
        if (trimmed.startsWith('event:')) {
          currentEvent.event = trimmed.slice(6).trim();
          continue;
        }

        // data: 行（可跨多行累积）
        if (trimmed.startsWith('data:')) {
          const value = trimmed.slice(5).trim();
          // 多行 data: 用 '\n' 连接
          if (currentEvent.data) {
            currentEvent.data += '\n' + value;
          } else {
            currentEvent.data = value;
          }
          continue;
        }

        // 其他 SSE 字段（id:、retry:）→ 忽略
      }
    }

    // 流结束后如果还有未 yield 的事件，yield 出去
    if (currentEvent.event || currentEvent.data) {
      yield currentEvent;
    }
  } finally {
    reader.releaseLock();
  }
}
