/**
 * 设计主管（Design Director）— Manager Agent
 *
 * 拥有完整的决策权，通过 @name 格式委派任务给 Subagent。
 * 审查每一步产出，自主决定流程。
 */

import type { ChatGateway } from '../../gateway/index';
import type { ChatContext } from '../../context/index';
import { createChatSession } from '../../session/index';
import { SYSTEM_PROMPT } from './prompt';
import { runManager } from '../runner';
import type { Subagent, RunnerEvent } from '../runner';

export interface DesignDirectorConfig {
  gateway: ChatGateway;
  context: ChatContext;
  subagents: Record<string, Subagent>;
}

/**
 * 创建设计主管 Agent。
 *
 * 返回的 run() 是一个 AsyncIterable，前端可遍历 RunnerEvent
 * 展示 Manager 的思考过程、委派进度和最终结果。
 */
export function createDesignDirector(config: DesignDirectorConfig) {
  const managerSession = createChatSession({
    systemPrompt: SYSTEM_PROMPT,
    gateway: config.gateway,
    context: config.context,
    temperature: 0.8,
    maxTokens: 32768,
  });

  return {
    name: 'designDirector',

    /** 处理用户输入，返回事件流 */
    run(userMessage: string): AsyncIterable<RunnerEvent> {
      return runManager(managerSession, config.subagents, userMessage);
    },
  };
}
