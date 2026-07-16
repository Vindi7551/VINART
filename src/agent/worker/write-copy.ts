/**
 * write_copy — 文案 Subagent
 *
 * 将创意简报转化为广告文案（标题/正文/CTA + 变体）。
 * 复用现有 Copywriter 的 BASE_PROMPT。
 */

import type { ChatGateway } from '../../gateway/index';
import type { ChatContext } from '../../context/index';
import { createChatSession } from '../../session/index';
import { BASE_PROMPT } from '../copywriter/prompt';
import type { Subagent } from '../runner';

export function createWriteCopy(config: {
  gateway: ChatGateway;
  context: ChatContext;
}): Subagent {
  const session = createChatSession({
    systemPrompt: BASE_PROMPT,
    gateway: config.gateway,
    context: config.context,
    temperature: 0.8,
    maxTokens: 8192,
  });

  return {
    name: 'write_copy',

    async run(task: string): Promise<string> {
      let result = '';
      for await (const chunk of session.send(task)) {
        result += chunk.content;
      }
      return result;
    },
  };
}
