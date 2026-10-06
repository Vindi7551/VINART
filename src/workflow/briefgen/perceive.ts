/**
 * ═══════════════════════════════════════════════════════════════════════
 * ① 图像识别 —— 产品照 → 结构化可见事实
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 链 A（brief 生成）的第一步：只有先拿到「图里到底有什么」的独立事实清单，
 * 后面的卖点审计才能逐条比对，查出「说得出口、看不见」的宣称。
 *
 * ⚠️ 本步只做「识别」，不碰卖点和文案。
 * ⚠️ detail 用 'original'——识别小字/雕刻必须全分辨率（low 档省 76% token 但漏字，实测）。
 *
 * 与旧实现（scripts/step-01-perceive.ts）的差异：
 * 直接调 gateway.stream（与 order.ts / compile.ts 同模式），
 * 不再走 session/context 封装——视觉请求就是一个带 image_url 内容块的消息。
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ChatMessage, TokenUsage } from '../../designharness/gateway/type/chat';

export const PERCEIVE_SYSTEM_PROMPT = [
  '你是一个电商产品图的视觉分析员。你的唯一任务是**如实报告你在图中看见了什么**。',
  '',
  '铁律：',
  '1. 只报告你真正看见的东西。看不清、被遮挡、图上没有的，一律放进 uncertain，不要猜。',
  '2. 文字必须**原文照抄**，保留变音符号与大小写，不要翻译、不要改写、不要补全。',
  '3. 不要评价、不要营销、不要推测卖点。这一环节只做事实提取。',
].join('\n');

export const PERCEIVE_USER_PROMPT = [
  '分析这张产品图，输出 JSON（不要任何解释文字，不要 markdown 代码块）：',
  '{',
  '  "product": "这是什么产品（一句话）",',
  '  "material_guess": "材质判断，以及你依据什么视觉线索这么判断",',
  '  "shape": "外形描述（含边缘、轮廓、装饰结构）",',
  '  "engraved_text": ["图上所有可见文字的原文，一行一条"],',
  '  "decorative_elements": ["除文字外的图形元素描述"],',
  '  "surface_treatment": "表面处理与做工细节",',
  '  "accessories": "配件结构描述（如支架），没有就写 null",',
  '  "photo_setup": "拍摄方式（背景、角度、光线）",',
  '  "uncertain": ["看不清或无法确认的项"]',
  '}',
].join('\n');

export interface PerceiveResult {
  /** 解析出的识别结果（图上事实） */
  parsed: Record<string, unknown>;
  usage?: TokenUsage;
  elapsedMs: number;
  raw: string;
  parseError: string | null;
}

function stripFence(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

/**
 * 识别产品照。
 *
 * @param imagePath 产品照路径（本地文件）
 * @param outJson   结果落盘路径（含 raw/usage 的完整记录）；null = 只返回不落盘
 */
export async function perceiveProduct(imagePath: string, outJson: string | null): Promise<PerceiveResult> {
  const { fileToDataUrl } = await import('../../designharness/gateway/util/data-url');
  const { getChatGateway } = await import('../../config');

  const dataUrl = fileToDataUrl(imagePath);

  const messages: ChatMessage[] = [
    { role: 'system', content: PERCEIVE_SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        { type: 'text', text: PERCEIVE_USER_PROMPT },
        // ⚠️ detail:'original'——小字与雕刻识别必须全分辨率
        { type: 'image_url', image_url: { url: dataUrl, detail: 'original' } },
      ],
    },
  ];

  const gateway = getChatGateway();
  let text = '';
  let usage: TokenUsage | undefined;
  const t0 = Date.now();
  for await (const chunk of gateway.stream(messages, { temperature: 0.3, maxTokens: 8000 })) {
    text += chunk.content;
    if (chunk.usage) usage = chunk.usage;
  }
  const elapsedMs = Date.now() - t0;

  let parsed: Record<string, unknown> | null = null;
  let parseError: string | null = null;
  try {
    parsed = JSON.parse(stripFence(text)) as Record<string, unknown>;
  } catch (e) {
    parseError = e instanceof Error ? e.message : String(e);
  }

  if (outJson) {
    writeFileSync(
      resolve(outJson),
      JSON.stringify(
        {
          step: 'briefgen/perceive',
          ts: new Date().toISOString(),
          input: { image: imagePath, detail: 'original' },
          usage,
          elapsedMs,
          parsed,
          raw: text,
          parseError,
        },
        null,
        2,
      ),
      'utf8',
    );
  }

  if (!parsed) throw new Error(`图像识别输出不是合法 JSON：${parseError}\n${text.slice(0, 300)}`);
  return { parsed, usage, elapsedMs, raw: text, parseError: null };
}

/** 终端打印识别结果（每步产物肉眼可验收） */
export function printPerceive(p: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(p)) {
    const val = Array.isArray(v) ? '\n      - ' + v.join('\n      - ') : String(v);
    console.log(`  ${k}: ${val}`);
  }
}
