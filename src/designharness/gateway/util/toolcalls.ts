/**
 * 工具调用流式增量的折叠助手 —— 协议中立。
 *
 * OpenAI 语义：一轮流里，一次工具调用拆成多个 ToolCallDelta——
 * 首个带 index+id+name，后续只带 arguments 字符串碎片；
 * 并行调用靠 index 区分。消费方收齐一轮流的所有 delta 后在这里折叠。
 *
 * 为什么放 gateway 而不是 agentLoop：折叠规则是协议语义（换一家兼容模型
 * 还是这套分片形状），不是调用方的业务逻辑——按项目判据归通用层。
 */

import type { ToolCall, ToolCallDelta } from '../type/chat';

/**
 * 把一轮流里收到的全部 tool_calls 增量折叠成完整调用列表。
 *
 * - id / name 理论上只在首个分片出现，但 += 写法对「也分片」的实现同样正确
 * - arguments 必然跨分片，必须拼接
 * - 结果按 index 升序（即模型发起调用的顺序）
 * - name 为空的残片（异常流）丢弃，不产出空调用
 */
export function foldToolCallDeltas(deltas: ToolCallDelta[]): ToolCall[] {
  const byIndex = new Map<number, { id: string; name: string; arguments: string }>();
  for (const d of deltas) {
    const cur = byIndex.get(d.index) ?? { id: '', name: '', arguments: '' };
    if (d.id) cur.id += d.id;
    if (d.name) cur.name += d.name;
    if (d.arguments) cur.arguments += d.arguments;
    byIndex.set(d.index, cur);
  }
  return [...byIndex.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, c]) => ({
      call: {
        id: c.id,
        type: 'function' as const,
        function: { name: c.name, arguments: c.arguments },
      },
      index,
    }))
    .filter(({ call }) => call.function.name !== '')
    .map(({ call }) => call);
}
