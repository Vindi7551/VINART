/**
 * ═══════════════════════════════════════════════════════════════════════
 * ④ brief 编写 —— 规划 + 卖点 + 事实 → compile 可直接吃的创意方案
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 这是链 A 缺失的最后一块：此前 step-03 产出的槽位规划 JSON 没人消费——
 * compile 的输入是**自由格式的创意方案 md**（手写，如 test_product/briefs/*.md）。
 * 本步把结构化规划「翻译」成那种 md。
 *
 * ⚠️ 旧 step-04（三层设计草案：内容→版式→元素）的职责已被 compile.ts **取代**——
 * compile 吃 brief 直接产版式 + VLM 视觉验收，比一次性写死三层草案更可回喂。
 * 所以本步只写「画面意图」，不写版式坐标（那是 compile 的本职）。
 *
 * ## 产出粒度：一个图位一份 brief
 *
 * compile 一次消费一份 brief → 一个版式（一张图）。
 * 套图规划出 N 个图位，就产 N 份 md，落在 `test_product/briefs/<产品名>-<slot>.md`，
 * 与手写 brief 同目录、同用法：`compile.ts test_product/briefs/xxx.md`。
 *
 * ⚠️ MAIN 默认跳过：纯白底 + 商品抠图 + 禁文字，全是机械处理没有设计决策，
 * 走图像处理管线，不值得花一次模型调用（与旧 step-04 的处理一致）。
 *
 * ## 程序化验收
 *
 * brief 里**图上文字（标题 + 标签 + 注记）必须逐字出现**——compile 被要求
 * 「文案一个字不要漏、不要改」，brief 里漏了字，成品就漏字。这是本步的静态检查。
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ChatMessage, TokenUsage } from '../../gateway/type/chat';
import type { PlannedSlot } from './plan';

export const DRAFT_MAX_TOKENS = 12000;

export const DRAFT_SYSTEM_PROMPT = [
  '你是 Amazon listing 套图的「创意方案」撰写者。你的产出会交给下一个环节（版式编译器），',
  '它**只认识自然语言**——按你的文字描述把元素摆到画面上。',
  '',
  '## 格式（对齐手写范本的风格，短段落 + 列表，不要 JSON）',
  '',
  '第一段：这张图是什么（产品 + 图幅 + 背景基调），一到两句。',
  '',
  '中间段：画面怎么摆——什么放哪、占多大、什么跟什么对齐。',
  '  用「左侧 / 右侧 / 上方 / 正中 / 占宽约 N%」这类描述，编译器会落成坐标。',
  '  版式思想：一个画面只有一个主角；主要元素边缘要能对齐；间距分组要读得出层级。',
  '',
  '**图形指令要明确**——规划里给的句式（layout_recipe）必须展开成具体的图形元素清单：',
  '  - 特写框：几个、放哪、各占多大、各配哪条标签',
  '  - 铭牌/徽章/横幅：什么形状、放哪、里面装哪条文字',
  '  - 连接线：只从「框边缘连到主体照片的轮廓」，**不得指进照片内部的某个部位**',
  '    （版式阶段锚不到素材内部的位置，指了必错）。连接线可写「一条细直线」。',
  '  例（detail-callouts 展开片段）：',
  '  「右侧纵排三个特写框，每框占宽约 30%、圆角，框内是产品对应部位的微距；',
  '    每个框外侧配一条细直引线，从框边连到主体轮廓为止，不伸进照片内部；」',
  '',
  '文案段：图上出现的**每一处文字**，逐字列出，一处一行，用「」或列表包住。',
  '  三层都要落（规划里给了什么层就写什么层，一层都不能丢）：',
  '',
  '  上方主标题：「NACHTWANDERER 400」',
  '',
  '  三个特写框的标签：',
  '  - 400 Lumen',
  '  - 12 h Laufzeit',
  '',
  '  底部横幅里的注记：「Immer trocken lagern」',
  '',
  '⚠️ 铁律：',
  '1. 给定的「标题 / 标签 / 注记」都是**逐字定稿**——一个字都不要改、不要增、不要翻译，',
  '   也不要自己另造文字。编译器被要求「文案一个字不要漏」，你漏了字成品就漏字。',
  '2. 只写**这张图**。不要写其他图位的事。',
  '3. 不写颜色值、不写具体坐标（0.37 这种）——版式是编译器的本职，你写意图。',
  '4. 不写「光影/材质/特效」的执行细节——那是生图提示词的事，一句氛围带过即可。',
  '5. 语言：画面描述用中文，图内文案用给定的原文（listing 语言）。',
].join('\n');

export function draftUserPrompt(
  slot: PlannedSlot,
  claimsJson: string,
  bullets: string,
  factsJson: string,
): string {
  return [
    '## 这张图的任务（套图规划）',
    '',
    JSON.stringify(slot, null, 2),
    '',
    '## 相关的审计结果（图要证明什么）',
    '',
    claimsJson,
    '',
    '## 五点描述原文（商业目标）',
    '',
    bullets,
    '',
    '## 产品照片的可见事实（画面里能放什么）',
    '',
    factsJson,
    '',
    '现在写这份创意方案。记住：标题、标签、注记三类图上文字逐字保留，一层都不能丢；',
    '把 layout_recipe 展开成明确的图形元素清单（框/铭牌/徽章/横幅/连接线）；',
    '连接线只连框边与主体轮廓，不指进照片内部。描述摆位与意图，不写坐标与颜色值。',
  ].join('\n');
}

export interface DraftResult {
  text: string;
  usage?: TokenUsage;
}

function stripFence(s: string): string {
  return s.trim().replace(/^```(?:markdown|md)?\s*/i, '').replace(/\s*```$/, '').trim();
}

/**
 * slot 里全部要出现在图上的文字（标题 + 标签 + 注记）。
 * 旧版规划 JSON 没有 title/note 字段时自然退化为只有标签。
 */
export function plannedTexts(slot: PlannedSlot): string[] {
  return [slot.title, ...(slot.on_image_text ?? []), slot.note].filter(
    (t): t is string => typeof t === 'string' && !!t.trim(),
  );
}

/**
 * 静态验收：brief 里每条图内文案都逐字出现。
 * 返回缺失清单（空数组 = 通过）。
 */
export function checkBriefTexts(briefText: string, onImageText: string[]): string[] {
  return onImageText.filter((t) => t.trim() && !briefText.includes(t.trim()));
}

/**
 * 为一个图位写 brief。
 *
 * @param slot        套图规划里的单个图位
 * @param claims      审计结果（只喂该 slot 覆盖的要素，控制体积）
 * @param bullets     五点描述原文
 * @param facts       产品照识别结果
 * @param outFile     落盘路径（test_product/briefs/<名>.md）
 */
export async function draftBrief(
  slot: PlannedSlot,
  claims: unknown[],
  bullets: string,
  facts: Record<string, unknown>,
  outFile: string,
): Promise<DraftResult> {
  const { getChatGateway } = await import('../../config');

  const messages: ChatMessage[] = [
    { role: 'system', content: DRAFT_SYSTEM_PROMPT },
    {
      role: 'user',
      content: draftUserPrompt(
        slot,
        JSON.stringify(claims, null, 2),
        bullets,
        JSON.stringify(facts, null, 2),
      ),
    },
  ];

  const gateway = getChatGateway();
  let text = '';
  let usage: TokenUsage | undefined;
  for await (const chunk of gateway.stream(messages, {
    temperature: 0.4,
    maxTokens: DRAFT_MAX_TOKENS,
  })) {
    text += chunk.content;
    if (chunk.usage) usage = chunk.usage;
  }

  const brief = stripFence(text);
  if (brief.length < 60) {
    throw new Error(`brief 太短（${brief.length} 字符），疑似输出异常：\n${text.slice(0, 300)}`);
  }

  // 程序化验收：图上文字（标题+标签+注记）必须逐字出现（漏字 = 成品漏字）
  const missing = checkBriefTexts(brief, plannedTexts(slot));
  if (missing.length) {
    throw new Error(
      `brief 里缺少逐字文案：${missing.map((m) => `「${m}」`).join('、')}\n` +
        '文案是逐字定稿——改写或漏掉都会导致成品漏字。请重跑本步。',
    );
  }

  writeFileSync(resolve(outFile), brief + '\n', 'utf8');
  return { text: brief, usage };
}
