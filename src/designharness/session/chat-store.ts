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
import { createSkillTool } from '../skills/skill-tool';
import { createSketchTool } from '../tools/sketch-plan';
import { createGetDesignTool } from '../tools/get-design';
import { createPatchDocTool } from '../tools/patch-doc';
import { createEditStructureTool } from '../tools/edit-structure';
import { createGenerateAssetsTool } from '../tools/generate-assets';
import { createSpawnAgentsTool } from '../tools/spawn-agents';
import { createAskUserTool } from '../tools/ask-user';
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
    /**
     * 主 AI 的工具表。
     *
     * ⚠️ **旧契约那一批工具已于 2026-10-15 摘除**（`spawn_design_agents` /
     * `render_design` / `generate_assets` / `compile_appearance` / `read_spec` / `edit_spec`）：
     * 它们建立在已删除的 `document/design-sketch.ts` 契约上（`design-sketch.json` +
     * `design-appearance.json`），而落盘协议早已换成单份 `doc.json`（词汇表）。
     * ⇒ 这一层要**重新对着词汇表长**，是独立的一步（见 CLAUDE.md 的核心链路）。
     * 2026-10-23：`spawn_agents` 已按新 doc 契约重新接回（runner 未变）。
     * 现在留：`skill`（技能加载）+ `sketch_plan`（**只新建**版式）
     * + `get_design`（当前 doc 语义视图，含 frame01/rect01）
     * + `patch_doc`（move/size/rotate/opacity + 颜色/字体/asset/text）
     * + `edit_structure`（增删元素/图层、跨层移动、图层排序）
     * + `generate_assets`（生图/线框 SVG 落盘，不改 doc）
     * + `spawn_agents`（向子 agent 派通用任务；每个 job 自带 tools 白名单）
     * + `ask_user`（结构化提问，阻塞当前 turn 等用户回答）。
     */
    tools: [
      createSkillTool({ sessionId }),
      createSketchTool({ sessionId }),
      createGetDesignTool({ sessionId }),
      createPatchDocTool({ sessionId }),
      createEditStructureTool({ sessionId }),
      createGenerateAssetsTool({ sessionId }),
      createSpawnAgentsTool({ sessionId }),
      createAskUserTool({ sessionId }),
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
