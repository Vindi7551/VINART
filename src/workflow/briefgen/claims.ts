/**
 * ═══════════════════════════════════════════════════════════════════════
 * ② 卖点审计 —— listing 卖点 → 要素级证据状态
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 把 listing 的五点描述逐条拆解到**可验证要素**级别，判定每个要素
 * 「现有产品照片能否支撑」。
 *
 * 为什么判定要下沉到「要素级」而不是「宣称级」：
 * 一条宣称常常混装不同性质的要素。例：
 *   "30,5 × 22 × 1,5 cm 的相思木砧板，刀锋友好且耐用"
 *   ├─ 尺寸 30,5×22×1,5 cm → 可补证（拍张带卷尺的图就能证）
 *   └─ 刀锋友好 / 耐用     → 无法证明（抽象属性，任何照片都证不了）
 * 若只在条级给一个状态，「可补证的尺寸」会跟「无法证明的材质」压扁成一个，
 * **尺寸图这种刚需素材就从需求清单里漏掉了**。
 *
 * ⚠️ 纯文本对文本，本步不看图——step-01 的识别结果是「可见事实」的唯一来源，
 * 保证链路可追溯（否则两份独立视觉判断，出错无法定位）。
 *
 * ⚠️ 语言中性（2026-10-02 翻新）：listing 面向哪个市场是**业务输入**（listingLang），
 * 不写死德语。输出字段名不再带 `_de` 后缀——「图内文字」用 listing 语言写，
 * 哪个语言由调用方决定。判定类字段（中文）保持中文。
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ChatMessage, TokenUsage } from '../../designharness/gateway/type/chat';

/**
 * 输出 token 上限。
 * ⚠️ DeepSeek 的思考过程**也计入** completion tokens，
 * 设小了会静默截断成半个 JSON（已踩过）。
 */
export const CLAIMS_MAX_TOKENS = 20000;

export const CLAIMS_SYSTEM_PROMPT = [
  '你是 Amazon listing 的内容审计员。',
  '任务：把给定的五点描述拆解到**可验证要素**级别，判定每个要素「**现有产品照片**能否支撑它」。',
  '',
  '## 证据状态只能取三个值之一',
  '- "已有证据"：现有照片的可见事实能直接证明。**必须在 supported_by 里引用事实清单中的具体内容。**',
  '- "可补证"：现有照片没拍到，但**补拍或生成一张新图就能证明**（如尺寸、局部特写、折叠状态、使用动作）。',
  '- "无法证明"：**任何照片都证不了**的抽象属性（如耐久性、刀感、抗菌、寿命）。只能靠文案声称或图解说明。',
  '',
  '## 关于「要素」——本步骤最关键的一点',
  '一条宣称往往**混装不同性质的要素**，它们的证据状态**可以不同**。',
  '例："30,5 × 22 × 1,5 cm 的相思木砧板，刀锋友好且耐用"',
  '  ├─ 尺寸 30,5×22×1,5 cm → "可补证"（拍带卷尺的图即可）',
  '  └─ 刀锋友好 / 耐用     → "无法证明"（抽象属性，拍照证不了）',
  '**必须逐个要素判定，不得为了省事压扁成一个状态。** 漏掉可补证的要素 = 未来的副图漏拍。',
  '',
  '## 语言规则',
  '- **中文**：category、element、gap、action、keyword_notes、evidence_status',
  '- **listing 语言**（这些会直接用在商品页面或设计稿上）：header、source_text、',
  '  on_image_text、scene_tag、target_keywords——本次用【{listingLang}】写',
  '',
  '## 铁律',
  '1. 判定"已有证据"时必须引用事实清单里的具体条目，不得凭空认定。',
  '2. **不得把抽象属性说成"可补证"**——拍一张照片证明不了"耐磨"。这条最容易出错，务必严格。',
  '3. on_image_text 必须是**简短的名词短语（2-4 个词）**，不是句子、不是广告语。',
  '   用途是让 Amazon 的视觉 AI 用 OCR 读取，所以要短、要是名词、要能被标准字体清晰呈现。',
  '4. 禁止使用促销语、排名声明（"#1"、"Bestseller"、"Nr. 1"）、保证性表述。',
  '5. 不得编造原文没有的宣称。只审计给定的五条。',
  '6. 输出严格 JSON，不要 markdown 代码块，不要任何解释文字。',
].join('\n');

export function claimsUserPrompt(factsJson: string, bullets: string): string {
  return [
    '## 一、现有照片的可见事实（来自图像识别）',
    '',
    factsJson,
    '',
    '## 二、待审计的五点描述',
    '',
    bullets,
    '',
    '## 三、输出结构（严格 JSON，五条宣称各一项，顺序与原文一致）',
    '',
    '{',
    '  "claims": [',
    '    {',
    '      "id": "claim-1",',
    '      "header": "原文中的大写标题部分（listing 语言）",',
    '      "source_text": "该条宣称的完整原文（listing 语言）",',
    '      "category": "场景 | 材质 | 功能 | 工艺 | 尺寸 | 社交",',
    '      "verifiable_elements": [',
    '        {',
    '          "element": "拆出的一个具体可验证要素（中文描述）",',
    '          "status": "已有证据 | 可补证 | 无法证明",',
    '          "supported_by": ["引用事实清单中的具体内容；无证据则空数组"],',
    '          "gap": "缺什么（中文）。证据充分则 null",',
    '          "action": "下一步动作（中文）。证据充分则 null"',
    '        }',
    '      ],',
    '      "on_image_text": ["图内应出现的名词短语（2-4 词，listing 语言），最多 3 条"],',
    '      "scene_tag": "供视觉 AI 识别环境用的标签（listing 语言），如 Küche / Geburtstagstafel；无则 null",',
    '      "target_keywords": ["该宣称对应的目标市场搜索词（复合词必须写完整形式）"]',
    '    }',
    '  ],',
    '  "keyword_notes": "关于关键词的补充观察（复合词、变音符号变体、与图片的错配风险等），一段中文"',
    '}',
    '',
    '注意：**不要输出宣称级的汇总状态**——它由下游从要素自动推导，无需你判断。',
  ].join('\n');
}

// ── 类型 ──

const KNOWN_STATUS = new Set(['已有证据', '可补证', '无法证明', '混合']);

export interface VerifiableElement {
  element: string;
  status: string;
  supported_by: string[];
  gap: string | null;
  action: string | null;
}

export interface Claim {
  id: string;
  header: string;
  source_text: string;
  category: string;
  verifiable_elements: VerifiableElement[];
  /** 由要素推导，不由模型给出。见 deriveClaimStatus */
  evidence_status: string;
  on_image_text: string[];
  scene_tag: string | null;
  target_keywords: string[];
}

export interface WorkItem {
  claim: string;
  element: string;
  gap: string | null;
  action: string | null;
}

export interface ClaimsResult {
  claims: Claim[];
  keywordNotes?: string;
  /** 副图需求清单——**从要素生成**，不是从宣称生成 */
  imageWorkList: WorkItem[];
  usage?: TokenUsage;
  raw: string;
}

/** 模型有时会把 null 写成字符串 "null"，统一清掉 */
function clean(v: string | null | undefined): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s || s === 'null' || s === 'undefined') return null;
  return s;
}

function normalizeStatus(s: string): string {
  const t = String(s ?? '').trim();
  return KNOWN_STATUS.has(t) ? t : '其他';
}

/**
 * 从要素推导宣称级状态：全部一致 → 该状态；不一致 → "混合"。
 * 不交给模型判断：可程序化推导的事实不该让模型猜（实测它会压扁成最差状态）。
 */
function deriveClaimStatus(elements: VerifiableElement[]): string {
  if (!elements.length) return '其他';
  const set = new Set(elements.map((e) => normalizeStatus(e.status)));
  set.delete('其他');
  if (set.size === 0) return '其他';
  if (set.size === 1) return [...set][0];
  return '混合';
}

function stripFence(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

/**
 * 审计卖点。
 *
 * @param factsJson   step-01 识别结果（parsed 对象的 JSON）
 * @param bullets     五点描述原文（listing 语言）
 * @param listingLang listing 市场语言代码（de / en / …）——决定图内文字字段用什么语言
 * @param outJson     完整记录落盘路径；null = 只返回
 */
export async function auditClaims(
  factsJson: string,
  bullets: string,
  listingLang: string,
  outJson: string | null,
): Promise<ClaimsResult> {
  const { getChatGateway } = await import('../../config');

  const systemPrompt = CLAIMS_SYSTEM_PROMPT.replace('{listingLang}', listingLang);
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: claimsUserPrompt(factsJson, bullets) },
  ];

  const gateway = getChatGateway();
  let text = '';
  let usage: TokenUsage | undefined;
  for await (const chunk of gateway.stream(messages, {
    temperature: 0.2,
    maxTokens: CLAIMS_MAX_TOKENS,
  })) {
    text += chunk.content;
    if (chunk.usage) usage = chunk.usage;
  }

  let parsed: { claims?: Omit<Claim, 'evidence_status'>[]; keyword_notes?: string } | null = null;
  let parseError: string | null = null;
  try {
    parsed = JSON.parse(stripFence(text));
  } catch (e) {
    parseError = e instanceof Error ? e.message : String(e);
  }

  // 宣称级状态由要素推导（模型不输出该字段）
  const claims: Claim[] = (parsed?.claims ?? []).map((c) => {
    const els = c.verifiable_elements ?? [];
    return { ...c, verifiable_elements: els, evidence_status: deriveClaimStatus(els) };
  });
  const imageWorkList: WorkItem[] = claims.flatMap((c) =>
    c.verifiable_elements
      .filter((e) => normalizeStatus(e.status) === '可补证')
      .map((e) => ({ claim: c.header, element: e.element, gap: clean(e.gap), action: clean(e.action) })),
  );

  if (outJson) {
    writeFileSync(
      resolve(outJson),
      JSON.stringify(
        {
          step: 'briefgen/claims',
          ts: new Date().toISOString(),
          input: { listingLang },
          usage,
          claims,
          imageWorkList,
          keyword_notes: parsed?.keyword_notes,
          raw: text,
          parseError,
        },
        null,
        2,
      ),
      'utf8',
    );
  }

  if (!claims.length) {
    throw new Error(`卖点审计输出不是合法 JSON：${parseError}\n${text.slice(0, 300)}`);
  }
  return { claims, keywordNotes: parsed?.keyword_notes, imageWorkList, usage, raw: text };
}

/** 终端打印审计摘要（要素级状态分组） */
export function printClaims(r: ClaimsResult): void {
  const buckets: Record<string, { claim: string; element: string }[]> = {
    已有证据: [],
    可补证: [],
    无法证明: [],
    其他: [],
  };
  for (const c of r.claims) {
    for (const e of c.verifiable_elements) {
      buckets[normalizeStatus(e.status)]?.push({ claim: c.header, element: e.element });
    }
  }
  for (const status of ['已有证据', '可补证', '无法证明', '其他']) {
    const list = buckets[status];
    if (!list.length) continue;
    console.log(`\n  【${status}】 ${list.length} 个要素`);
    for (const e of list) console.log(`    - [${e.claim}] ${e.element}`);
  }
  console.log(`\n  副图需求清单（可补证）：${r.imageWorkList.length} 项`);
}
