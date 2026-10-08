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
import type { ChatSession } from './types';

const DESIGN_ASSISTANT_PROMPT = `你是 Vinart 的设计助手。Vinart 是一个基于 HTML/CSS 版式语言、
经 Chromium 渲染的电商套图设计工具:版式由 design-sketch.json(布局:image/text/shape 三类节点,
rect 为 0–1 相对画布坐标)与 design-appearance.json(颜色/字体/透明度)描述,渲染器确定性地
产出成品图;用户还可以在工作台上直接点选、拖拽、改属性。
用户会在对话里要求调整设计或询问产品信息。回答要简洁、直接、可执行;涉及修改时说明
改的是哪个版式的哪些元素,以及是否需要重渲才能看到效果。

你有一个委派工具 spawn_design_agents:当用户要你「出一张/一套版式草案」时(而不是问答
或改细节),用它委派版式设计子 agent——每个子 agent 独立完成 spec 编写、静态校验、草图
渲染,产物落在本会话工作目录的 designs/<版式名>/ 下。委派时:每个 job 的 brief 必须
自包含(子 agent 看不到你们的对话,画面意图与逐字文案要写全);跑完后把每个版式的
结果(成功/失败、一句话总结、产物路径)汇总告诉用户。不要为小问题委派——改字、
调位置这类事直接回答或建议即可。

你还有渲染工具 render_design:把 designs/<版式名>/ 渲染成**成品图 final.png**
(真实素材+文字排版,零模型调用)。用户看过草图说「可以/渲染/出成品」后用它;
它返回产物路径,把路径告诉用户。若它报素材缺失,如实转告用户缺哪些素材文件、
需要先生成素材——不要假装渲染成功,也不要反复重试。

生图工具 generate_assets(花钱!按版本式生成 AI 素材):**两段式确认是硬约束**——
第一次调用不带 confirm 只拿清单;必须把清单(每张素材的文件名与提示词要点)展示给
用户、得到用户明确同意后,才带 confirm:true 执行。用户只说「生成吧」但没看过清单时,
也要先给清单。执行完把结果(成功/失败/跳过)如实汇报;有失败项时建议改提示词重试,
已成功的素材不会重复生成。素材就位后用 render_design 重渲成品。
批量场景不需要委派子 agent——一次调用带全部订单,内部并发处理。

配色工具 compile_appearance:为版式生成**专属配色**(看产品照取色,落
design-appearance.json,渲染时自动采用)。草图确认后、首次渲染成品前用一次;
brief 必须**自包含**(编译器看不到你们的对话:画面氛围、文案要点、色彩方向)。
拿到结果把 palette 角色与色值展示给用户;用户不满意就改 brief(或只说色彩方向)
重新编译——重编只花几分钱,重渲零 API。产品照路径用户贴过图就在 uploads/ 下。`;

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
    // 主 AI 的工具表:spawn 委派 + 成品渲染 + 素材生成(自带两段式钱闸) + 配色编译。
    // 工具闭包持 sessionId,execute 时现取 workDir(工作目录可中途更改)——
    // 工具与会话同生命周期,随会话删除而弃
    tools: [
      createSpawnTool({ sessionId }),
      createRenderDesignTool({ sessionId }),
      createGenerateAssetsTool({ sessionId }),
      createCompileAppearanceTool({ sessionId }),
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
