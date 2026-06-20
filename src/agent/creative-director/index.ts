import type { Agent, AgentConfig } from '../shared/types';
import type { CreativeDirectorInput } from './prompt';
import { buildSystemPrompt } from './prompt';
import { createChatSession } from '../../session/index';

interface CreateCreativeDirectorParams extends AgentConfig {
  systemPrompt: string;
}

/**
 * 创建创意总监 Agent。
 *
 * 职责：将用户原始需求转化为结构化的创意简报（CreativeBrief）。
 * 这是整个创作管线的起点，简报是所有下游 Agent 的共享上下文。
 */
export function createCreativeDirector(
  config: CreateCreativeDirectorParams,
): Agent<CreativeDirectorInput, string> {
  const session = createChatSession({
    systemPrompt: config.systemPrompt,
    gateway: config.gateway,
    context: config.context,
    temperature: config.temperature ?? 0.7,
    maxTokens: config.maxTokens ?? 8192,
  });

  return {
    name: 'creativeDirector',
    session,

    async run(input: CreativeDirectorInput): Promise<string> {
      const prompt = [
        '请根据以下用户需求输出创意简报（JSON 格式，不要代码块标记）：',
        '',
        input.description,
      ].join('\n');

      let result = '';
      for await (const chunk of session.send(prompt)) {
        result += chunk.content;
      }
      return result;
    },
  };
}

/**
 * 便捷工厂：自动拼接 system prompt。
 */
export function createCreativeDirectorFromInput(
  input: CreativeDirectorInput,
  config: Omit<AgentConfig, 'systemPrompt'>,
): Agent<CreativeDirectorInput, string> {
  return createCreativeDirector({
    ...config,
    systemPrompt: buildSystemPrompt(input),
  });
}
