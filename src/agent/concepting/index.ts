/**
 * 概念阶段 —— 美术指导 + 文案配对协作
 *
 * 这不是两个独立的 Agent，而是一个共享 ChatSession 的配对。
 * 两个角色在同一对话中交替产出和互调，直至收敛或达到轮数上限。
 *
 * 编排器使用此工厂创建配对实例，管理 ≤5 轮的多轮互调。
 */

import type { ChatSession } from '../../session/index';
import type { ChatGateway } from '../../gateway/index';
import type { ChatContext } from '../../context/index';
import type { CreativeBrief } from '../../schema/index';
import { BASE_PROMPT as ART_DIRECTOR_PROMPT } from '../art-director/prompt';
import { BASE_PROMPT as COPYWRITER_PROMPT } from '../copywriter/prompt';
import { buildArtDirectorContext } from '../art-director/prompt';
import { buildCopywriterContext } from '../copywriter/prompt';
import { createChatSession } from '../../session/index';

// ══════════════════════════════════════════
// 配置
// ══════════════════════════════════════════

export interface ConceptingConfig {
  gateway: ChatGateway;
  context: ChatContext;
  /** 最大互调轮数，默认 5 */
  maxRounds?: number;
  temperature?: number;
  maxTokens?: number;
}

/** 配对产出的原始文本（编排器负责解析为结构化数据） */
export interface ConceptingResult {
  /** 视觉方向的原始 JSON 文本 */
  visualDirectionRaw: string;
  /** 文案集的原始 JSON 文本 */
  copyDeckRaw: string;
  /** 实际用了多少轮 */
  roundsUsed: number;
  /** 是否达到上限被迫收敛 */
  forcedConvergence: boolean;
  /** 完整的消息历史（调试用） */
  session: ChatSession;
}

// ══════════════════════════════════════════
// 配对工厂
// ══════════════════════════════════════════

/**
 * 创建概念阶段配对。
 *
 * 返回的对象不是标准的 Agent<TInput,TOutput>，而是一个专用的配对。
 * 编排器调用 run() 启动互调循环。
 */
export function createConceptingPair(config: ConceptingConfig) {
  const { gateway, context, maxRounds = 5, temperature = 0.8, maxTokens = 16384 } = config;

  return {
    name: 'conceptingPair',
    maxRounds,

    /**
     * 运行配对互调。
     *
     * 流程：
     *   Round 1: 双方各自产出初稿
     *   Round 2-N: 互相审阅、提建议、调整
     *   收敛 or 达到 maxRounds 后停止
     *
     * 收敛判断：编排器检查本轮产出是否与上轮实质性相同。
     * 本方法只负责执行到 maxRounds，编排器外层做收敛判断。
     */
    async run(brief: CreativeBrief): Promise<ConceptingResult> {
      // 合并 system prompt
      const systemPrompt = [
        ART_DIRECTOR_PROMPT,
        '',
        '---',
        '',
        COPYWRITER_PROMPT,
        '',
        '---',
        '',
        '协作规则：',
        '1. 这是一次协作对话。你和你的搭档共享这个对话。',
        '2. 每次回复时，先标注你的角色（【美术指导】或【文案】），然后输出你的内容。',
        '3. 如果搭档的产出影响了你的工作（如文案长度影响版面空间），直接说出来，要求对方调整。',
        '4. 每一轮都要审阅搭档上一轮的产出，给出具体反馈，不要只是说"好的"。',
        '5. 当你认为自己的工作已经不需要再改时，在回复末尾加上 [已确定]。',
        '6. 当双方都 [已确定] 时，本阶段结束。',
      ].join('\n');

      const session = createChatSession({
        systemPrompt,
        gateway,
        context,
        temperature,
        maxTokens,
      });

      // Round 1: 给出简报和双方上下文，要求产出初稿
      const round1Prompt = [
        '以下是你需要处理的创意简报。请**美术指导**和**文案**分别产出初稿。',
        '',
        '【美术指导】请基于简报输出完整的 VisualDirection JSON。',
        buildArtDirectorContext(brief),
        '',
        '【文案】请基于简报输出完整的 CopyDeck JSON。',
        buildCopywriterContext(brief),
        '',
        '请双方依次产出。先美术指导，再文案。',
      ].join('\n');

      let lastResponse = '';
      for await (const chunk of session.send(round1Prompt)) {
        lastResponse += chunk.content;
      }

      // Round 2-N: 互调
      for (let round = 2; round <= maxRounds; round++) {
        // 检查是否双方都已确认
        if (
          lastResponse.includes('【美术指导】') && lastResponse.includes('[已确定]') &&
          lastResponse.includes('【文案】') && lastResponse.includes('[已确定]')
        ) {
          return {
            visualDirectionRaw: extractSection(lastResponse, '美术指导'),
            copyDeckRaw: extractSection(lastResponse, '文案'),
            roundsUsed: round - 1,
            forcedConvergence: false,
            session,
          };
        }

        const refinePrompt = [
          `第 ${round} 轮互调。请双方审阅搭档上一轮的产出：`,
          '- 哪里做得好？哪里需要调整？',
          '- 如果有冲突（如文案太长 vs 布局空间不够），协商解决。',
          '- 各自调整产出后重新输出完整结果。',
          '- 如果满意当前结果，在末尾加上 [已确定]。',
        ].join('\n');

        let response = '';
        for await (const chunk of session.send(refinePrompt)) {
          response += chunk.content;
        }
        lastResponse = response;
      }

      // 达到上限，强制收敛
      return {
        visualDirectionRaw: extractSection(lastResponse, '美术指导'),
        copyDeckRaw: extractSection(lastResponse, '文案'),
        roundsUsed: maxRounds,
        forcedConvergence: true,
        session,
      };
    },
  };
}

/**
 * 从共享对话的最后一轮回复中提取指定角色的 JSON 产出。
 *
 * 1. 找到 "【美术指导】" / "【文案】" 标记
 * 2. 提取两个标记之间的文本
 * 3. 从中提取第一个 JSON 对象 { ... }
 */
function extractSection(text: string, role: '美术指导' | '文案'): string {
  const marker = `【${role}】`;
  const otherMarker = role === '美术指导' ? '【文案】' : '【美术指导】';

  const startIdx = text.indexOf(marker);
  if (startIdx === -1) return '';

  const contentStart = startIdx + marker.length;
  const endIdx = text.indexOf(otherMarker, contentStart);

  const raw = endIdx === -1
    ? text.slice(contentStart)
    : text.slice(contentStart, endIdx);

  // 提取第一个 JSON 对象
  return extractFirstJson(raw);
}

/** 从文本中提取第一个完整的 JSON 对象 { ... } */
function extractFirstJson(text: string): string {
  const start = text.indexOf('{');
  if (start === -1) return text.trim();

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1).trim();
      }
    }
  }

  // JSON 不完整（被截断），尝试返回从 { 开始的所有内容
  return text.slice(start).trim();
}
