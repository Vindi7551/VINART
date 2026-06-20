import type { Agent, AgentConfig } from '../shared/types';
import type { DesignerInput } from './prompt';
import { buildSystemPrompt } from './prompt';
import { createChatSession } from '../../session/index';

interface CreateDesignerParams extends AgentConfig {
  systemPrompt: string;
}

/**
 * 创建设计师 Agent。
 *
 * 职责：将视觉方向和文案集转化为 HTML+CSS 代码 + 槽位清单。
 * 产出物交给编排器——HTML 给制作 Agent，槽位清单用于 fork 素材师。
 *
 * 温度默认较低（0.3），因为代码生成需要确定性和一致性。
 */
export function createDesigner(
  config: CreateDesignerParams,
): Agent<DesignerInput, string> {
  const session = createChatSession({
    systemPrompt: config.systemPrompt,
    gateway: config.gateway,
    context: config.context,
    temperature: config.temperature ?? 0.3,
    maxTokens: config.maxTokens ?? 65536,
  });

  return {
    name: 'designer',
    session,

    async run(_input: DesignerInput): Promise<string> {
      const prompt = [
        '请根据以上视觉方向和文案内容，生成完整的 HTML+CSS 代码和槽位清单。',
        '记住：HTML 在 ```html 代码块中，槽位清单 JSON 在 ```json 代码块中，',
        '两个部分用 ===SLOTS=== 分隔。',
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
export function createDesignerFromInput(
  input: DesignerInput,
  config: Omit<AgentConfig, 'systemPrompt'>,
): Agent<DesignerInput, string> {
  return createDesigner({
    ...config,
    systemPrompt: buildSystemPrompt(input),
  });
}
