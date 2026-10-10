/**
 * ═══════════════════════════════════════════════════════════════════════
 * 外观编译 —— 版式 + 创意方案 + 产品照 → design-appearance.json
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 颜色不必每次都套资产库的预设方案：这一步按产品**自动生成一套专属配色**
 * （内嵌 palette 角色表 + 每图层颜色分配），跟随外观文件走、不进资产库——
 * 好用的由人再提升进 `designassets/elements/palette/`。
 *
 * ## 为什么是独立一步（而不是在 compile 产版式时顺手做）
 *
 * - compile 的实测教训：让它在产版式时写 palette **角色名**，会编造不存在的名字。
 *   教训的本质是「**引用必须可解析**」——编造角色名查不到表，编造 **hex 色值**
 *   却永远合法。本步骤要求内嵌角色表，引用失配会被校验器当场打回。
 * - 三样输入在这里**首次凑齐**：图层清单（知道有哪些 id 要配色）、
 *   创意方案（氛围）、产品照（取色基准）。
 * - 单一职责 + 可人审：产出是数据，改几个 hex 重渲 final 几秒、零 API。
 *
 * ## 校验闭环（沿用 compile 的多轮打回模式）
 *
 * 每轮：LLM 产 JSON → 校验（palette 结构 / 角色引用可解析 / fontScheme 枚举 /
 * 图层 id 存在 / 字段白名单 / 文字层必须配 color）→ 问题清单打回。
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import type { ChatMessage, TokenUsage } from '../../designharness/gateway/type/chat';
import {
  APPEARANCE_KEYS,
  type DesignAppearance,
  type LayerAppearance,
} from '../design-sketch/design-appearance';
import type { DesignSketch } from '../design-sketch/design-sketch';

const FONT_SCHEMES_DIR = resolve('designassets/fonts/schemes');
const MAX_TOKENS = 8000;

export interface AppearanceCompileOptions {
  /** 版式规格路径（design-sketch.json）——产物落在同目录 design-appearance.json */
  specPath: string;
  /** 创意方案路径（brief md） */
  briefPath: string;
  /** 产品照——看图取色，配色与实物和谐的关键 */
  productPath?: string | null;
  /** 产物路径;默认 specPath 同目录 design-appearance.json */
  outPath?: string;
  maxRounds?: number;
}

export interface AppearanceCompileResult {
  appearance: DesignAppearance;
  outPath: string;
  rounds: number;
  usage?: TokenUsage;
}

// ── 提示词 ──

function systemPrompt(): string {
  return `你是 listing 套图的配色设计师。输入：版式规格的**图层清单**、创意方案、产品照。
任务：产出一套**本产品专属**的配色（内嵌 palette 角色表）+ 每个图层的颜色分配，
落成外观文件。只输出一个 JSON 对象，不要解释文字。`;
}

function userPrompt(
  layerSummary: string,
  briefText: string,
  fontSchemes: string[],
): string {
  return [
    '## 一、创意方案（氛围与意图）',
    '',
    briefText,
    '',
    '## 二、版式图层清单（要配色的对象）',
    '',
    layerSummary,
    '',
    `## 三、可选字体方案（fontScheme 只能从这里选，不许发明）：`,
    fontSchemes.map((s) => `- ${s}`).join('\n'),
    '',
    '## 四、设计要求',
    '',
    '1. **从产品照取色**：ink/强调色必须与实物主色一致或从它派生——',
    '   配色与实物冲突是违规（电商「与实物不符」红线）。',
    '2. palette 角色表 5–8 个，全部 hex 色值，覆盖：ink（文字主色，深）、',
    '   浅底色（横幅/铭牌/标签条底）、强调色 1–2 个（标题关键词与标签轮换用）、',
    '   次级淡化色（注记）。角色名用小写英文（ink/cream/accent/moss…自定）。',
    '3. 对比度纪律：浅底上只放深色文字；文字直接压照片时**必须**给浅色或中明度色。',
    '   ⚠️ 渲染器**不会**替你加任何底色或底衬——没给对颜色，文字就真的看不清。',
    '4. 图层分配：按清单里的 type 与文字内容判断角色——',
    '   - **text**：一律给 color；标题可加 accent（句中强调：指定词染强调色，2–4 词）；',
    '     标签/注记可加 fontFamily（只能用所选 fontScheme 的 faces 里已有的字体族）',
    '   - **shape**：底板/横幅/铭牌给 fill（浅底色）；框给 stroke（描边）不填 fill；',
    '     线/锚点给 fill（强调色）。**不填 fill 的框才是透明框**。',
    '   - 同版式内多个标签用强调色**轮换**（最多 3 色），同族不刺眼。',
    '5. ⚠️ 引用必须可解析：layers 里写角色名就必须在 palette 表里；',
    '   要精确色值就直接写 #hex。发明 palette 里没有的角色名 = 违规。',
    '6. 只配色，不改几何（位置/尺寸/字号/字重是版式的事）。',
    '   不发明图层清单之外的 id。',
    '',
    '## 五、输出结构（严格 JSON）',
    '',
    '{',
    '  "palette": { "ink": "#..", "浅底": "#..", "强调": "#..", "...": "#.." },',
    '  "fontScheme": "从可选列表里选一个",',
    '  "layers": {',
    '    "<图层id>": {',
    '      "color": "角色名或#hex",',
    '      "accent": { "words": ["关键词"], "color": "角色名或#hex" },',
    '      "fontFamily": "字体族(仅当所选方案 faces 里含它)",',
    '      "fill": "角色名或#hex",',
    '      "stroke": { "color": "角色名或#hex", "width": 4 }',
    '    }',
    '  }',
    '}',
  ].join('\n');
}

// ── 图层摘要 ──

function layerSummary(spec: DesignSketch): string {
  return spec.layers
    .map((l) => {
      const text =
        l.type === 'text' && 'text' in l
          ? ` 文字「${String(Array.isArray(l.text) ? l.text.join(' / ') : l.text).slice(0, 40)}」`
          : '';
      return `- ${l.id}（${l.type}${'shape' in l ? `·${l.shape}` : ''}）${text}`;
    })
    .join('\n');
}

// ── 校验 ──

const IS_COLOR = /^#([0-9a-fA-F]{3,8})$|^rgba?\(/i;

interface ValidationIssue {
  level: 'error' | 'warn';
  message: string;
}

function validateAppearance(
  value: unknown,
  spec: DesignSketch,
  fontSchemes: string[],
): { issues: ValidationIssue[]; appearance: DesignAppearance } {
  const issues: ValidationIssue[] = [];
  const v = value as DesignAppearance | null;
  if (!v || typeof v !== 'object') {
    return { issues: [{ level: 'error', message: '输出不是 JSON 对象' }], appearance: {} };
  }

  // ── palette ──
  if (!v.palette || typeof v.palette !== 'object' || typeof v.palette === 'string') {
    issues.push({ level: 'error', message: 'palette 必须是内嵌对象（角色名 → hex 色值）' });
  } else {
    const pal = v.palette as Record<string, string>;
    const roles = Object.keys(pal);
    if (roles.length < 4 || roles.length > 12) {
      issues.push({ level: 'error', message: `palette 需要 5–8 个角色，现在 ${roles.length} 个` });
    }
    if (!pal.ink) issues.push({ level: 'error', message: 'palette 缺少 ink（文字主色）' });
    for (const [role, val] of Object.entries(pal)) {
      if (typeof val !== 'string' || !IS_COLOR.test(val)) {
        issues.push({ level: 'error', message: `palette.${role} 不是合法色值：${val}` });
      }
    }
  }

  // ── fontScheme ──
  if (!v.fontScheme || !fontSchemes.includes(v.fontScheme)) {
    issues.push({
      level: 'error',
      message: `fontScheme 必须是：${fontSchemes.join(' / ')}`,
    });
  }

  // ── layers ──
  const palRoles = (typeof v.palette === 'object' && v.palette && !Array.isArray(v.palette)
    ? (v.palette as Record<string, string>)
    : {}) as Record<string, string>;
  const specIds = new Set(spec.layers.map((l) => l.id));
  const textIds = new Set(spec.layers.filter((l) => l.type === 'text').map((l) => l.id));
  const layers = v.layers ?? {};
  const resolvable = (val: string): boolean =>
    IS_COLOR.test(val) || val === 'transparent' || val in palRoles;

  for (const [id, la] of Object.entries(layers as Record<string, LayerAppearance>)) {
    if (!specIds.has(id)) {
      issues.push({ level: 'error', message: `图层 ${id} 不存在于版式里` });
      continue;
    }
    for (const key of Object.keys(la as Record<string, unknown>)) {
      if (!(APPEARANCE_KEYS as readonly string[]).includes(key)) {
        issues.push({ level: 'error', message: `图层 ${id} 的字段 ${key} 不在外观契约里` });
      }
    }
    if (la.color !== undefined && !resolvable(la.color)) {
      issues.push({ level: 'error', message: `${id}.color 引用了 palette 里没有的角色：${la.color}` });
    }
    if (la.fill !== undefined && !resolvable(la.fill)) {
      issues.push({ level: 'error', message: `${id}.fill 引用了 palette 里没有的角色：${la.fill}` });
    }
    if (la.stroke && !resolvable(la.stroke.color)) {
      issues.push({ level: 'error', message: `${id}.stroke.color 引用不可解析：${la.stroke.color}` });
    }
    if (la.accent) {
      if (!Array.isArray(la.accent.words) || !la.accent.words.length) {
        issues.push({ level: 'error', message: `${id}.accent.words 必须是非空数组` });
      }
      if (!resolvable(la.accent.color)) {
        issues.push({ level: 'error', message: `${id}.accent.color 引用不可解析` });
      }
    }
  }

  // 每个文字层都要有颜色分配——这是本步骤的核心价值，缺了等于白跑
  for (const id of textIds) {
    if (!layers[id]?.color) {
      issues.push({ level: 'error', message: `文字层 ${id} 没有配 color` });
    }
  }

  return { issues, appearance: v };
}

// ── 主流程 ──

function stripFence(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

export async function compileAppearance(
  opts: AppearanceCompileOptions,
): Promise<AppearanceCompileResult> {
  const { getChatGateway } = await import('../../config');
  const maxRounds = opts.maxRounds ?? 3;

  const spec = JSON.parse(readFileSync(opts.specPath, 'utf8')) as DesignSketch;
  const briefText = opts.briefPath ? readFileSync(opts.briefPath, 'utf8').trim() : '';
  const fontSchemes = readdirSync(FONT_SCHEMES_DIR)
    .filter((f) => f.endsWith('.json') && f !== 'legacy-system.json')
    .map((f) => f.replace(/\.json$/, ''));
  const outPath = resolve(
    opts.outPath ?? dirname(opts.specPath),
    'design-appearance.json',
  );

  // 产品照 → data URL（看图取色）
  let imageDataUrl: string | null = null;
  if (opts.productPath && existsSync(opts.productPath)) {
    const { fileToDataUrl } = await import('../../designharness/gateway/util/data-url');
    imageDataUrl = fileToDataUrl(opts.productPath);
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt() },
    {
      role: 'user',
      content: userPrompt(layerSummary(spec), briefText, fontSchemes),
    },
    ...(imageDataUrl
      ? ([
          {
            role: 'user',
            content: [
              { type: 'text', text: '产品照（配色必须与实物主色一致或从它派生）：' },
              { type: 'image_url', image_url: { url: imageDataUrl, detail: 'low' } },
            ],
          },
        ] as unknown as ChatMessage[])
      : []),
  ];

  const gateway = getChatGateway();
  let usage: TokenUsage | undefined;
  let lastIssues: ValidationIssue[] = [];

  for (let round = 1; round <= maxRounds; round++) {
    let text = '';
    for await (const chunk of gateway.stream(messages, { temperature: 0.3, maxTokens: MAX_TOKENS })) {
      text += chunk.content;
      if (chunk.usage) usage = chunk.usage;
    }

    let value: unknown;
    try {
      value = JSON.parse(stripFence(text));
    } catch {
      messages.push({ role: 'assistant', content: text });
      messages.push({
        role: 'user',
        content: `输出不是合法 JSON：${text.slice(0, 120)}…。请只输出一个 JSON 对象。`,
      });
      console.log(`  ✗ 第 ${round} 轮：JSON 解析失败，重试`);
      continue;
    }

    const { issues, appearance } = validateAppearance(value, spec, fontSchemes);
    lastIssues = issues;
    const errors = issues.filter((i) => i.level === 'error');

    if (!errors.length) {
      writeFileSync(outPath, JSON.stringify(appearance, null, 2) + '\n', 'utf8');
      const warns = issues.length;
      console.log(`  ✓ 外观编译通过（${round} 轮${warns ? `，${warns} 个警告` : ''}）→ ${outPath}`);
      return { appearance, outPath, rounds: round, usage };
    }

    console.log(`  ✗ 第 ${round} 轮：${errors.length} 个问题，打回`);
    errors.slice(0, 6).forEach((i) => console.log(`      · ${i.message}`));
    messages.push({ role: 'assistant', content: text });
    messages.push({
      role: 'user',
      content:
        '## 必须修（error）\n\n' +
        errors.map((e, i) => `${i + 1}. ${e.message}`).join('\n') +
        '\n\n输出仍是**完整的 JSON**（不是 patch）。',
    });
  }

  throw new Error(
    `外观编译 ${maxRounds} 轮未通过：\n` +
      lastIssues.filter((i) => i.level === 'error').map((i) => `  - ${i.message}`).join('\n'),
  );
}
