/**
 * 委派循环（Manager-Subagent Runner）
 *
 * 在 Session 外部运行——不侵入 Session、不拦截流、不修改消息历史。
 * 通过多次调用 session.send() 实现 Manager → Subagent → Manager 的循环。
 *
 * Manager 回复中用 @name 标记委派指令，Runner 检测到后执行对应
 * Subagent，将结果作为下一轮 session.send() 的用户消息传入，循环直到
 * Manager 不再发出委派指令。
 */

import type { ChatSession } from '../session/index';

// ══════════════════════════════════════════
// 类型
// ══════════════════════════════════════════

/** Subagent = 独立 ChatSession + 角色定义 */
export interface Subagent {
  /** 名字，对应 Manager 回复中的 @name */
  readonly name: string;
  /** 执行委派任务 */
  run(task: string): Promise<string>;
}

/** 委派循环中产出的事件，前端可据此渲染进度 */
export type RunnerEvent =
  | { type: 'text'; content: string }              // Manager 的流式文本
  | { type: 'delegate'; agent: string; task: string }  // 委派开始
  | { type: 'result'; agent: string; content: string }  // 委派结果
  | { type: 'done' };                             // 本轮完成

// ══════════════════════════════════════════
// 委派循环
// ══════════════════════════════════════════

/**
 * 运行 Manager 的委派循环。
 *
 * 流程：
 *   1. session.send(userMessage)  →  收集 Manager 回复
 *   2. 检测回复中是否有 @name 委派指令
 *   3. 有 → 执行 Subagent → 结果作为下一轮用户消息 → 回到步骤 1
 *   4. 无 → 本轮对话结束
 */
export async function* runManager(
  managerSession: ChatSession,
  subagents: Record<string, Subagent>,
  userMessage: string,
): AsyncIterable<RunnerEvent> {
  let nextMessage = userMessage;

  while (true) {
    const stream = managerSession.send(nextMessage);
    let reply = '';

    for await (const chunk of stream) {
      reply += chunk.content;
      yield { type: 'text', content: chunk.content };
    }

    // 检测 @name 委派指令
    const mentions = parseMentions(reply);
    if (mentions.length === 0) {
      yield { type: 'done' };
      return;
    }

    // 通知前端：开始委派
    for (const { agent, task } of mentions) {
      yield { type: 'delegate', agent, task };
    }

    // 执行委派（不冲突的任务并行执行）
    const results = await Promise.all(
      mentions.map(async ({ agent, task }) => {
        const sub = subagents[agent];
        const result = sub
          ? await sub.run(task).catch(
              (err) => `执行失败：${err instanceof Error ? err.message : String(err)}`,
            )
          : `错误：找不到团队成员 "${agent}"`;

        return { agent, result };
      }),
    );

    // 通知前端：委派结果
    for (const { agent, result } of results) {
      yield { type: 'result', agent, content: result };
    }

    // 下一轮：Subagent 产出作为用户消息
    nextMessage = results
      .map(({ agent, result }) => `[${agent} 返回]\n${result}`)
      .join('\n\n---\n\n') + '\n\n请继续。';
  }
}

// ══════════════════════════════════════════
// @name 解析
// ══════════════════════════════════════════

interface Mention {
  agent: string;
  task: string;
}

/**
 * 从 Manager 回复中提取 @name 委派指令。
 */
function parseMentions(text: string): Mention[] {
  const pattern = /@(\w+)\s+([^@]+?)(?=\s*@\w+\s|$)/gs;
  const mentions: Mention[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const task = match[2].trim();
    if (task.length >= 10) {
      mentions.push({ agent: match[1], task });
    }
  }
  return mentions;
}
