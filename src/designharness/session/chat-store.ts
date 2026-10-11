/**
 * 会话存储(chat-store)—— LLM 对话会话的池与配置,归属 harness。
 *
 * 职责:管理 sessionId → ChatSession 的池(服务重启后按需从转录灌回历史)、
 * 持有设计助手的 system prompt。HTTP 层(dev-server 的路由壳)只调这里,
 * 不再自带任何对话逻辑——将来正式服务宿主替换时,本文件原样随 harness 走。
 */
import { createSessionManager } from './manager';
import { createChatContext } from '../context';
import { getChatGateway } from '../../config';
import * as transcript from './transcript';
import { createSpawnTool } from '../subagent/spawn-tool';
import { createRenderDesignTool } from '../tools/render-design';
import { createGenerateAssetsTool } from '../tools/generate-assets';
import { createCompileAppearanceTool } from '../tools/compile-appearance';
import { createReadSpecTool, createEditSpecTool } from '../tools/edit-spec';
import { createSkillTool } from '../skills/skill-tool';
import type { ChatSession } from './types';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 主 AI 的 system prompt——**单一真源是 assistant-system.md**（同目录）。
 * 拆出文件是为了改提示词不必改代码、不必重启服务；改完 .md 即生效。
 * 进程内读一次缓存（提示词在进程生命周期内不变）。
 */
const ASSISTANT_SYSTEM_PATH = resolve('src/designharness/session/assistant-system.md');
let assistantSystemCache: string | null = null;
function assistantSystem(): string {
  if (assistantSystemCache === null) {
    assistantSystemCache = readFileSync(ASSISTANT_SYSTEM_PATH, 'utf8');
  }
  return assistantSystemCache;
}

const chatSessions = new Map<string, ChatSession>();
const manager = createSessionManager();

/** 取会话(无则创建并从转录灌回历史;异步灌,不阻塞调用方) */
export function getChatSession(sessionId: string): ChatSession {
  const existing = chatSessions.get(sessionId);
  if (existing) return existing;
  const session = manager.create({
    label: sessionId,
    id: sessionId,
    systemPrompt: assistantSystem(),
    gateway: getChatGateway(),
    context: createChatContext({ maxInputTokens: 200000 }),
    // 输出预算对齐输入侧(200k)的量级:主 AI 单轮要在一个 tool call 里塞进多个
    // 自包含 brief(如 spawn 一次 3 个长简报),8192 会被思考吃掉大半后从中间截断
    // 参数 JSON(实测 Unterminated string at position 2015)——32768 与
    // provider 默认值一致,也够写满一批 brief。
    maxTokens: 32768,
    // 主 AI 的工具表:spawn 委派 + 成品渲染 + 素材生成(自带两段式钱闸) + 配色编译。
    // 工具闭包持 sessionId,execute 时现取 workDir(工作目录可中途更改)——
    // 工具与会话同生命周期,随会话删除而弃
    tools: [
      createSpawnTool({ sessionId }),
      createRenderDesignTool({ sessionId }),
      createGenerateAssetsTool({ sessionId }),
      createCompileAppearanceTool({ sessionId }),
      createReadSpecTool({ sessionId }),
      createEditSpecTool({ sessionId }),
      createSkillTool({ sessionId }),
    ],
  });
  chatSessions.set(sessionId, session);
  void transcript
    .loadTranscript(sessionId)
    .then(async (events) => {
      // 带图历史重放需要 workDir 定位图片文件（transcript 里只存相对路径）
      const workDir = await transcript.getWorkDir(sessionId);
      const msgs = await transcript.deriveMessages(events, workDir);
      if (msgs.length) session.restore(msgs);
    })
    .catch(() => {});
  return session;
}

/** 会话被删除时清理池 */
export function dropChatSession(sessionId: string): void {
  chatSessions.delete(sessionId);
}

/** 只读流状态检查（DELETE 会话前拦「正在生成」——不能用 getChatSession，它有创建副作用） */
export function isSessionStreaming(sessionId: string): boolean {
  return chatSessions.get(sessionId)?.isStreaming ?? false;
}
