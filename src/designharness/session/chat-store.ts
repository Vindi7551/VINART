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
import type { ChatSession } from './types';

const DESIGN_ASSISTANT_PROMPT = `你是 Vinart 的设计助手。Vinart 是一个基于 HTML/CSS 版式语言、
经 Chromium 渲染的电商套图设计工具:版式由 design-sketch.json(布局:image/text/shape 三类节点,
rect 为 0–1 相对画布坐标)与 design-appearance.json(颜色/字体/透明度)描述,渲染器确定性地
产出成品图;用户还可以在工作台上直接点选、拖拽、改属性。
用户会在对话里要求调整设计或询问产品信息。回答要简洁、直接、可执行;涉及修改时说明
改的是哪个版式的哪些元素,以及是否需要重渲才能看到效果。`;

const chatSessions = new Map<string, ChatSession>();
const manager = createSessionManager();

/** 取会话(无则创建并从转录灌回历史;异步灌,不阻塞调用方) */
export function getChatSession(sessionId: string): ChatSession {
  const existing = chatSessions.get(sessionId);
  if (existing) return existing;
  const session = manager.create({
    label: sessionId,
    id: sessionId,
    systemPrompt: DESIGN_ASSISTANT_PROMPT,
    gateway: getChatGateway(),
    context: createChatContext({ maxInputTokens: 200000 }),
    maxTokens: 8192,
  });
  chatSessions.set(sessionId, session);
  void transcript
    .loadTranscript(sessionId)
    .then((events) => {
      const msgs = transcript.deriveMessages(events);
      if (msgs.length) session.restore(msgs);
    })
    .catch(() => {});
  return session;
}

/** 会话被删除时清理池 */
export function dropChatSession(sessionId: string): void {
  chatSessions.delete(sessionId);
}
