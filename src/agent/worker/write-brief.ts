/**
 * write_brief — 创意总监 Subagent
 *
 * 将用户需求转化为创意简报 JSON。
 * 复用现有 Creative Director 的 BASE_PROMPT。
 */

import type { ChatGateway } from '../../gateway/index';
import type { ChatContext } from '../../context/index';
import { createChatSession } from '../../session/index';
import { BASE_PROMPT } from '../creative-director/prompt';
import type { Subagent } from '../runner';

export function createWriteBrief(config: {
  gateway: ChatGateway;
  context: ChatContext;
}): Subagent {
  const session = createChatSession({
    systemPrompt: BASE_PROMPT,
    gateway: config.gateway,
    context: config.context,
    temperature: 0.7,
    maxTokens: 8192,
  });

  return {
    name: 'write_brief',

    async run(task: string): Promise<string> {
      const prompt = [
        '请根据以下用户需求输出创意简报（JSON 格式，不要代码块标记）：',
        '',
        task,
      ].join('\n');

      let result = '';
      for await (const chunk of session.send(prompt)) {
        result += chunk.content;
      }
      return result;
    },
  };
}
