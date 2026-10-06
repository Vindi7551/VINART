/**
 * ═══════════════════════════════════════════════════════════════════════
 * step-05 —— 创意方案 → design-sketch.json（编译器）
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 这是链 A（内容分析）与链 B（出图）之间那座一直空着的桥。
 *
 * ## 闭环
 *
 * ```
 *   创意方案（step-04 草案）
 *        ↓ ① 组装提示词（契约 + 草案）
 *   模型产 design-sketch.json
 *        ↓ ② 静态校验（checkSketch）
 *        │      ✗ → 错误清单喂回，回到①
 *        ↓ ✓
 *   渲草图（3 秒，零成本）
 *        ↓ ③ VLM 看草图，对照创意方案
 *        │      ✗ → 问题清单 + 草图一起喂回，回到①
 *        ↓ ✓
 *     完成
 * ```
 *
 * ## 两层校验为什么都要
 *
 * | 层 | 查得出 | 查不出 |
 * |---|---|---|
 * | **静态**（代码） | 字段缺失、类型写错、几何越界、id 重复 | 版式好不好 |
 * | **视觉**（VLM） | 元素重叠、占比不对、大片空洞、层级不清 | 字段级错误 |
 *
 * 两层互补：代码管「结构合法」，VLM 管「版式对不对」。
 *
 * ## 用法
 *
 * ```bash
 * npm run step scripts/step-05-compile-sketch.ts -- test_product/step-04-design.PT01.json
 * npm run step scripts/step-05-compile-sketch.ts -- <草案> --name PT10 --rounds 5
 * ```
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderSketchFile } from './runtime';

import { checkSketch, type SketchIssue } from './validate';
import { fileToDataUrl } from '../../designharness/gateway/util/data-url';
import type { DesignSketch } from './design-sketch';
import type { ChatMessage, ChatChunk, TokenUsage } from '../../designharness/gateway/type/chat';

// ── 参数 ──

const argv = process.argv.slice(2);
const argVal = (n: string): string | null => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : null;
};
const TAKES = new Set(['--name', '--rounds', '--out', '--prompt-lang', '--product']);
const used = new Set<number>();
argv.forEach((a, i) => {
  if (TAKES.has(a)) {
    used.add(i);
    used.add(i + 1);
  }
});
const positional = argv.filter((_a, i) => !used.has(i));

const DRAFT_PATH = resolve(positional[0] ?? '');
const MAX_ROUNDS = Number(argVal('--rounds') ?? 5);
/**
 * 素材订单的**提示词语言**（挂载的 step-order 逻辑透传）。
 * 默认 en——提示词的读者是生图模型（seedream 中英双语原生），
 * 与 listing 的市场语言无关。曾经默认 de 是设计混淆，已修正。
 */
const PROMPT_LANG = String(argVal('--prompt-lang') ?? 'en');
/** 商品照路径——有值时订单可引用 @product（商品保真参考）。只影响订单，本步不读文件 */
const PRODUCT = argVal('--product');
/** 商品照 data URL——传给订单编写模型**看图**，防止它凭品类常识猜颜色词（实测踩过） */
const PRODUCT_DATA_URL = PRODUCT && existsSync(PRODUCT) ? fileToDataUrl(PRODUCT) : null;
const CONTRACT_PATH = resolve('src/workflow/design-sketch/design-sketch.md');

// ── 模型调用 ──

/** 收集一次完整的流式回复 */
async function callModel(messages: ChatMessage[]): Promise<{ text: string; usage?: TokenUsage }> {
  const { getChatGateway } = await import('../../config');
  const gateway = getChatGateway();
  let text = '';
  let usage: TokenUsage | undefined;
  for await (const chunk of gateway.stream(messages, { temperature: 0.3 })) {
    const c = chunk as ChatChunk;
    if (c.content) text += c.content;
    if (c.usage) usage = c.usage;
  }
  return { text, usage };
}

/** 从模型回复里抠出 JSON（容忍 ```json 代码块与前后废话） */
function extractJson(text: string): { value: unknown; error?: string } {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : text).trim();
  try {
    return { value: JSON.parse(body) };
  } catch {
    // 退一步：找第一个 { 到最后一个 }
    const a = body.indexOf('{');
    const b = body.lastIndexOf('}');
    if (a >= 0 && b > a) {
      try {
        return { value: JSON.parse(body.slice(a, b + 1)) };
      } catch (e) {
        return { value: null, error: (e as Error).message };
      }
    }
    return { value: null, error: '找不到 JSON 对象' };
  }
}

// ── 提示词 ──

function systemPrompt(contract: string): string {
  return `你是一名版式设计师。你的工作是把一份「创意方案」翻译成 **design-sketch.json**。

这份 JSON 不是给人读的文档，而是**机器可渲染的版式规格**：渲染器会拿它画出草图。
所以每个字段都必须精确、合法、可执行。

---

# 契约（你必须严格遵守）

${contract}

---

# 你的输出

**只输出一个 JSON 对象**，不要写解释、不要写 markdown 标题。
可以放在 \`\`\`json 代码块里。

如果这是**修正轮**（用户消息里带有「上一轮的问题」），
请针对性地修复那些问题，**其余部分保持不变**，不要顺手重写整个版式。`;
}

function firstRoundMessage(draftText: string, name: string): string {
  return `下面是一份「创意方案」。请把它翻译成 design-sketch.json。

创意方案**没有固定格式**——它可能是 JSON、Markdown、一段散文，甚至一句话。
按它的**意思**来做，不要试图去解析它的结构。

⚠️ **第一条也是最重要的一条：你只管「什么放在哪、多大」。**

这份文件**只描述版式**。**不要**出现这些字段（写了会被校验拦下、白白浪费一轮）：

    fill · color · customColor · textColor · iconColor · background
    stroke · ring · edgeLine · edgeHighlight · style

**也不要把「光影 / 材质 / 特效」做成图层。** 这是硬边界，不是风格偏好——
成品阶段这些图层会被**真的画出来**，压在生成的画面上：

    ✗ 用 line 画一条「瓶身右侧的高光」        → 成品上就是一条对不齐的直线
    ✗ 用 shadow 给「AI 生成进场景的商品」补阴影 → 与场景里的阴影形成双影
    ✗ 铺一个满幅 rect 当「底色」              → 底色是颜色问题，属「外观」步骤

这份草图是**灰阶**的，要构思的只有「元素怎么摆」——往上铺一块满幅色块
既说明不了什么，也不属于排版。

颜色与描边属于「外观文件」，光影与材质属于「生图提示词」。
你要决定的是**位置、尺寸、字号、结构**。

**怎么判断方案里的一句话该归谁：**

| 方案里说的话 | 归谁 |
|---|---|
| 「标题放在上方居中、占宽 84%」 | **你**（落成 \`x/y/w/h\`）|
| 「深黑背景」「暖色调」「磨砂质感」 | 外观文件 / 生图提示词，**不写** |
| 「光从右上斜打过来」「瓶身一道细高光」 | **生图提示词，不写** |
| 「一瓶方形香水立在正中」 | **生图提示词**。你只需给它留出位置（一个框）|
| 「名字叫 NOIR 07」「底部小字 Eau de Parfum · 50 ml」 | **你**——这是画面文案，逐字落到 \`text\` |
| 「满幅装饰背景垫底（羊皮纸纹理 / 色块场景 / 四角装饰）」 | **你**——落成满幅 \`image\` 节点，**必须排在 layers 最前**（垫底），asset 名用 \`bg-*.png\`；纹理长什么样归生图提示词 |

---

要求：
- \`name\` 用 \`"${name}"\`
- 尺寸按方案里写的来；**没写就根据体裁自己判断**（竖版海报用 2000×3000，
  方形商品图用 2000×2000，横版横幅用 2400×1000）
- ⚠️ **要出现在画面上的文案**（标题、副标题、标签、脚注）必须落到某个图层的
  \`text\` / \`lines\` 里，一个字都不要漏、不要改。
  **但「描述画面效果的话」不是文案**——「斜光」「磨砂质感」「氛围怀旧」这类
  是生图提示词的事，不要做进图层。
- 方案里提到的分区、占比、位置关系，要落到具体的 0–1 坐标上
- **用「列网格」的方式思考**——这是设计师摆元素的方法，能让边缘自然对齐：

  | 体裁 | 列数 |
  |---|---|
  | 竖版海报 / 封面 | 3–5 列 |
  | 方形商品图 | 4–6 列 |
  | 横版广告 / 网页式 | 12 列 |

  - 主要元素的**左右边缘尽量落在列边界上**，不要随手给 0.37 这种数
  - 一行多个元素就用**等分**：3 个各占 1/3，2 个各占 1/2
  - **宁可精确对齐，也不要「差一点」**——一个在 0.37、另一个在 0.40，
    这种「近似对齐」是设计里最典型的错误，看起来就像没对齐
  - **间距只用这四档**（垂直方向、以及元素之间的横向间隙都算）：

    | 档 | 值 | 用在哪 |
    |---|---|---|
    | tight | 0.010 | 元素内部：小圆点与它的文字、图标与标签 |
    | group | 0.022 | 同一组内：三行条件彼此、卡片标题与说明 |
    | block | 0.045 | 组与组：条件组 ↔ 按钮、标题 ↔ 副标题 |
    | section | 0.085 | 大区块：头部区 ↔ 主要内容区 |

    - **同一层级必须用同一个值**（三行条件的间距都是 0.022，
      不要一个 0.018 一个 0.026）
    - **不同层级要差 2 倍以上**，否则读不出「哪几行是一伙的」
    - **不要把间距做平均** —— 全图间距都差不多大，
      是最常见的「松散、没重点」
- 方案没说到的地方（留白、装饰性的分区与分隔线）**由你按体裁的设计惯例补齐**——
  但**不含颜色、光影、材质**（它们有别的归宿）
- ⚠️ **背景图节点必须垫底**：方案要求「满幅装饰背景」时，该 image 节点排在
  \`layers\` 数组**第 0 位**——DOM 顺序即叠放顺序，排后面会把前景全盖住。
- **最后一条**：用 \`x-inferred\` 字段**报告你自行补充了哪些方案没说的东西**
  （额外分区、装饰线、分隔条、留白块…**只限版式性的东西**），格式：

      "x-inferred": [
        { "layer": "图层id", "what": "补了什么", "why": "为什么需要它" }
      ]

  什么都没补就写空数组 \`[]\`。这个字段**不会写进最终产物**——
  它只用来让人知道你做了哪些判断（否则别人看到凭空多出的图层会困惑）。
  修正轮里如果增删了图层，记得同步更新它。

  ⚠️ **只报「凭空添加」的**——方案里**完全没提到**、你按惯例加上去的东西
  （额外分区、装饰线、分隔条、留白块…**只限版式性的东西**）。
  **光影 / 材质类的东西本来就不该加**，所以也不会出现在这份清单里。

  **不要**报「方案说了但没给具体数值、由你落成坐标」这类——
  比如"方案说左上角，我给了 x=0.06"、"三行卖点的行距是 0.09"。
  那是你的本职，不算补充，写进来只会让这份报告失去重点。

---

${draftText}`;
}

/**
 * 修正轮的消息：把「上次的输出 + 问题清单」一起给它。
 *
 * ⚠️ 必须带**上次的输出**——只说"哪里错了"而不给原文，模型会凭记忆重写，
 * 很容易把原本对的部分也改坏。
 */
function fixRoundMessage(
  lastSpec: string,
  problems: string,
  kind: 'static' | 'visual',
  sketchPath?: string,
): ChatMessage {
  const head =
    kind === 'static'
      ? '上一轮你输出的 design-sketch.json **没通过结构校验**。下面是问题清单：'
      : '上一轮渲染出的**草图**在视觉上有问题（草图图片见附件）。对照创意方案，问题是：';

  const text = `${head}

${problems}

上一轮你输出的 JSON 是：
\`\`\`json
${lastSpec}
\`\`\`

## 修改纪律（必须遵守）

上一版里**没有被上面问题点名的节点**，它的每一个字段——
id / type / rect / shape / radius / transform / text /
fontScale / weight / align / asset / fit / name ——
都必须与上一版**逐字相同**。

原因：前几轮反复出现的失败模式是「修好了点名的问题，却顺手重排了别的元素」，
每修一轮就引入新的偏差。**未被点名的节点被改动 = 违规**——
哪怕你觉得"顺手优化一下更好"；要改它，就把它作为一条问题写进上面的问题里。

输出前自检：逐节点对比上一版，除了被点名的字段，任何字段都不许变。
输出仍然是**完整的 design-sketch.json**（不是 patch、不是片段）。`;

  if (kind === 'visual' && sketchPath && existsSync(sketchPath)) {
    const b64 = readFileSync(sketchPath).toString('base64');
    return {
      role: 'user',
      content: [
        { type: 'text', text },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}`, detail: 'original' } },
      ],
    };
  }
  return { role: 'user', content: text };
}

// ── 自报的「补全清单」──

/**
 * 取出并**删除** spec 里的 `x-inferred`。
 *
 * 用户明确要的一件能力：**模型按惯例自行补充的元素必须可见**。
 * 实测困惑场景：一份方案里完全没提"阴影"，产物里却凭空多出一个接触阴影图层
 * （还附带了托板和暗角）——不看数据根本不知道这些是哪来的。
 *
 * 所以让模型自报，编译器把它摘出来落成报告，**spec 保持干净**。
 */
function extractInferred(spec: unknown): { layer?: string; what?: string; why?: string }[] {
  const o = spec as Record<string, unknown>;
  const raw = o['x-inferred'];
  delete o['x-inferred'];
  return Array.isArray(raw) ? (raw as { layer?: string; what?: string; why?: string }[]) : [];
}

/** 把自报清单落成一份人读的报告 */
function writeInferredReport(
  outDir: string,
  name: string,
  items: { layer?: string; what?: string; why?: string }[],
): string {
  const p = resolve(outDir, 'compile-report.md');
  const head = `# 编译报告 —— ${name}

这份版式是由创意方案编译来的。下面记录**模型自行补充**的元素——
即**方案里没有明说**、由模型按体裁惯例判断加上去的。

> ⚠️ 这些不是方案要求的内容。如果你不想要其中任何一个，
> 删掉对应图层即可。**版式文件本身不含这些说明**（它不是契约的一部分）。

`;
  const body = items.length
    ? `| 图层 | 补了什么 | 为什么 |\n|---|---|---|\n` +
      items
        .map((i) => `| \`${i.layer ?? '?'}\` | ${i.what ?? '—'} | ${i.why ?? '—'} |`)
        .join('\n') +
      '\n'
    : '模型**没有**自行补充任何方案外的东西。\n';
  writeFileSync(p, head + body, 'utf8');
  return p;
}

// ── 静态校验的错误清单（给模型看的形式）──

function formatIssues(issues: SketchIssue[]): string {
  const errs = issues.filter((i) => i.level === 'error');
  const warns = issues.filter((i) => i.level === 'warn');
  const lines: string[] = [];
  if (errs.length) {
    lines.push('## 必须修（error）\n');
    errs.forEach((i, n) => lines.push(`${n + 1}. \`${i.path}\` —— ${i.message}`));
  }
  if (warns.length) {
    lines.push('\n## 建议修（warning）\n');
    warns.forEach((i, n) => lines.push(`${n + 1}. \`${i.path}\` —— ${i.message}`));
  }
  return lines.join('\n');
}

// ── 渲染草图 ──

/**
 * 渲草图。
 *
 * ⚠️ **在当前进程内渲染，不起子进程**。
 * 实测：某些环境（沙箱）里进程内 spawn 会 `spawnSync … EBUSY`，
 * 换 cmd.exe 或直接调 node 都一样。所以渲染逻辑必须可被 import
 * —— 这也是它被抽到 `lib/sketch-runtime.ts` 的原因。
 */
async function renderSketch(
  specPath: string,
  name: string,
): Promise<{ ok: boolean; png: string; log: string }> {
  const r = await renderSketchFile(specPath, resolve('test_product/layout', name));
  return { ok: r.ok, png: r.png, log: r.error ?? '' };
}

// ── 视觉验收（VLM 看图）──

interface Review {
  ok: boolean;
  issues: string[];
  raw: string;
}

async function reviewSketch(pngPath: string, draftText: string): Promise<Review> {
  const b64 = readFileSync(pngPath).toString('base64');
  const prompt = `下面是一张**版式草图**（不是成品图）。

## ⚠️ 先看清这张图是什么

草图上**只有**：区域虚线框、浅灰块、灰色文字占位条、区域名标签、CSS 图层标记。

**所以下面这些"缺失"都不是问题，不要报**：
- 方案里提到的**人 / 物 / 场景 / 商品**看不见 —— 它们由 AI 生成的照片承担，
  在草图上本来就不该出现，只表现为一块虚线框或浅灰区域。
  - 文字不是真字，只有灰条。**读灰条时请注意**：
    - **长度 = 这个文字块的「宽度」**（版式给定的，取决于文案多长、以及你想让它占多宽），
      **它不代表字号**。所以「标题条比副标题条长」**不等于**「标题字更大」。
    - **粗细（高度）才反映字号** —— 字号由 fontScale 决定，灰条高度跟着它走。
    - 判断层级请**主要看粗细**；长度只用来判断「这块占多宽、有没有越界或互相压住」。
- 没有颜色、光影、材质 —— 那是成图的事。

**你要检查的是版式本身**：区域怎么划分、各自占多大、位置对不对、
层级清不清楚（占位条的粗细长短反映字号）、有没有大片空洞或越界重叠。

## 📐 图上有辅助网格 —— 请**用它读数**

画面上有一层 **10% 的辅助网格**和一条**中心十字线**。那是**参照系，不是设计元素**，
不要把它当成内容报出来。**但它就是给你用的**：

- 判断**是否居中** → 直接对着网格说数值：中心线在 50%，某块的中心落在约 46%
- 判断**间距是否均匀** → 数格：两块之间的空隙是 1 格还是 3 格
- 判断**有没有贴边** → 看它离画布边缘还有几格
- 判断**占比** → 某块横跨了几格，就是百分之几十

**报问题时要给数字**（"左边缘约在 x=6%，右边缘约 x=71%，中心 38.5% 而非常要求的 50%"），
这比"偏左"有用得多。

---

请对照「创意方案」审校这张草图的**版式**。

**关注这五件事（按重要性）**：

1. **完整**：方案要求**有区域**的东西，图上都有对应的区域吗？
   （只算"区域"——文字条缺失、衬底层缺失、某个区域整个没画都算问题；
     但照片里的**内容**不在此列。）
2. **占比与位置**：方案说"主体占左侧 60%""三张卡竖排"，草图做到了吗？
3. **碰撞**：有没有元素互相压住、越出画布、或者该满幅的没满？
4. **层级**：最主要的东西是不是最醒目？有没有该大的不大？
5. **留白** —— ⚠️ 这条**最容易误判**，请严格按下面区分。

   **不要报**：单纯「有大片空白」。留白是设计手法；内容少的版面
   （比如一张只有 5 个信息块的海报）本来就会有较大空白，**那不是错**。

   **要报**——只有这两种才是真的错：

   - **分组被破坏**：本该在一起的一组元素（标题与它的副标题、列表的相邻两行）
     之间被拉开很大的空隙，读不出它们是一伙的
   - **同层级间距不一致**：属于同一层级的两处间距差别明显
     （三行条件的间距，一处 2%、一处 8%）

   **判断方法**：问一句「这个空白是**破坏了关系**，还是只是**没东西放**？」
   前者报，后者不报。
6. **眯眼测试**（最后必做一次）：把这张图想象成**一片模糊**——
   糊掉之后还能「跳出来」的那一块，就是它事实上的**主图**。
   它是不是方案里最想让人第一眼看到的东西？
   如果不是（比如一个次要信息块反而最抢眼），**这就是层级问题，必须报出来**。

   判据：**尺寸大不等于层级高**。位置、是否被装框/隔离、四周留白，
   都会影响谁先被看到。所以模糊后«跳出来»的那个才是真的主图。

**纪律**：
- 只报**你确实看到的**问题，不要为了提意见而提意见。
- 布局合理就明确说没问题——**"没问题"是合法且常见的答案**。
- 每条问题都写清"哪个区域、什么现象"。

「创意方案」（原文，格式不限）：
\`\`\`
${draftText}
\`\`\`

只输出 JSON：
{ "ok": true 或 false, "issues": ["问题1", "问题2"], "comment": "一句话总体评价" }`;

  const { text } = await callModel([
    { role: 'system', content: '你是严格的版式审校员。只报确凿的问题。' },
    {
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}`, detail: 'original' } },
      ],
    },
  ]);

  const { value } = extractJson(text);
  const v = value as { ok?: boolean; issues?: string[]; comment?: string } | null;
  if (!v || typeof v.ok !== 'boolean') {
    return { ok: true, issues: [], raw: text }; // 验收失败不阻塞（宁可放过）
  }
  return { ok: v.ok, issues: v.issues ?? [], raw: text };
}

// ══════════════════════════════════════════════════════════════════════
// 主流程
// ══════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  console.log('\n' + '═'.repeat(70));
  console.log('step-05 —— 创意方案 → design-sketch.json');
  console.log('═'.repeat(70));

  if (!existsSync(DRAFT_PATH)) {
    console.error(`\n✗ 找不到创意方案：${DRAFT_PATH}`);
    process.exit(1);
  }
  if (!existsSync(CONTRACT_PATH)) {
    console.error(`\n✗ 找不到契约文档：${CONTRACT_PATH}`);
    process.exit(1);
  }

  // ── 创意方案：**不要求任何固定格式** ──
  // 它是给模型读的，不是给程序解析的。JSON / Markdown / 一段散文都行。
  // 程序唯一需要从方案里拿的东西是「产物目录名」，那个用 --name 或文件名解决。
  const draftText = readFileSync(DRAFT_PATH, 'utf8');
  let draftForPrompt = draftText;
  try {
    // 是 JSON 就美化一下（可读性更好）；不是就原样用
    draftForPrompt = JSON.stringify(JSON.parse(draftText), null, 2);
  } catch {
    /* 不是 JSON —— 完全正常 */
  }
  const contract = readFileSync(CONTRACT_PATH, 'utf8');

  // 名字：命令行 > 方案文件里的 slot/id（若恰好是 JSON）> 文件名
  let draftName = '';
  try {
    const d = JSON.parse(draftText) as Record<string, unknown>;
    draftName = String((d.design as Record<string, unknown> | undefined)?.slot ?? d.slot ?? '');
  } catch {
    /* 非 JSON */
  }
  if (!draftName) draftName = DRAFT_PATH.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '');
  const NAME = String(argVal('--name') ?? draftName).replace(/[^A-Za-z0-9._-]/g, '');
  const OUT_DIR = resolve(argVal('--out') ?? resolve('test_product/layout', NAME));
  mkdirSync(OUT_DIR, { recursive: true });
  const SPEC_PATH = resolve(OUT_DIR, 'design-sketch.json');

  console.log(`\n  创意方案  ${DRAFT_PATH}`);
  console.log(`  契约      ${CONTRACT_PATH}（${(contract.length / 1024).toFixed(1)} KB）`);
  console.log(`  输出      ${OUT_DIR}`);
  console.log(`  最大轮次  ${MAX_ROUNDS}`);

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt(contract) },
    { role: 'user', content: firstRoundMessage(draftForPrompt, NAME) },
  ];

  let lastSpec = '';
  // 提到循环外：轮次用尽时也要能落盘这份报告
  let inferred: { layer?: string; what?: string; why?: string }[] = [];
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    console.log(`\n${'─'.repeat(70)}`);
    console.log(`第 ${round} / ${MAX_ROUNDS} 轮`);
    console.log('─'.repeat(70));

    // ① 产 spec
    const t0 = Date.now();
    const { text, usage } = await callModel(messages);
    console.log(
      `  模型回复  ${text.length} 字符  ${((Date.now() - t0) / 1000).toFixed(1)}s` +
        (usage ? `  （prompt ${usage.promptTokens} / completion ${usage.completionTokens}）` : ''),
    );

    const { value, error } = extractJson(text);
    if (error || !value) {
      const msg = `## 必须修（error）\n\n1. 你的回复不是合法 JSON：${error}\n   请只输出 JSON 对象，不要有解释文字。`;
      console.log('  ✗ JSON 解析失败，重试');
      messages.push({ role: 'assistant', content: text });
      messages.push({ role: 'user', content: msg });
      continue;
    }

    // 先摘出模型自报的「我补了什么」——它不属于契约，
    // 要从 spec 里删掉，只落成一份人读的报告。
    inferred = extractInferred(value);
    lastSpec = JSON.stringify(value, null, 2);

    // ② 静态校验
    const check = checkSketch(value);
    const errCount = check.issues.filter((i) => i.level === 'error').length;
    const warnCount = check.issues.filter((i) => i.level === 'warn').length;
    if (!check.ok) {
      console.log(`  ✗ 静态校验：${errCount} 个错误 / ${warnCount} 个警告`);
      check.issues
        .filter((i) => i.level === 'error')
        .slice(0, 5)
        .forEach((i) => console.log(`      · ${i.path} —— ${i.message.slice(0, 90)}`));
      messages.push({ role: 'assistant', content: text });
      messages.push(fixRoundMessage(lastSpec, formatIssues(check.issues), 'static'));
      continue;
    }
    console.log(`  ✓ 静态校验通过${warnCount ? `（${warnCount} 个警告）` : ''}`);

    // ③ 落盘 + 渲草图
    writeFileSync(SPEC_PATH, lastSpec + '\n', 'utf8');
    const r = await renderSketch(SPEC_PATH, NAME);
    if (!r.ok) {
      const tail = r.log.split('\n').filter(Boolean).slice(-4).join('\n');
      console.log(`  ✗ 渲染失败：\n${tail}`);
      messages.push({ role: 'assistant', content: text });
      messages.push(
        fixRoundMessage(
          lastSpec,
          `## 必须修（error）\n\n1. 渲染器报错（说明某个字段虽然合法但渲染不出来）：\n\`\`\`\n${tail}\n\`\`\``,
          'static',
        ),
      );
      continue;
    }
    console.log(`  ✓ 草图已渲染 → ${r.png}`);

    // ④ 视觉验收
    const review = await reviewSketch(r.png, draftForPrompt);
    if (review.ok) {
      const notePath = writeInferredReport(OUT_DIR, NAME, inferred);
      console.log(`  ✓ 视觉验收通过${review.raw ? '' : '（验收未返回结论，放行）'}`);

      // ── 素材订单（挂载 step-order 逻辑：产完版式顺手产订单）──
      // 失败**不回滚版式**——版式本身有效，重跑 scripts/step-order.ts 即可补。
      try {
        const { generateOrders } = await import('../assetsgen/order');
        const orders = await generateOrders({
          spec: value as DesignSketch,
          briefText: draftText,
          promptLang: PROMPT_LANG,
          productAvailable: !!PRODUCT,
          productDataUrl: PRODUCT_DATA_URL ?? undefined,
        });
        const ordersPath = resolve(OUT_DIR, 'assets.json');
        writeFileSync(ordersPath, JSON.stringify(orders, null, 2) + '\n', 'utf8');
        console.log(`  ✓ 素材订单 —— ${ordersPath}（${orders.length} 条）`);
      } catch (e) {
        console.error(`  ⚠️ 素材订单生成失败：${(e as Error).message.split('\n')[0]}`);
        console.error(
          '    版式已产出，不受影响。补跑：npm run step scripts/step-order.ts -- <版式> --brief <方案>',
        );
      }

      console.log(`\n${'═'.repeat(70)}`);
      console.log(`完成 —— ${SPEC_PATH}`);
      console.log(`草图 —— ${r.png}`);
      console.log(`自报补全 —— ${notePath}（${inferred.length} 项）`);
      console.log('═'.repeat(70) + '\n');
      return;
    }

    console.log(`  ✗ 视觉验收：${review.issues.length} 个问题`);
    review.issues.slice(0, 6).forEach((s) => console.log(`      · ${s}`));
    messages.push({ role: 'assistant', content: text });
    messages.push(
      fixRoundMessage(
        lastSpec,
        formatIssues(review.issues.map((s) => ({ level: 'error' as const, path: '(视觉)', message: s }))),
        'visual',
        r.png,
      ),
    );
  }

  const notePath = writeInferredReport(OUT_DIR, NAME, inferred);
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`⚠️  ${MAX_ROUNDS} 轮用尽，仍未完全通过。`);
  console.log(`最后一次的输出已落盘：${SPEC_PATH}`);

  // ── 素材订单（轮次用尽的版式**也要产**——它已落盘、可用）──
  // 首轮全链实测发现：只在验收通过分支产订单，导致 5 轮用尽的版式
  // 有 image 节点却没有订单 → gen 无单可跑 → final 缺素材中止。
  try {
    const { generateOrders } = await import('../assetsgen/order');
    const orders = await generateOrders({
      spec: JSON.parse(lastSpec) as DesignSketch,
      briefText: draftText,
      promptLang: PROMPT_LANG,
          productAvailable: !!PRODUCT,
          productDataUrl: PRODUCT_DATA_URL ?? undefined,
    });
    const ordersPath = resolve(OUT_DIR, 'assets.json');
    writeFileSync(ordersPath, JSON.stringify(orders, null, 2) + '\n', 'utf8');
    console.log(`素材订单 —— ${ordersPath}（${orders.length} 条）`);
  } catch (e) {
    console.error(`⚠️ 素材订单生成失败：${(e as Error).message.split('\n')[0]}`);
    console.error('  补跑：npm run step scripts/step-order.ts -- <版式> --brief <方案>');
  }

  console.log(`自报补全 —— ${notePath}（${inferred.length} 项）`);
  console.log('═'.repeat(70) + '\n');
}

main().catch((e) => {
  console.error('✗', e);
  process.exit(1);
});
