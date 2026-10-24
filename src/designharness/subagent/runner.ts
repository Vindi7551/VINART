/**
 * 子 agent 批量调度器 —— 并发池 + 父账本记账 + 批次取消。
 *
 * 与引擎的分工：agent-loop 只管单个子 agent 的模型↔工具循环（纯，可假流测试）；
 * runner 管批量、记账、取消。两者都不 import src/config——stream 由调用方注入
 * （服务层传 getChatGateway().stream，测试传脚本化假流）。
 *
 * 记账契约：
 * - 每个 job 生成 runId，父账本落两条事件，以 detail.runId 配对：
 *     agent-spawn  输入全文（brief 不截断——账本是数据源不是日志）
 *     agent-result 结果（stopReason/summary/artifacts/diagnostic/usage）
 * - 子 transcript 落 agents/<sessionId>/<runId>/transcript.jsonl（按会话组织）
 *
 * 取消语义：
 * - 外部 signal abort 后，未启动的 job 不发起任何模型调用，产出占位 outcome
 *   （runId 为空串、不落账本——从未 spawn 就没有 result 对，不造孤儿事件）
 * - 运行中的 job 靠循环引擎的检查点自然退出（stopReason 'aborted'），
 *   其 result 正常落账，与 spawn 配对
 * - 单个 job 失败不连坐其他 job（并行独立性，fail-loud 记账）
 *
 * 缓存约定：system 与 seed 由本层原样透传给每个 job——同批次字节级相同，
 * 前缀缓存命中；brief 是各 job 差异的起点。
 */

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ChatMessage } from '../gateway/type/chat';
import { agentTranscriptPath, appendEvent } from '../session/transcript';
import { runAgentLoop } from './agent-loop';
import type { AgentStream } from './agent-loop';
import type { AgentOutcome, AgentTool, AgentUsage } from './types';

/** 一批里的一个子 agent 任务 */
export interface AgentJobSpec {
  /** 展示标签，如「PT03 材质特写」——账本与 UI 卡片用 */
  label: string;
  /** 版式名（如 "PT03"）——可选，仅透传到账本与进度事件，供 UI 显示 */
  name?: string;
  /** 任务简报（差异起点） */
  brief: string;
  /** 工作目录（绝对路径）；缺省用批次 dir */
  dir?: string;
  /** 工具表覆盖；缺省用批次 tools */
  tools?: AgentTool[];
  maxTurns?: number;
  temperature?: number;
}

export interface AgentBatchOptions {
  /** 父会话 id——记账落点 + 子 transcript 归属 */
  sessionId: string;
  /** system prompt：同批次所有 job 相同 → 前缀缓存 */
  system: string;
  /** 共享 seed（宿主拼装一次，字节级复用） */
  seed: ChatMessage[];
  jobs: AgentJobSpec[];
  /** 批次根工作目录（job 未指定 dir 时的缺省） */
  dir: string;
  /** 批次默认工具表（job 可覆盖） */
  tools: AgentTool[];
  /** 流式对话函数（依赖注入，同 agent-loop） */
  stream: AgentStream;
  /** 同时运行上限（默认 4） */
  maxConcurrent?: number;
  /** 批次默认轮数上限（透传引擎，缺省 12） */
  maxTurns?: number;
  /** 批次默认温度（透传引擎，缺省 0.3） */
  temperature?: number;
  /** 批次取消信号 */
  signal?: AbortSignal;
  /**
   * 进度事件回调（可选）：每个 job 在 spawn 落账后 / result 落账后各回调一次
   * ——调用方（spawn 工具）接上后经 SSE 实时推给前端渲染委派卡片。
   * 与账本事件同形状（kind: 'agent-spawn' | 'agent-result'），多带一个 index。
   */
  onEvent?: (evt: AgentBatchEvent) => void;
}

/** 批次进度事件（与父账本事件同形状；index 是 jobs 数组下标） */
export type AgentBatchEvent =
  | { kind: 'agent-spawn'; index: number; runId: string; label: string; name?: string; brief: string }
  | {
      kind: 'agent-result';
      index: number;
      runId: string;
      label: string;
      name?: string;
      stopReason: AgentOutcome['stopReason'];
      summary: string | null;
      artifacts: string[];
      diagnostic: string | null;
    };

export interface AgentBatchOutcome {
  /** 与 jobs 等长同序；未启动的 job 是占位 outcome（runId 空串，stopReason 'aborted'） */
  outcomes: AgentOutcome[];
  /** 批次是否发生过取消 */
  aborted: boolean;
  /** 全批 usage 汇总 */
  usage: AgentUsage;
}

export function newRunId(): string {
  return `agt_${crypto.randomUUID().slice(0, 8)}`;
}

function zeroUsage(): AgentUsage {
  return { llmCalls: 0, promptTokens: 0, completionTokens: 0 };
}

export async function runAgentBatch(opts: AgentBatchOptions): Promise<AgentBatchOutcome> {
  const maxConcurrent = Math.max(1, opts.maxConcurrent ?? 4);
  const signal = opts.signal;

  const outcomes: Array<AgentOutcome | undefined> = new Array(opts.jobs.length).fill(undefined);
  let cursor = 0;
  let sawAbort = false;
  const usage: AgentUsage = zeroUsage();

  const runOne = async (index: number): Promise<void> => {
    const job = opts.jobs[index];
    const runId = newRunId();
    const label = job.label;
    const name = job.name;
    const dir = job.dir ?? opts.dir;
    const tools = job.tools ?? opts.tools;
    const maxTurns = job.maxTurns ?? opts.maxTurns;
    const temperature = job.temperature ?? opts.temperature;

    // spawn 记账：输入全文。先落账再启动——账本顺序保证 spawn 恒先于 result
    await appendEvent(opts.sessionId, {
      ts: new Date().toISOString(),
      kind: 'action',
      action: 'agent-spawn',
      detail: {
        runId,
        label,
        brief: job.brief,
        tools: tools.map((t) => t.name),
        dir,
        maxTurns: maxTurns ?? 12,
        temperature: temperature ?? 0.3,
        index,
        name: name ?? null,
      },
    });
    opts.onEvent?.({ kind: 'agent-spawn', index, runId, label, name, brief: job.brief });

    if (signal?.aborted) {
      // 已 spawn 未启动：补配对 result，账本不破对
      sawAbort = true;
      outcomes[index] = {
        runId,
        label,
        stopReason: 'aborted',
        artifacts: [],
        diagnostic: '批次取消，任务未启动',
        usage: zeroUsage(),
      };
      await appendEvent(opts.sessionId, {
        ts: new Date().toISOString(),
        kind: 'action',
        action: 'agent-result',
        detail: {
          runId,
          label,
          stopReason: 'aborted',
          summary: null,
          artifacts: [],
          diagnostic: '批次取消，任务未启动',
          usage: zeroUsage(),
        },
      });
      opts.onEvent?.({ kind: 'agent-result', index, runId, label, name, stopReason: 'aborted', summary: null, artifacts: [], diagnostic: '批次取消，任务未启动' });
      return;
    }

    const logPath = agentTranscriptPath(opts.sessionId, runId);
    mkdirSync(dirname(logPath), { recursive: true });

    const outcome = await runAgentLoop(
      { runId, label, system: opts.system, seed: opts.seed, brief: job.brief, tools, maxTurns, temperature },
      { stream: opts.stream, dir, logPath, signal },
    );

    outcomes[index] = outcome;
    usage.llmCalls += outcome.usage.llmCalls;
    usage.promptTokens += outcome.usage.promptTokens;
    usage.completionTokens += outcome.usage.completionTokens;
    if (outcome.stopReason === 'aborted') sawAbort = true;

    await appendEvent(opts.sessionId, {
      ts: new Date().toISOString(),
      kind: 'action',
      action: 'agent-result',
      detail: {
        runId,
        label,
        stopReason: outcome.stopReason,
        summary: outcome.summary ?? null,
        artifacts: outcome.artifacts,
        diagnostic: outcome.diagnostic ?? null,
        usage: outcome.usage,
        name: name ?? null,
      },
    });
    opts.onEvent?.({
      kind: 'agent-result',
      index,
      runId,
      label,
      name,
      stopReason: outcome.stopReason,
      summary: outcome.summary ?? null,
      artifacts: outcome.artifacts,
      diagnostic: outcome.diagnostic ?? null,
    });
  };

  // worker 池：N 个 worker 从共享 cursor 取任务
  const worker = async (): Promise<void> => {
    while (cursor < opts.jobs.length) {
      if (signal?.aborted) return; // 剩余槽位由下方兜底补占位
      const i = cursor++;
      await runOne(i);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(maxConcurrent, opts.jobs.length) }, () => worker()),
  );

  // 取消后未启动的槽位：补占位 outcome（等长同序），但不落账本——
  // 从未 spawn 的 job 没有 result 对，不造孤儿事件
  for (let i = 0; i < outcomes.length; i++) {
    if (!outcomes[i]) {
      sawAbort = true;
      outcomes[i] = {
        runId: '',
        label: opts.jobs[i].label,
        stopReason: 'aborted',
        artifacts: [],
        diagnostic: '批次取消，任务未启动',
        usage: zeroUsage(),
      };
    }
  }

  return {
    outcomes: outcomes as AgentOutcome[],
    aborted: sawAbort,
    usage,
  };
}
