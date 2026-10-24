/**
 * `ask_user` —— 主 AI 的结构化提问工具。
 *
 * 它会**阻塞当前 turn**：服务端登记 pending，前端显示问题卡，
 * 用户回答（POST /answer）后工具 Promise resolve，模型继续同一条回复。
 *
 * 子 agent 不暴露本工具（它们没有用户通道）。
 */

import type { AskOption, AskQuestion } from '../session/turn-parts';
import { askUser } from '../session/ask-registry';
import type { AgentTool } from '../subagent/types';

function normQuestions(raw: unknown): { questions: AskQuestion[]; error?: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { questions: [], error: 'questions 必须是非空数组' };
  }
  if (raw.length > 5) return { questions: [], error: '一次最多问 5 个问题' };
  const ids = new Set<string>();
  const out: AskQuestion[] = [];
  for (const [i, q] of raw.entries()) {
    if (!q || typeof q !== 'object' || Array.isArray(q)) {
      return { questions: [], error: `questions[${i}] 不是对象` };
    }
    const o = q as Record<string, unknown>;
    const id = typeof o.id === 'string' ? o.id.trim() : '';
    const question = typeof o.question === 'string' ? o.question.trim() : '';
    if (!id || !question) return { questions: [], error: `questions[${i}] 需要 id 和 question` };
    if (ids.has(id)) return { questions: [], error: `questions[${i}] 的 id 重复` };
    ids.add(id);

    let options: AskOption[] | undefined;
    if (o.options !== undefined) {
      if (!Array.isArray(o.options) || o.options.length === 0 || o.options.length > 8) {
        return { questions: [], error: `questions[${i}].options 必须是 1–8 项的数组` };
      }
      options = [];
      for (const [j, opt] of o.options.entries()) {
        if (!opt || typeof opt !== 'object' || Array.isArray(opt)) {
          return { questions: [], error: `questions[${i}].options[${j}] 不是对象` };
        }
        const oo = opt as Record<string, unknown>;
        const label = typeof oo.label === 'string' ? oo.label.trim() : '';
        const value = typeof oo.value === 'string' ? oo.value.trim() : label;
        if (!label || !value) {
          return { questions: [], error: `questions[${i}].options[${j}] 需要 label/value` };
        }
        options.push({
          label,
          value,
          ...(typeof oo.description === 'string' && oo.description.trim()
            ? { description: oo.description.trim() }
            : {}),
        });
      }
    }
    out.push({
      id,
      ...(typeof o.header === 'string' && o.header.trim() ? { header: o.header.trim() } : {}),
      question,
      ...(options ? { options } : {}),
      ...(o.multiSelect === true ? { multiSelect: true } : {}),
      ...(o.allowOther === true ? { allowOther: true } : {}),
    });
  }
  return { questions: out };
}

export function createAskUserTool(config: { sessionId: string }): AgentTool {
  return {
    name: 'ask_user',
    description:
      '向用户提出 1–5 个结构化问题，并**暂停当前 turn**，等用户回答后继续。' +
      '每个问题有 id、question，可选 header（短标题）、options（1–8 项 label/value/description）、' +
      'multiSelect、allowOther（允许自由输入）。' +
      '缺少关键信息（画布尺寸/必须文案/参考图/用途/风格方向）或需要用户确认方向时用它；' +
      '不要用散文提问后继续调工具。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['questions'],
      properties: {
        questions: {
          type: 'array',
          minItems: 1,
          maxItems: 5,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'question'],
            properties: {
              id: { type: 'string' },
              header: { type: 'string' },
              question: { type: 'string' },
              multiSelect: { type: 'boolean' },
              allowOther: { type: 'boolean' },
              options: {
                type: 'array',
                minItems: 1,
                maxItems: 8,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['label', 'value'],
                  properties: {
                    label: { type: 'string' },
                    value: { type: 'string' },
                    description: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
    async execute(args, ctx) {
      const parsed = normQuestions(args.questions);
      if (parsed.error) return { content: `ERROR: ${parsed.error}`, isError: true };
      try {
        const answers = await askUser(config.sessionId, parsed.questions, ctx.signal, ctx.onEvent);
        return { content: JSON.stringify({ ok: true, answers }) };
      } catch (e) {
        return {
          content: `ERROR: 提问未完成：${e instanceof Error ? e.message : String(e)}`,
          isError: true,
        };
      }
    },
  };
}
