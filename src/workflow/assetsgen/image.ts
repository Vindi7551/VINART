/**
 * ═══════════════════════════════════════════════════════════════════════
 * 素材生成 —— 读素材订单，逐条调生图模型
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 从旧驱动脚本的 gen 段抽出（那时各阶段都长在同一个 main 里；那个驱动已于 2026-10-09 删除）。
 * 抽出来的原因和 `design-sketch/runtime.ts` 一样：**编译器也要用它**
 * ——将来"订单生成"就建在本目录，产完订单直接接着生图，整条链不出进程。
 *
 * ## 职责
 *
 *   输入  素材订单（`assets.json`）+ 版式（找每个素材所属的图位）
 *   输出  素材文件（`outDir/<file>`）
 *
 *   中间：商品抠图（仅当订单引用 `@product`）·
 *         草图按**图位 rect** 裁切（compose 参考）·
 *         提示词拼参考图角色说明 · 调生图模型（审核失败自动重试）
 *
 * ⚠️ 版式**草图**的渲染不在这里——它属于 `design-sketch` 阶段
 * （`runtime.ts` / `sketch.ts`），调用方保证 gen 之前草图已存在。
 */

import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { DesignSketch } from '../design-sketch/design-sketch';
import { BANNED_WORDS, type AssetOrders, type AssetReference, type AssetRequest } from './asset-order';
import { cropToRef, dataUrlToBuffer, downscaleToRef, prepareProduct } from './cutout';

/**
 * 提供临时浏览器页的宿主（用**最小结构类型**，避免依赖 playwright）。
 * 参考图的缩放 / 裁切都在浏览器 canvas 里做。
 */
export interface CanvasHost {
  newPage(): Promise<{
    evaluate: <T>(fn: (arg: unknown) => T, arg: unknown) => Promise<T>;
    close(): Promise<void>;
    /** 可选：设置视口（文字自适应测量需要与画布同尺寸） */
    setViewportSize?: (size: { width: number; height: number }) => Promise<void>;
  }>;
}

/**
 * 参考图**角色** → 各语言说明。
 *
 * 这段说明以前是**手写在提示词散文里**的（"Referenzbild 1 = das Produkt.
 * Referenzbild 2 = der Layout-Entwurf."）——换用途就得重写一遍，加到三张就乱。
 * 现在由角色统一生成，且顺序与 `refs` 数组严格一致。
 *
 * 语言按订单的 `promptLang` 选（promptLang 记在 assets.json 里，订单自包含），
 * 兜底 `en`——seedream 中英双语原生，英文是一等公民；德语是 5.0 才额外
 * 支持的语言，不该当默认。
 */
const ROLE_LABELS: Record<string, Record<string, string>> = {
  en: {
    subject: 'the subject appearance reference (match its look exactly, then re-shoot it in the scene — do not paste this photo into the frame)',
    compose: 'the layout draft (take only the arrangement, not the contents)',
    style: 'a style reference (light mood and material feel)',
    detail: 'a close-up detail',
  },
  de: {
    subject: 'die Referenz für das Aussehen des Motivs (Aussehen exakt übernehmen, dann im Szene neu fotografieren – dieses Foto nicht einfügen)',
    compose: 'der Layout-Entwurf (nur die Anordnung übernehmen, keine Inhalte daraus)',
    style: 'eine Stilreferenz (Lichtstimmung und Materialwirkung)',
    detail: 'eine Detailaufnahme',
  },
  zh: {
    subject: '主体外观参考（外观必须完全一致，然后**在场景里重拍一遍**——不要把这张照片贴进画面）',
    compose: '版式草图（只取构图排布，不取内容）',
    style: '风格参考（光线氛围与材质质感）',
    detail: '局部细节特写',
  },
};

/** 参考图说明段的前缀词，同样按语言 */
const REF_PREFIX: Record<string, string> = {
  en: 'REFERENCE IMAGES',
  de: 'BILDNACHWEISE',
  zh: '参考图说明',
};

/** 把角色说明拼到提示词前面（语言按订单 promptLang，兜底 en） */
function buildPrompt(prompt: string, refs: AssetReference[], lang: string): string {
  if (!refs.length) return prompt;
  const labels = ROLE_LABELS[lang] ?? ROLE_LABELS.en;
  const lines = refs.map((r, i) => `Reference ${i + 1} = ${labels[r.role] ?? r.role}`);
  return `${REF_PREFIX[lang] ?? REF_PREFIX.en}: ${lines.join('. ')}. ${prompt}`;
}

/**
 * 运行时安全检查——提示词里**禁止出现品牌 / 水印类词汇**：
 * 实测会触发内容审核（讽刺的是"禁止品牌标识"这条指令本身就会触发）。
 * 禁词表与订单生成（order.ts）共用 asset-order.ts 的 BANNED_WORDS——
 * 审核器共性与提示词语言无关。
 */
function assertPromptSafe(prompt: string, file: string): void {
  BANNED_WORDS.lastIndex = 0;
  if (BANNED_WORDS.test(prompt)) {
    throw new Error(
      `素材 ${file} 的提示词含品牌 / 水印类词汇，会触发内容审核。` +
        '改写成「画面不带任何印刷文字元素」这类不含禁词的描述。',
    );
  }
}

/**
 * 指令型模型的**写法禁则**检查——**warn 而不拦**。
 *
 * 这些写法不会炸流程（不像审核词会 403），但对指令型模型要么无效、
 * 要么有害，白花生图费：
 * - 权重语法 `(red dress:1.4)` / `marble::2` —— 指令型不认识，
 *   要用「以…为主」的自然语言表述
 * - 质量词堆砌 masterpiece / best quality / 8k —— 对指令型**有害**
 *   （那是标签权重型模型的手段）
 */
function warnPromptStyle(prompt: string, file: string): void {
  if (/\([^()]*:\s*\d+(?:\.\d+)?\s*\)/.test(prompt) || /::\s*\d/.test(prompt)) {
    console.warn(
      `    ⚠️ ${file} 的提示词含权重语法 (词:1.4) / ::2 —— 当前指令型模型不认识，改用「以…为主」的表述`,
    );
  }
  if (/masterpiece|best quality|highly detailed|ultra[- ]?detailed|award[- ]?winning|\b8k\b|\b4k\b/i.test(prompt)) {
    console.warn(`    ⚠️ ${file} 的提示词含质量词堆砌——对指令型模型有害无益，删掉它们`);
  }
}

/**
 * 商品图的**保真声明**检查——订单引用 @product 却没有保真表述时 warn。
 *
 * 保真声明是商品图与艺术图的唯一实质区别：不声明，模型会擅自改 logo、
 * 增删部件——对应平台「与实物不符」违规、退货与广告拒审。
 */
function warnFidelity(prompt: string, file: string): void {
  if (
    /(keep|preserve|maintain|identical|exactly the same|genau|unverändert|original|保持|完全一致|不变)/i.test(
      prompt,
    )
  )
    return;
  console.warn(
    `    ⚠️ ${file} 引用了 @product 但 prompt 里没有保真声明——模型可能擅自改 logo、增删部件（平台「与实物不符」违规）。\n` +
      '       典型句式：keep the shape, lid, label and color exactly the same, do not add extra text or graphics',
  );
}

export interface GenerateAssetsOptions {
  orders: AssetOrders;
  /** 版式（用于找每个素材所属的 image 节点 → 裁草图参考） */
  spec: DesignSketch;
  /** 素材输出目录（同时也是 sketch.png 所在目录） */
  outDir: string;
  /**
   * 商品照路径。**仅当订单引用 `@product` 时必须提供**；
   * 没有引用（如纯场景版式）传 null，商品抠图整段跳过。
   */
  productPath: string | null;
  /** 提供浏览器页（canvas 处理参考图） */
  host: CanvasHost;
  /** true = 已存在的素材也重新生成 */
  force: boolean;
}

/** 单张素材的生成结果（聊天工具链路要逐张向用户汇报） */
export interface AssetJobResult {
  file: string;
  ok: boolean;
  /** true = 文件已存在被跳过（force=false 时） */
  skipped?: boolean;
  /** 生成产物字节数 */
  bytes?: number;
  error?: string;
}

function guessRole(ref: string): 'subject' | 'compose' | 'detail' {
  if (ref === '@product') return 'subject';
  if (ref === '@sketch') return 'compose';
  return 'detail';
}

/**
 * orders 归一化（容错 LLM 写出的宽松形态）：
 * 实测：主 AI 会把 references 写成字符串数组 ["@product"]（契约是对象数组
 * [{ref, role}]）——不归一化会在参考图解析时 resolve(outDir, undefined) 炸掉整批
 * （paths[1] undefined，实测泳衣 PT04/PT05）。字符串按语义推断 role。
 */
/**
 * 移除提示词里含禁词的短语片段（逗号/分号分隔）。
 * 否定式免责语（'no logos, no watermark'）是实测陷阱：负面提及照样触发
 * 内容审核（BANNED_WORDS 是字面匹配，不管否定）。移除即安全——生图模型
 * 不加免责语也不会画水印。
 */
function stripBannedPhrases(prompt: string): string {
  BANNED_WORDS.lastIndex = 0;
  if (!BANNED_WORDS.test(prompt)) return prompt;
  const cleaned = prompt.split(/[,;；，]s*/)
    .filter((part) => {
      BANNED_WORDS.lastIndex = 0;
      return !BANNED_WORDS.test(part);
    })
    .join(", ")
    .replace(/s{2,}/g, " ")
    .replace(/[,;，]s*$/, "")
    .trim();
  BANNED_WORDS.lastIndex = 0;
  return cleaned || prompt; // 全被移除的极端情况：保留原文让 assertPromptSafe 拦
}

function normalizeOrders(orders: AssetOrders): AssetOrders {
  return orders.map((o) => {
    const refs = (o as { references?: unknown }).references;
    let references: AssetReference[] | undefined;
    if (typeof refs === 'string') references = [{ ref: refs, role: guessRole(refs) }];
    else if (Array.isArray(refs)) {
      references = refs.map((r) => {
        const ref = typeof r === 'string' ? r : (r as AssetReference).ref;
        const role = typeof r === 'object' && r !== null && (r as AssetReference).role
          ? (r as AssetReference).role
          : guessRole(ref);
        return { ref, role };
      });
    }
    // 禁词短语清理：否定式免责语（如 'no logos, no watermark'）本身就会触发审核
    // （BANNED_WORDS 命中，实测）——按逗号/分号拆句移除含禁词的片段。
    // 移除后仍命中的（句中禁词）由 assertPromptSafe 拦（fail-loud 兜底）。
    const promptClean = stripBannedPhrases(o.prompt);
    return { ...o, ...(references ? { references } : {}), prompt: promptClean, size: o.size ?? '2048x2048' };
  });
}


export async function generateAssets(opts: GenerateAssetsOptions): Promise<AssetJobResult[]> {
  const { spec, outDir, force } = opts;
  const orders = normalizeOrders(opts.orders);

  if (!orders.length) {
    console.log('\n[2] 规格里没有声明要生成的素材');
    return [];
  }

  // ── 前置检查 ──

  const needsProduct = orders.some((o) => o.references?.some((r) => r.ref === '@product'));
  if (needsProduct && !opts.productPath) {
    throw new Error('订单引用了 @product，但没有提供商品照路径（productPath）');
  }

  console.log(`\n[2] 生成素材（${orders.length} 张）`);
  const { getImageGateway } = await import('../../config');
  const gateway = getImageGateway();

  // 提示词语言从订单读（订单自包含，order.ts 生成时写入）——
  // 参考图角色说明要与提示词同语言，不搞德文前缀接英文正文的混搭。
  const promptLang = orders.find((o) => o.promptLang)?.promptLang ?? 'en';

  const needed = (p: string) => force || !existsSync(p);
  const sketchPath = resolve(outDir, 'sketch.png');

  // ── 0. 商品抠图（仅当订单引用 @product）──
  //
  // ⚠️ 参考图分辨率**不能压**。曾经默认 768px，结果商品上的雕刻小字
  // 在参考图里根本读不清 → 生成时模型只能编造（畸形/截断/"EMPF…"）。
  // 裸调实验对照：原样 2.61MB 全分辨率传入，雕刻**逐字全对**（含最小的图标说明）。
  // 我们把证据弄糊了再让它抄。这里给 2048（照片 1254px 会原样通过，不放大）。
  let productRef: string | null = null;
  if (needsProduct && opts.productPath) {
    console.log('\n[0] 商品素材');
    const page = await opts.host.newPage();
    const probe = await prepareProduct(
      page as unknown as { evaluate: <T>(fn: (a: unknown) => T, a: unknown) => Promise<T> },
      opts.productPath,
      2048,
    );
    await page.close();

    console.log(`    照片     : ${probe.natural.W}×${probe.natural.H}`);
    console.log(`    主体边界 : ${probe.bbox.bw}×${probe.bbox.bh}（占宽 ${((probe.bbox.bw / probe.natural.W) * 100).toFixed(1)}%）`);
    console.log(`    抠图 alpha: 透明 ${(probe.alpha.transparent * 100).toFixed(1)}% / 实体 ${(probe.alpha.opaque * 100).toFixed(1)}% / 过渡 ${(probe.alpha.partial * 100).toFixed(1)}%`);
    const cutoutPath = resolve(outDir, 'product-cutout.png');
    writeFileSync(cutoutPath, dataUrlToBuffer(probe.cut));
    console.log(`    抠图 → ${cutoutPath}`);
    productRef = probe.ref;
  }

  // ── 逐条生成（并发池）──
  // 聊天工具链路一次订单可能是十几张素材：串行 ≈ 15s/张 × N 太慢。
  // 并发池限 3——doubao API 扛得住；更高并发没实测过收益，不赌。
  // host.newPage 并发开多页安全（共享 context，与多子 agent 并发渲染同机制）。
  const CONCURRENCY = 3;

  async function generateOne(job: AssetRequest): Promise<AssetJobResult> {
    const target = resolve(outDir, job.file);
    if (!needed(target)) {
      console.log(`    ${job.file} 已存在，跳过`);
      return { file: job.file, ok: true, skipped: true };
    }

    // ── 按**角色**组装参考图 ──
    // 以前"哪张图是干什么"是手写在提示词散文里的，换用途就得重写；
    // 现在由角色统一生成说明，且参考图顺序与说明顺序严格一致。
    const refs: string[] = [];
    const declared: AssetReference[] = [...(job.references ?? [])];
    const hasSketch = declared.some((r) => r.ref === '@sketch');
    if (!hasSketch && job.useSketchRef !== false) {
      declared.push({ ref: '@sketch', role: 'compose' });
    }

    for (const r of declared) {
      if (r.ref === '@product') {
        if (!productRef) throw new Error(`素材 ${job.file} 引用了 @product，但商品抠图没有产出`);
        refs.push(productRef);
        continue;
      }
      if (r.ref === '@sketch') {
        // 按**引用这份素材的 image 节点的 rect** 裁草图——
        // 只让模型看到"这个图位"的构图，看不到版式的文字占位条。
        // （实测：整张草图传进去，模型会把文字占位条当设计画进素材。）
        const owner = spec.layers.find((l) => l.type === 'image' && l.asset === job.file);
        const region =
          owner && owner.type === 'image' ? owner.rect : { x: 0, y: 0, w: 1, h: 1 };
        const ep = await opts.host.newPage();
        refs.push(
          await cropToRef(
            ep as unknown as { evaluate: <T>(fn: (a: unknown) => T, a: unknown) => Promise<T> },
            sketchPath,
            region,
            1536,
          ),
        );
        await ep.close();
        continue;
      }
      const p = resolve(outDir, r.ref);
      if (!existsSync(p)) {
        console.log(`    ⚠️ 参考图不存在，忽略：${r.ref}`);
        declared.splice(declared.indexOf(r), 1);
        continue;
      }
      const ep = await opts.host.newPage();
      refs.push(
        await downscaleToRef(
          ep as unknown as { evaluate: <T>(fn: (a: unknown) => T, a: unknown) => Promise<T> },
          p,
          1024,
        ),
      );
      await ep.close();
    }

    // 实测：参考图**最多 2 张**同时传可用。超了要先在 spec 里砍掉。
    if (refs.length > 2) {
      console.log(`    ✗ ${job.file} 需要 ${refs.length} 张参考图，实测最多 2 张可用`);
      console.log('      请减少 references，或分两步生成。');
      return { file: job.file, ok: false, error: `需要 ${refs.length} 张参考图，实测最多 2 张可用——请减少 references` };
    }

    const usesProduct = declared.some((r) => r.ref === '@product');
    if (usesProduct) warnFidelity(job.prompt, job.file);

    const prompt = buildPrompt(job.prompt, declared, promptLang);
    assertPromptSafe(job.prompt, job.file);
    warnPromptStyle(prompt, job.file);

    console.log(`\n    ── ${job.file} ──`);
    console.log(`       参考图 ${refs.length} 张：${declared.map((r) => r.ref + '(' + r.role + ')').join(', ') || '无'}`);
    console.log(`       提示词 ${prompt.length} 字符（含自动生成的参考图说明 ${prompt.length - job.prompt.length} 字符）`);

    const size = job.size ?? '2048x2048';

    // 生图失败要重试：实测内容审核是**概率性**的——
    // 同一个提示词带 size 时成功、去掉 size 时被
    // InputTextSensitiveContentDetected 拦截。这种抖动只能靠重试兜。
    const MAX_ATTEMPTS = 3;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const t0 = Date.now();
      try {
        const r = await gateway.generate({
          prompt,
          referenceImages: refs,
          size,
          count: 1,
          format: 'png',
        });
        const img = r.images[0];
        if (!img) throw new Error('未返回图片');

        const res = await fetch(img.url);
        if (!res.ok) throw new Error(`下载 HTTP ${res.status}`);

        const buf = Buffer.from(await res.arrayBuffer());
        writeFileSync(target, buf);
        console.log(
          `       ✓ ${job.file}  ${buf.readUInt32BE(16)}×${buf.readUInt32BE(20)}  ` +
            `${(buf.length / 1024).toFixed(0)} KB  ${((Date.now() - t0) / 1000).toFixed(0)}s` +
            (attempt > 1 ? `（第 ${attempt} 次尝试）` : ''),
        );
        return { file: job.file, ok: true, bytes: buf.length };
      } catch (e) {
        const msg = (e as Error).message;
        const short = msg.split('\n').filter(Boolean).slice(-1)[0] ?? msg;
        if (attempt < MAX_ATTEMPTS) {
          console.log(`       ↻ ${job.file} 第 ${attempt} 次失败：${short.slice(0, 160)}`);
          console.log(`         重试…`);
          await new Promise((r) => setTimeout(r, 1500 * attempt));
        } else {
          console.log(`       ✗ ${job.file} 连续 ${MAX_ATTEMPTS} 次失败：${short.slice(0, 300)}`);
          return { file: job.file, ok: false, error: short.slice(0, 300) };
        }
      }
    }
    // 不可达（循环内必 return），类型兜底
    return { file: job.file, ok: false, error: 'unreachable' };
  }

  const results: AssetJobResult[] = new Array(orders.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < orders.length) {
      const i = next++;
      results[i] = await generateOne(orders[i]).catch((e) => ({
        file: orders[i]!.file,
        ok: false,
        error: String((e as Error).message ?? e),
      }));
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, orders.length) }, () => worker()),
  );
  return results;
}
