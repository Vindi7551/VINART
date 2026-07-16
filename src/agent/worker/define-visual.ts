/**
 * define_visual — 美术指导 Subagent
 *
 * 将创意简报转化为视觉方向（配色/字体/版面/图片处理）。
 * 复用现有 Art Director 的 BASE_PROMPT 和 buildArtDirectorContext。
 */

import type { ChatGateway } from '../../gateway/index';
import type { ChatContext } from '../../context/index';
import { createChatSession } from '../../session/index';
import { BASE_PROMPT } from '../art-director/prompt';
import type { Subagent } from '../runner';

export function createDefineVisual(config: {
  gateway: ChatGateway;
  context: ChatContext;
}): Subagent {
  const session = createChatSession({
    systemPrompt: BASE_PROMPT,
    gateway: config.gateway,
    context: config.context,
    temperature: 0.8,
    maxTokens: 16384,
  });

  return {
    name: 'define_visual',

    async run(task: string): Promise<string> {
      let result = '';
      for await (const chunk of session.send(task)) {
        result += chunk.content;
      }
      return result;
    },
  };
}
