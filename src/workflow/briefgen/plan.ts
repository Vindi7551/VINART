/**
 * ═══════════════════════════════════════════════════════════════════════
 * ③ 套图规划 —— 要素清单 → 图位方案（MAIN + PT01…）
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 核心原则（沿用旧 step-03，实测有效）：
 * 1. **一张图 = 一个购买问题。** 同一购买问题下的多个要素归并进同一张图。
 *    13 项需求 ≠ 13 张图；副图位上限是 PT01–PT08。
 * 2. **移动端不点开只显示前 3 张** → PT01–PT03 必须放最关键的购买问题。
 * 3. 抽象属性（"无法证明"的要素）**不得**作为任何一张图的证明目标。
 *
 * ⚠️ 2026-10-02 翻新时**砍掉了旧 step-03 的两块职责**（它们有了别的归宿）：
 * - layout.zones / 版式草案 → compile.ts 的事（它吃 brief 产版式 + VLM 验收）
 * - scene_brief.generation_prompt_de → assetsgen/order.ts 的事（订单编写模型按
 *   生图模型方言写 prompt，规划层代写只会产出不符合规范的废文案）
 * 规划层只回答「做哪几张图、每张回答什么问题、图上写什么字」。
 *
 * 语言中性：图内文字用 listing 语言（listingLang 参数），判定类字段用中文。
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ChatMessage, TokenUsage } from '../../designharness/gateway/type/chat';
import type { WorkItem } from './claims';

export const PLAN_MAX_TOKENS = 30000;

export const PLAN_SYSTEM_PROMPT = [
  '你是 Amazon listing 的套图规划师。',
  '任务：把给定的「可验证要素」编排成一套 listing 图片方案（主图 + 若干副图）。',
  '',
  '## 归并原则（最重要）',
  '- **一张图 = 一个购买问题。** 同一购买问题下的多个要素，归并进同一张图。',
  '- 一张图回答**一个主问题**，但可以用多条标签/注记同时交代**多个子事实**',
  '  （如一张细节图同时标注三处做工——这不是混问题，是同一问题的多面证据）。',
  '- 不同购买问题**不要**混在一张图里。',
  '- 需求数不等于图数。你的工作是归并，不是一一对应。',
  '',
  '## 排序原则',
  '- 主图是 MAIN，固定第 0 位。',
  '- 副图编号 PT01 起，最多到 PT08。',
  '- **移动端不点开只显示前 3 张**（PT01–PT03），所以这三张必须放最关键的购买问题。',
  '- 越靠前权重越高；深度说服类内容放后面。',
  '',
  '## 平台硬约束（必须遵守）',
  '- 主图：纯白背景、产品主体占画面 ≥85%、**绝对禁止任何文字、logo、水印、促销语**。',
  '- 副图允许文字与信息图。',
  '- **图内文字只能用标准无衬线体或衬线体**——Amazon 的视觉 AI 用 OCR 读取图内文字，',
  '  明确无法可靠识别手写体/花体字。',
  '- **不写促销语、排名声明、关键词堆砌**（违者下架扣分）。',
  '',
  '## 图上文字的三层预算（副图）',
  '每张副图的图上文字分三层，逐字定稿，全部直接出现在图上：',
  '- **title 标题**（必填）：情绪钩子，2–6 词，说「买家得到什么 / 什么感受」，',
  '  **不做品类标签**（"Youth Sizing" 是标签，"Big on Turkey Charm" 是标题）。',
  '  优先从五点描述原文里挑最有力的短语提炼改写，保留原文的感叹结构；',
  '  驼峰式大小写，不要全大写促销腔。',
  '- **on_image_text 标签**（0–4 条）：部位/要素/场景的名词短语，2–4 词，',
  '  是「看图识物」的锚点，不是卖点句子。',
  '- **note 注记**（可选，至多 1 条）：一句服务信息（保养/安装/适用范围），',
  '  取自卖点原文，不超过 12 词。没有合适的就 null，不要硬凑。',
  '主图三层全空（title/note 为 null，on_image_text 为空数组）。',
  '',
  '## 版式句式词汇表（layout_recipe）',
  '给每张副图从词汇表里**选一个**句式（小写下划线命名），后一步写 brief 的人',
  '会把它展开成画面描述；不要发明词汇表以外的名字：',
  '- "detail-callouts"：一张主图 + 2–3 个特写小框，每框配一条标签，',
  '  一图同时交代多处细节。适合「一件产品多处可看」。',
  '  ⚠️ 若画连接线：线只连**特写框边缘与主体轮廓**，不得指进照片内部',
  '  的某个器官位置——版式阶段锚不到素材内部的准确位置，指了必错。',
  '- "scene-compare"：两个场景并排，各配一块铭牌标签。适合「多场景/多用法」。',
  '- "audience-badges"：产品居中，四周 2–4 个圆形/铭牌徽章（适用人群或场合），',
  '  每个徽章配一条短标签。',
  '- "banner-note"：大图占主体，底部一条横幅色带放 note。适合服务信息',
  '  （保养/安装/收纳）——不用为它单独开一张图。',
  '- "plain-feature"：一张大图 + 标题区。最朴素也最保险的默认句式。',
  '- "decorated-frame"：**满幅装饰背景图垫底**（羊皮纸纹理/色块场景/四角装饰），',
  '  标题、徽章、产品浮在背景上。适合礼赠/节日类需要「设计感整版」的图。',
  '  背景是一张 AI 生成的纹理图（无文字无产品无人物），不是纯色块；',
  '  产品照在背景上要有明确的舞台区（居中拱门/地台）。',
  '',
  '## 关于抽象属性',
  '审计结果里标为「无法证明」的要素（材质耐久、刀锋友好、独一无二、人群适用性等）',
  '**不得**作为任何一张图的证明目标。它们只能出现在文案或图解示意里。',
  '',
  '## 语言规则',
  '- **中文**：buying_question、purpose、must_show_facts、evidence_note、risk',
  '- **listing 语言**（会直接出现在图上）：on_image_text、scene_tag——本次用【{listingLang}】写',
  '',
  '6. 输出严格 JSON，不要 markdown 代码块，不要任何解释文字。',
].join('\n');

export function planUserPrompt(
  claimsCompactJson: string,
  workListJson: string,
  bullets: string,
): string {
  return [
    '## 一、五点描述原文（最终的商业目标）',
    '',
    bullets,
    '',
    '## 二、要素级审计结果',
    '',
    claimsCompactJson,
    '',
    '## 三、必须被覆盖的「可补证」需求清单',
    '',
    '**每一项都必须被至少一张图覆盖。** 如果某一项无法被任何一张图覆盖，请在 open_questions 里说明原因。',
    '',
    '⚠️ **数据缺口纪律**：如果某项需求需要具体数据（尺寸表、成分含量、参数）',
    '而五点描述里没有，**不要编造数字**——相关槽位降级为不依赖该数据的句式，',
    '并把缺口列进 open_questions，注明需要用户提供什么数据。',
    '',
    workListJson,
    '',
    '## 四、输出结构（严格 JSON）',
    '',
    '{',
    '  "slots": [',
    '    {',
    '      "slot": "MAIN | PT01 | PT02 | ...",',
    '      "position": 0,',
    '      "buying_question": "这张图回答买家的哪一句心里话（中文，一句）",',
    '      "image_kind": "主图白底 | 信息图 | 场景图 | 混合",',
    '      "layout_recipe": "detail-callouts | scene-compare | audience-badges | banner-note | plain-feature ——副图必填；主图为 null",',
    '      "must_show_facts": ["这张图必须展示的产品事实或要素（中文，照抄或概述审计里的要素）"],',
    '      "title": "标题（listing 语言，2-6 词情绪钩子，优先提炼五点原文短语）——主图为 null",',
    '      "on_image_text": ["标签（listing 语言，2-4 词名词短语，0-4 条）——主图为空数组"],',
    '      "note": "注记（listing 语言，一句 ≤12 词服务信息）——无则 null；主图为 null",',
    '      "scene_tag": "环境标签（listing 语言，如 Küche）；非场景图则 null",',
    '      "covers_elements": ["这张图覆盖了审计结果里的哪个要素（照抄要素文本）"],',
    '      "evidence_note": "这张图补上了哪个证据缺口（中文）",',
    '      "risk": "这张图的风险点（中文）；无则 null"',
    '    }',
    '  ],',
    '  "coverage_note": "关于覆盖情况的说明（中文）",',
    '  "open_questions": ["需要用户拍板的问题（中文）——含数据缺口"]',
    '}',
  ].join('\n');
}

export interface PlannedSlot {
  slot: string;
  position: number;
  buying_question: string;
  image_kind: string;
  /** 版式句式（词汇表内选一）；主图为 null */
  layout_recipe?: string | null;
  must_show_facts: string[];
  /** 情绪标题（listing 语言）；主图为 null。旧版规划 JSON 可能没有此字段 */
  title?: string | null;
  on_image_text: string[];
  /** 一句服务信息注记（listing 语言）；无则 null/缺省 */
  note?: string | null;
  scene_tag: string | null;
  covers_elements: string[];
  evidence_note: string;
  risk: string | null;
}

export interface PlanResult {
  slots: PlannedSlot[];
  coverageNote?: string;
  openQuestions: string[];
  /** 程序化验收：有哪几项「可补证」需求没被任何图覆盖 */
  uncovered: WorkItem[];
  coverageRate: string;
  usage?: TokenUsage;
  raw: string;
}

function stripFence(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

/** 粗糙但够用的相似度：去空白与标点后比较，或一方包含另一方 */
function normText(s: string): string {
  return String(s).toLowerCase().replace(/[\s，。、；：,.;:"'「」（）()\-]/g, '');
}

function isCovered(element: string, covers: string[]): boolean {
  const target = normText(element);
  if (!target) return false;
  for (const c of covers) {
    const n = normText(c);
    if (!n) continue;
    if (n.includes(target) || target.includes(n)) return true;
    if (target.length >= 12 && n.length >= 12 && target.slice(0, 12) === n.slice(0, 12)) return true;
  }
  return false;
}

/**
 * 套图规划。
 *
 * @param bullets       五点描述原文（listing 语言）
 * @param claims        `claims` 的审计结果
 * @param workList      必须覆盖的「可补证」需求清单
 * @param listingLang   listing 市场语言代码
 * @param outJson       落盘路径；null = 只返回
 */
export async function planSlots(
  bullets: string,
  claims: { id: string; header: string; category: string; verifiable_elements: { element: string; status: string; gap?: string | null }[] }[],
  workList: WorkItem[],
  listingLang: string,
  outJson: string | null,
): Promise<PlanResult & { claims: unknown }> {
  const { getChatGateway } = await import('../../config');

  const systemPrompt = PLAN_SYSTEM_PROMPT.replace('{listingLang}', listingLang);
  // 只喂必要字段，控制 prompt 体积
  const claimsCompact = claims.map((c) => ({
    id: c.id,
    header: c.header,
    category: c.category,
    elements: c.verifiable_elements.map((e) => ({ element: e.element, status: e.status, gap: e.gap ?? null })),
  }));

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: planUserPrompt(JSON.stringify(claimsCompact, null, 2), JSON.stringify(workList, null, 2), bullets) },
  ];

  const gateway = getChatGateway();
  let text = '';
  let usage: TokenUsage | undefined;
  for await (const chunk of gateway.stream(messages, {
    temperature: 0.4,
    maxTokens: PLAN_MAX_TOKENS,
  })) {
    text += chunk.content;
    if (chunk.usage) usage = chunk.usage;
  }

  let parsed: { slots?: PlannedSlot[]; coverage_note?: string; open_questions?: string[] } | null = null;
  let parseError: string | null = null;
  try {
    parsed = JSON.parse(stripFence(text));
  } catch (e) {
    parseError = e instanceof Error ? e.message : String(e);
  }

  const slots = (parsed?.slots ?? []).slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const uncovered = workList.filter((w) => !slots.some((s) => isCovered(w.element, s.covers_elements ?? [])));
  const coveredCount = workList.length - uncovered.length;

  if (outJson) {
    writeFileSync(
      resolve(outJson),
      JSON.stringify(
        {
          step: 'briefgen/plan',
          ts: new Date().toISOString(),
          input: { listingLang },
          usage,
          // claims 一起落盘——`draft` 写 brief 时要按 slot 挑覆盖的要素
          claims: claimsCompact,
          slots,
          coverage_note: parsed?.coverage_note,
          open_questions: parsed?.open_questions ?? [],
          uncovered,
          raw: text,
          parseError,
        },
        null,
        2,
      ),
      'utf8',
    );
  }

  if (!slots.length) {
    throw new Error(`套图规划输出不是合法 JSON：${parseError}\n${text.slice(0, 300)}`);
  }
  return {
    slots,
    claims: claimsCompact,
    coverageNote: parsed?.coverage_note,
    openQuestions: parsed?.open_questions ?? [],
    uncovered,
    coverageRate: workList.length ? `${coveredCount}/${workList.length}` : 'n/a',
    usage,
    raw: text,
  };
}

/** 终端打印套图一览 + 覆盖验收 */
export function printPlan(r: PlanResult): void {
  for (const s of r.slots) {
    console.log(`\n  [${s.position}] ${s.slot}　${s.image_kind}${s.layout_recipe ? `　· ${s.layout_recipe}` : ''}`);
    console.log(`      购买问题: ${s.buying_question}`);
    if (s.title) console.log(`      标题    : ${s.title}`);
    console.log(`      图内文字: ${s.on_image_text.length ? s.on_image_text.join(' / ') : '（无——主图）'}`);
    if (s.note) console.log(`      注记    : ${s.note}`);
    if (s.scene_tag) console.log(`      环境标签: ${s.scene_tag}`);
    console.log(`      覆盖要素: ${(s.covers_elements ?? []).length} 项`);
  }
  console.log(`\n  覆盖验收：${r.coverageRate} 项「可补证」需求被覆盖`);
  if (r.uncovered.length) {
    console.log('  ⚠️ 以下需求没有任何图覆盖：');
    for (const w of r.uncovered) console.log(`    - [${w.claim}] ${w.element}`);
  } else {
    console.log('  ✓ 全部覆盖');
  }
}
