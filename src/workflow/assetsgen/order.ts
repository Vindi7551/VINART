/**
 * ═══════════════════════════════════════════════════════════════════════
 * 素材订单生成 —— 版式 + 创意方案 → assets.json
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 链路里最后一个手工环节的自动化：此前 assets.json 全靠手写——
 * 模型产完版式（compile）之后，要人按七要素/电商六段给每个图位写生图提示词。
 *
 * ## 输入与输出
 *
 *   输入  版式规格（哪些 image 节点要图）+ 创意方案（氛围与意图）
 *   输出  素材订单（AssetOrders，落盘为版式目录的 assets.json）
 *
 * ⚠️ 本阶段**不依赖**链 A（图像识别/卖点审计）——它的输入是「方案 + 版式」，
 * 手写方案和自动生成的方案在这里没有区别。链 A 是 brief 的上游，独立排期。
 *
 * ## 与 compile 的关系
 *
 * 独立命令（scripts/step-order.ts）先跑通、验证好之后，挂到 compile.ts 尾部
 * （产完版式顺手产订单，--prompt-lang 透传）——那时 brief → 订单 → 素材 → final
 * 全链无手工。
 *
 * ## 写法规范
 *
 * 全部硬约束（七要素 / 电商六段 / 保真声明 / 指令型禁则 / 一致性）编在
 * `systemPrompt()` 里喂给编写模型；产出的订单再过 `validateOrders()` 静态校验。
 * 两道关的规则与 `image.ts` 的运行时检查同源——生成前置拦截，省生图费。
 */

import type { ChatMessage, TokenUsage } from '../../designharness/gateway/type/chat';
import type { DesignSketch, ImageNode } from '../design-sketch/design-sketch';
import { BANNED_WORDS, type AssetOrders } from './asset-order';

/** 生图尺寸档位：像素 ≥ 3,686,400 下限（详见 assetsgen/README.md 硬约束） */
const SIZE_OPTIONS = ['2560x1440', '1440x2560', '2048x2048'] as const;

/**
 * 订单编写模型的系统提示——把 assetsgen/README.md 里的写法规范编进来。
 *
 * ⚠️ 这段文本就是「订单生成的规范」本身：七要素 / 电商六段 / 保真声明 /
 * 一致性 / 指令型禁则。改规范时**两处一起改**（README 与这里）。
 */
function systemPrompt(
  promptLangName: string,
  safeSentence: string,
  productAvailable: boolean,
  withProductPhoto: boolean,
): string {
  return `你是生图素材订单的编写者。输入一份版式规格和一份创意方案，为版式里的**每个 image 节点**写一条生图订单。

## 输出格式
JSON 数组，每条：
{
  "file": "<必须与版式节点 asset 字段完全一致的文件名>",
  "size": "<${SIZE_OPTIONS.join(' / ')} 之一>",
  "prompt": "<生图提示词>",
  "references": [],
  "useSketchRef": true
}
只输出 JSON 数组本身，不要任何解释文字。

## 提示词语言
用${promptLangName}写——提示词的读者是**生图模型**（中英双语原生），不是终端消费者，
与 listing 的市场语言无关。画面里不要出现任何文字——文字由后续的 HTML 层渲染，生图模型画字必然出错。

## 审核红线
不要出现 "logo" / "watermark" / "brand" 或任何语言的等价词——
即使语义是「不要 logo」也会触发内容审核。需要表达该约束时，
统一改写成「${safeSentence}」这类不含上述词的描述。

## 结构——按七要素组织，完整自然语言句子
1. 主体——是什么（可带需要模型注意的细节）
2. 动作与状态
3. 场景——发生在哪里（要具体：室内/室外、什么地面、背景有什么）
4. 风格与媒介——什么质感的照片（如：商业产品摄影 / 胶片）
5. 光线与色调——光源方向与色温（如：左侧柔光箱 / 暖钨丝灯＋冷蓝阴影）
6. 构图·镜头——机位、焦段、景深（如：45° 俯视 / 85mm f/1.8 / 浅景深 / 留白）——**必填**
7. 技术参数不写进 prompt（size 是独立字段）

## 电商商品图的收敛（若节点画的是产品/商品，用这六段取代泛用七要素）
产品事实（材质＋颜色＋造型）/ 镜头角度 / 光线 / 背景 / 约束（见审核红线）/ **保真声明**
保真声明的语义必须完整：保持形状、盒盖、标签与颜色与参考图完全一致，不添加任何额外文字或图形（用提示词语言表达）。

## 背景类节点（满幅、位于图层最底、asset 名常以 bg- 开头）
这种节点画的是**整版的设计背景**，不是产品照：
- 只描述背景本身：纹理、材质、装饰元素与色调（如：羊皮纸质感、四角秋叶藤蔓装饰、暖奶油色）
- **禁止**出现产品、人物、文字、logo——前景内容由版式层叠在上面
- 上面那套「电商六段 / 保真声明」**不适用**；构图写「满幅平铺、无居中主体」
- 通常不需要 @product；@sketch 可用于锁定装饰元素的分布

## 模型类型：指令型（当前接入的是 seedream）
- 完整自然语言句子
- **禁止**权重语法 (词:1.4) / ::2——用「以…为主」的表述
- **禁止**质量词堆砌（masterpiece / best quality / 8k）
- 不用负向词

## 整套图一致性
同一产品的多张订单：**只换场景或角度，锁定光照 / 色温 / 背景基调**——
描述光照与背景时用相同或高度相近的词句，成品才像「同一次拍摄」。

## 参考图
- "@sketch"（role: "compose"）会由内核自动补上，**不需要**你写进 references
- ${productAvailable
    ? '可以使用 { "ref": "@product", "role": "subject" } 引用商品实物照（商品保真场景）。'
    : '**不要**引用 "@product"（本次没有商品照）。'}
${withProductPhoto
    ? `\n## 颜色纪律（实测教训，必须遵守）\n商品实物照**附在本消息里**。引用 @product 的订单：\n- **颜色词必须与照片一致**——照片是什么色就写什么色\n- **禁止**凭 brief 措辞或品类常识推断颜色（实测：brief 说「拼色」、你按"抓绒常是灰"写了 light grey，实物下半是亮蓝 → 成品错色 = 平台「与实物不符」违规）\n- 拿不准的颜色就不写具体色名，用「the exact colors shown in Reference 1」让参考图定色\n`
    : ''}

## 尺寸
按节点图位的宽高比（rect.w/rect.h）从 ${SIZE_OPTIONS.join(' / ')} 里选最接近的一档（下限已内置）。`;
}

export interface GenerateOrdersOptions {
  spec: DesignSketch;
  /** 创意方案全文 */
  briefText: string;
  /**
   * 生图提示词语言代码：en / de / zh …
   * ⚠️ 提示词的读者是生图模型（seedream 中英双语原生），与 listing 的
   * 市场语言无关——不要把终端市场的语言直接搬到这里。
   */
  promptLang?: string;
  /** 商品照是否可用（决定模型能不能引用 @product） */
  productAvailable?: boolean;
  /**
   * 商品照 data URL——传了就**给编写模型看图**。
   * 实测教训：只给布尔时模型看不到实物，凭品类常识猜颜色词
   * （抓绒→grey），而 prompt 里的颜色词会压过生图时的参考图 → 成品错色。
   */
  productDataUrl?: string;
}

/** 语言代码 → 名称 与 「无文字」安全句式（审核红线段的示范） */
const LANG_META: Record<string, { name: string; safe: string }> = {
  en: { name: '英语（English）', safe: 'the product carries no printed text elements' },
  de: { name: '德语（German）', safe: 'Enthält keine Schriftzeichen' },
  zh: { name: '中文', safe: '产品表面没有任何印刷文字元素' },
};

/** 提取版式里的 image 节点摘要（喂给编写模型的部分） */
function imageSummaries(spec: DesignSketch) {
  return spec.layers
    .filter((l): l is ImageNode => l.type === 'image')
    .map(({ id, name, asset, rect }) => ({ id, name, asset, rect }));
}

export async function generateOrders(opts: GenerateOrdersOptions): Promise<AssetOrders> {
  const { spec, briefText } = opts;
  const promptLang = opts.promptLang ?? 'en';
  const meta = LANG_META[promptLang] ?? { name: promptLang, safe: 'no printed text elements' };
  const images = imageSummaries(spec);
  if (!images.length) {
    console.log('    版式没有 image 节点，无需素材订单');
    return [];
  }

  const withProductPhoto = !!opts.productDataUrl;
  const userText =
    `## 创意方案\n\n${briefText}\n\n` +
    `## 版式里的 image 节点（为每一个写一条订单）\n\n` +
    '```json\n' +
    JSON.stringify(images, null, 2) +
    '\n```' +
    (withProductPhoto
      ? '\n\n（下一条附商品实物照：颜色/材质/结构以它为准）'
      : '');

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: systemPrompt(meta.name, meta.safe, opts.productAvailable ?? false, withProductPhoto),
    },
    ...(withProductPhoto
      ? ([
          { role: 'user', content: userText },
          // 视觉档位 original——实测低档会漏细节；订单编写每版式只调一轮，成本可接受
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: { url: opts.productDataUrl!, detail: 'original' },
              },
            ] as ChatMessage['content'],
          },
        ] as ChatMessage[])
      : ([{ role: 'user', content: userText }] as ChatMessage[])),
  ];

  // ── 产订单 → 校验 → 回喂修正（与 compile.ts 的多轮模式一致）──
  // 首轮实测就证明了必要性：模型写「无 logo」时用了 ohne Logos/Marken——
  // 触发审核禁词。这种错静态校验能抓，回喂一轮就能修。
  const MAX_ROUNDS = 3;
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    console.log(`    第 ${round}/${MAX_ROUNDS} 轮`);
    const { text, usage } = await callModel(messages);
    console.log(
      `    模型回复  ${text.length} 字符` +
        (usage ? `（prompt ${usage.promptTokens} / completion ${usage.completionTokens}）` : ''),
    );

    let orders: AssetOrders;
    try {
      orders = parseOrders(text);
    } catch (e) {
      // JSON 解析失败（如输出被截断成半个数组）——回喂重试
      messages.push({ role: 'assistant', content: text });
      messages.push({
        role: 'user',
        content: `上一轮输出不是合法的 JSON 数组（${(e as Error).message.slice(0, 200)}）。请重新输出**完整的** JSON 数组。`,
      });
      continue;
    }

    const problems = validateOrders(orders, spec);
    if (!problems.length) {
      // 订单自包含语言标记——gen 阶段（image.ts）按它拼参考图角色说明
      for (const o of orders) o.promptLang = promptLang;
      return orders;
    }

    console.log(`    ✗ 校验未过：${problems.length} 个问题`);
    for (const p of problems) console.log(`      · ${p}`);

    messages.push({ role: 'assistant', content: text });
    messages.push({ role: 'user', content: fixOrdersMessage(text, problems) });
  }
  throw new Error(`素材订单连续 ${MAX_ROUNDS} 轮校验未通过`);
}

/** 修正轮消息：问题清单 + 上一版全文（与 compile 的 fixRoundMessage 同模式） */
function fixOrdersMessage(lastText: string, problems: string[]): string {
  return `上一版素材订单没通过校验。问题清单：

${problems.map((p, i) => `${i + 1}. ${p}`).join('\n')}

上一版 JSON：
${lastText}

## 修改纪律（必须遵守）
- **只修列出的问题**。未被点名的条目，每个字段都必须与上一版**逐字相同**——
  顺手重排其他条目会引入新问题（实测的失败模式）。
- 特别注意：出现审核禁词的句子，**即使语义是「不要 logo」也会触发内容审核**。
  按系统提示的「审核红线」段改写成不含禁词的描述。
- 输出仍然是**完整的 JSON 数组**。`;
}

async function callModel(messages: ChatMessage[]): Promise<{ text: string; usage?: TokenUsage }> {
  const { getChatGateway } = await import('../../config');
  const gateway = getChatGateway();
  let text = '';
  let usage: TokenUsage | undefined;
  for await (const chunk of gateway.stream(messages, { temperature: 0.3 })) {
    text += chunk.content;
    if (chunk.usage) usage = chunk.usage;
  }
  return { text, usage };
}

/** 从模型回复里抠出 JSON 数组（容忍 ```json 围栏与前后闲话） */
function parseOrders(text: string): AssetOrders {
  const a = text.indexOf('[');
  const b = text.lastIndexOf(']');
  if (a < 0 || b <= a) throw new Error(`模型回复里没有 JSON 数组：\n${text.slice(0, 300)}`);
  return JSON.parse(text.slice(a, b + 1)) as AssetOrders;
}

/**
 * 静态校验——不调模型就能判的全部拦下。
 * 与 `image.ts` 的运行时检查同源：审核禁词在生成阶段就是**问题**（前置拦截省生图费），
 * 权重语法 / 质量词同样是问题（订单还没执行就该改）。
 */
export function validateOrders(orders: AssetOrders, spec: DesignSketch): string[] {
  const problems: string[] = [];
  const specAssets = spec.layers
    .filter((l): l is ImageNode => l.type === 'image')
    .map((l) => l.asset);

  // 覆盖检查：版式的每个 image 素材都有订单；没有凭空多出的订单
  for (const a of specAssets) {
    if (!orders.some((o) => o.file === a)) problems.push(`版式引用的素材 "${a}" 没有订单`);
  }
  for (const o of orders) {
    if (!specAssets.includes(o.file)) problems.push(`订单 "${o.file}" 不被版式引用（file 必须与节点 asset 完全一致）`);
  }

  const seen = new Set<string>();
  for (const o of orders) {
    if (seen.has(o.file)) problems.push(`订单 "${o.file}" 重复`);
    seen.add(o.file);
    if (!o.prompt?.trim()) {
      problems.push(`"${o.file}" 的 prompt 为空`);
      continue;
    }

    // 审核禁词（多语言合并表，与 image.ts 的运行时检查同源，前置拦截省 API 费）
    BANNED_WORDS.lastIndex = 0;
    const banned = BANNED_WORDS.exec(o.prompt);
    if (banned) {
      problems.push(`"${o.file}" 的 prompt 含审核禁词「${banned[0]}」——改写成「不带任何印刷文字」类描述`);
    }

    // 指令型写法禁则——订单还没执行就该改
    if (/\([^()]*:\s*\d+(?:\.\d+)?\s*\)/.test(o.prompt) || /::\s*\d/.test(o.prompt)) {
      problems.push(`"${o.file}" 的 prompt 含权重语法 (词:1.4)——指令型模型无效，改用「以…为主」`);
    }
    if (/masterpiece|best quality|highly detailed|award[- ]?winning|\b8k\b|\b4k\b/i.test(o.prompt)) {
      problems.push(`"${o.file}" 的 prompt 含质量词堆砌——对指令型模型有害`);
    }

    // 尺寸下限
    const m = /^(\d+)x(\d+)$/.exec(o.size ?? '');
    if (!m) {
      problems.push(`"${o.file}" 的 size "${o.size}" 格式应为 宽x高`);
    } else if (Number(m[1]) * Number(m[2]) < 3_686_400) {
      problems.push(`"${o.file}" 的 size ${o.size} 低于 3,686,400 像素下限`);
    }
  }

  return problems;
}
