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
 *   输入  素材订单（`assets.json`）
 *   输出  素材文件（`outDir/<file>`）
 *
 *   中间：提示词拼参考图说明 · 调生图模型（审核失败自动重试）
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, resolve, sep } from 'node:path';

import { BANNED_WORDS, type AssetOrders, type AssetRequest } from './asset-order';

/**
 * 本地文件 → data URL（**原图直传，不压缩**）。
 *
 * ⚠️ mime 必须和真实字节一致——按文件头判断，别按扩展名：
 * 有些文件扩展名和内容对不上（接口会照 mime 解）。
 */
export function fileDataUrl(file: string): string {
  const buf = readFileSync(file);
  const mime =
    buf[0] === 0x89 && buf[1] === 0x50
      ? 'image/png'
      : buf[0] === 0xff && buf[1] === 0xd8
        ? 'image/jpeg'
        : buf[0] === 0x52 && buf[1] === 0x49
          ? 'image/webp'
          : 'application/octet-stream';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

/**
 * 提示词里指代参考图的记号：`[图片1]` / `[图片 1]` / `[Image 1]`。
 *
 * 用方括号而不是 `@` —— 聊天里的 `@` 已经用来指画布元素，
 * 同一个符号两套含义，主 AI 会混。
 */
const REF_MENTION = /\[\s*(?:图片|image)\s*(\d+)\s*\]/gi;

/**
 * 把提示词里的 `[图片N]` 编译成「第 N 张（文件名）」。
 *
 * `indexMap` 是「**原始编号 → 最终编号**」：参考图文件不存在会被丢掉，
 * 后面的编号会前移——提示词里写的是原始编号，必须按这张表换算，
 * 否则 `[图片3]` 会指到错的那张。
 *
 * 指不到的编号**原样保留**（由调用方记 warning），不报错、不删字。
 */
export function compileRefMentions(
  prompt: string,
  refs: string[],
  lang: string,
  indexMap?: Map<number, number>,
): { text: string; mentioned: Set<number>; unknown: number[] } {
  const mentioned = new Set<number>();
  const unknown: number[] = [];
  const text = prompt.replace(REF_MENTION, (whole, digits: string) => {
    const n = Number(digits);
    const final = indexMap ? indexMap.get(n) : n >= 1 && n <= refs.length ? n : undefined;
    if (!final || final < 1 || final > refs.length) {
      unknown.push(n);
      return whole;
    }
    mentioned.add(final - 1);
    const name = basename(refs[final - 1]!);
    return lang === 'zh' ? `第 ${final} 张（${name}）` : `Reference ${final} (${name})`;
  });
  return { text, mentioned, unknown };
}

/**
 * 参考图说明 —— **只负责把「第 N 张 ↔ 文件名」对上**。
 *
 * ⚠️ 这里**不再按 role 自动生成角色长句**：那句
 * "the subject appearance reference (… do not paste …)" 是写给
 * **写提示词的人**的规则，贴在生图 payload 上只会让模型分心
 * （而且是否定句——本项目实测否定词对 seedream 无效）。
 * 哪张图是干什么的，由提示词自己说。
 *
 * `mentioned` 是提示词里已经用 `[图片N]` 指过的（0 基）；这些不再重复进图例。
 * 语言跟随**提示词本身**（含中文就写中文），不再只看 `promptLang` ——
 * 走 `generate_assets` 工具时订单里根本没有 promptLang，以前中文提示词
 * 一直配着英文图例。
 */
export function buildPrompt(
  prompt: string,
  refs: string[],
  lang: string,
  mentioned?: Set<number>,
): string {
  if (!refs.length) return prompt;
  const rest = refs
    .map((r, i) => ({ r, i }))
    .filter(({ i }) => !mentioned?.has(i));
  if (!rest.length) return prompt;
  if (lang === 'zh') {
    const names = rest.map(({ r, i }) => `第 ${i + 1} 张（${basename(r)}）`);
    return `参考图说明：${names.join('、')}。${prompt}`;
  }
  const names = rest.map(({ r, i }) => `Reference ${i + 1} (${basename(r)})`);
  return `REFERENCE IMAGES: ${names.join(', ')}. ${prompt}`;
}

/** 提示词语言：含中文就按中文拼图例，否则用订单声明，兜底 en */
export function promptLanguage(prompt: string, declared?: string): string {
  if (/[\u4e00-\u9fa5]/.test(prompt)) return 'zh';
  return declared ?? 'en';
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
 * 商品图的**保真声明**检查——用了参考图却没有保真表述时 warn。
 *
 * ⚠️ role 删掉后不再有「主体参考图」这个概念，只能按「有参考图」判断：
 * 提示词没写保持/一致类要求时提醒一句（只是 console warn，不拦流程）。
 */
function warnFidelity(prompt: string, file: string): void {
  if (
    /(keep|preserve|maintain|identical|exactly the same|genau|unverändert|original|保持|完全一致|不变)/i.test(
      prompt,
    )
  )
    return;
  console.warn(
    `    ⚠️ ${file} 用了参考图，但 prompt 里没有保真声明——如果它需要外观一致，模型可能擅自改 logo、增删部件（平台「与实物不符」违规）。\n` +
      '       典型句式：keep the shape, lid, label and color exactly the same, do not add extra text or graphics',
  );
}

export interface GenerateAssetsOptions {
  orders: AssetOrders;
  /** 素材输出目录 */
  outDir: string;
  /**
   * 工作目录 —— 参考图除了版式目录，也可以引用工作目录里的文件
   * （用户贴的商品照落在 `<workDir>/uploads/`）。
   */
  workDir: string;
  /** true = 已存在的素材也重新生成 */
  force: boolean;
  /** 用户取消信号（点停止时中断正在进行的请求） */
  signal?: AbortSignal;
  /** 每张素材完成后的进度（聊天链经 ctx.onEvent 上抛） */
  onProgress?: (p: AssetProgress) => void;
}

/** 单张素材完成时的进度 */
export interface AssetProgress {
  file: string;
  /** 1 基序号（按订单顺序） */
  index: number;
  total: number;
  ok: boolean;
  skipped?: boolean;
  error?: string;
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
  /** 被跳过的参考图等提示——回给模型，避免「参考图被悄悄丢掉」 */
  warnings?: string[];
}

/** references 里某一项 → 文件名（容错 LLM 的几种写法） */
function refOf(r: unknown): string {
  if (typeof r === 'string') return r;
  if (r && typeof r === 'object') {
    const o = r as Record<string, unknown>;
    const v = o.ref ?? o.file ?? o.path ?? o.name;
    if (typeof v === 'string') return v;
  }
  return '';
}

/**
 * 移除提示词里含禁词的短语片段（逗号/分号分隔）。
 * 否定式免责语（'no logos, no watermark'）是实测陷阱：负面提及照样触发
 * 内容审核（BANNED_WORDS 是字面匹配，不管否定）。移除即安全——生图模型
 * 不加免责语也不会画水印。
 *
 * 返回被删掉的片段，由 generateOne 记进 warnings——**不再静默改提示词**。
 */
export function stripBannedPhrases(prompt: string): { text: string; removed: string[] } {
  BANNED_WORDS.lastIndex = 0;
  if (!BANNED_WORDS.test(prompt)) return { text: prompt, removed: [] };
  const kept: string[] = [];
  const removed: string[] = [];
  for (const part of prompt.split(/[,;；，]\s*/)) {
    BANNED_WORDS.lastIndex = 0;
    if (BANNED_WORDS.test(part)) removed.push(part.trim());
    else kept.push(part);
  }
  const text = kept
    .join(', ')
    .replace(/\s{2,}/g, ' ')
    .replace(/[,;，]\s*$/, '')
    .trim();
  BANNED_WORDS.lastIndex = 0;
  return { text: text || prompt, removed }; // 全被移除：保留原文让 assertPromptSafe 拦
}

/**
 * orders 归一化（容错 LLM 写出的宽松形态）：
 * 实测主 AI 会写 `{ file: "x.png" }`、`{ type: "sketch" }`——一律压成文件名；
 * 取不到就留空，由 generateOne 跳过并记 warning（不再把 undefined 传给 resolve）。
 *
 * ⚠️ 提示词**不在这里改**：禁词清理挪到 generateOne，才能把删掉的片段记进 warning。
 */
function normalizeOrders(orders: AssetOrders): AssetOrders {
  return orders.map((o) => {
    const refs = (o as { references?: unknown }).references;
    let references: string[] | undefined;
    if (typeof refs === 'string') references = [refs];
    else if (Array.isArray(refs)) references = refs.map(refOf);
    else if (refs && typeof refs === 'object') {
      // 写成单个对象（不是数组）也收——以前会整段被悄悄丢掉
      references = [refOf(refs)];
    }
    return { ...o, ...(references ? { references } : {}), size: o.size ?? '2048x2048' };
  });
}


export async function generateAssets(opts: GenerateAssetsOptions): Promise<AssetJobResult[]> {
  const { outDir, workDir, force } = opts;
  const orders = normalizeOrders(opts.orders);

  if (!orders.length) {
    console.log('\n[2] 规格里没有声明要生成的素材');
    return [];
  }

  // ── 前置检查 ──

  console.log(`\n[2] 生成素材（${orders.length} 张）`);
  const { getImageGateway } = await import('../../config');
  const gateway = getImageGateway();

  const needed = (p: string) => force || !existsSync(p);

  /**
   * 参考图 → 磁盘路径。
   * 先按版式目录找，再按工作目录找（用户贴的商品照落在 `<workDir>/uploads/`）；
   * 只接受工作目录里的文件（商品照就是这样一张普通参考图，不再走专用通道）。
   *
   * ⚠️ 一律先 resolve 成绝对路径再比较——`workDir` 可能是相对路径（探针 / 测试），
   *    直接 startsWith 会把所有参考图都判成"越界"。
   */
  const workRoot = resolve(workDir);
  const workPrefix = workRoot.endsWith(sep) ? workRoot : workRoot + sep;
  const resolveRef = (ref: string): string | null => {
    const candidates = isAbsolute(ref) ? [ref] : [resolve(outDir, ref), resolve(workRoot, ref)];
    for (const p of candidates) {
      if (existsSync(p) && p.startsWith(workPrefix)) return p;
    }
    return null;
  };

  // ── 逐条生成（并发池）──
  // 聊天工具链路一次订单可能是十几张素材：串行 ≈ 15s/张 × N 太慢。
  // 并发池限 3——doubao API 扛得住；更高并发没实测过收益，不赌。
  const CONCURRENCY = 3;
  /** 方舟生图接口的参考图上限——我们不再自设更小的硬限制 */
  const MAX_REFS = 14;

  async function generateOne(job: AssetRequest): Promise<AssetJobResult> {
    if (opts.signal?.aborted) return { file: job.file, ok: false, error: '已取消' };

    const target = resolve(outDir, job.file);
    if (!needed(target)) {
      console.log(`    ${job.file} 已存在，跳过`);
      return { file: job.file, ok: true, skipped: true };
    }

    // ── 参考图：解析文件 → 记下「文件名 ↔ 路径」──
    // 哪张图是干什么的**不在这里判断**——role 已删，提示词自己说。
    // 这里只负责：文件找得到就用，找不到就跳过并记 warning。
    const declared = [...(job.references ?? [])];
    const kept: Array<{ ref: string; path: string; origNo: number }> = [];
    const warnings: string[] = [];

    // ⚠️ 遍历快照并带**原始编号**：下面会把无效的参考图从 declared 里删掉，
    //    编号会前移；提示词里写的是原始编号，编译时要用 origNo 换算。
    const snapshot = [...declared];
    for (let i = 0; i < snapshot.length; i++) {
      const r = snapshot[i]!;
      const ref = typeof r === 'string' ? r.trim() : '';
      if (!ref) {
        warnings.push('参考图项为空，已忽略');
        console.log(`    ⚠️ 参考图项为空，忽略：${JSON.stringify(r)}`);
        declared.splice(declared.indexOf(r), 1);
        continue;
      }
      if (ref.startsWith('@')) {
        warnings.push(`不认识的引用 "${ref}"（商品照请直接写文件名），已忽略`);
        console.log(`    ⚠️ 不认识的引用，忽略：${ref}（商品照请直接写文件名）`);
        declared.splice(declared.indexOf(r), 1);
        continue;
      }
      const p = resolveRef(ref);
      if (!p) {
        warnings.push(`参考图不存在，已忽略：${ref}`);
        console.log(`    ⚠️ 参考图不存在，忽略：${ref}`);
        declared.splice(declared.indexOf(r), 1);
        continue;
      }
      kept.push({ ref, path: p, origNo: i + 1 });
    }

    // 参考图**原图直传**（2026-10-21 起不压缩）：
    //   · 以前压成 JPEG：白底 flatten 会丢 alpha，还会糊掉小字；
    //   · 现在直接读原字节，mime 按文件头判断。
    // 代价是请求体变大——下面按 base64 总长度提示，不硬拦。
    const refs: string[] = [];
    let refChars = 0;
    for (const k of kept) {
      const url = fileDataUrl(k.path);
      refChars += url.length;
      refs.push(url);
    }
    if (refChars > 120_000_000) {
      const msg = `参考图 base64 合计 ${(refChars / 1_000_000).toFixed(1)}MB，接近 128MiB 请求体上限（实测 134MB 通过、135MB 返回 413），可能被 API 拒绝`;
      console.log(`    ⚠️ ${job.file} ${msg}`);
      warnings.push(msg);
    }

    // 参考图数量**不设硬上限**（方舟最多 14 张）。超过 2 张只提示、不让整张单失败——
    // 图越多模型越容易分不清主次，但那是提示词该处理的事，不是硬约束。
    if (refs.length > 2) {
      const msg =
        refs.length > MAX_REFS
          ? `参考图 ${refs.length} 张，超过方舟上限 ${MAX_REFS} 张，可能被 API 拒绝`
          : `用了 ${refs.length} 张参考图，模型可能分不清主次`;
      console.log(`    ⚠️ ${job.file} ${msg}`);
      warnings.push(msg);
    }

    if (kept.length) warnFidelity(job.prompt, job.file);

    // 禁词片段清理：删了什么要记进 warnings（不再静默改提示词）
    const { text: safePrompt, removed } = stripBannedPhrases(job.prompt);
    if (removed.length) {
      warnings.push(`提示词里删掉了含审核禁词的片段：${removed.join(' / ')}`);
    }
    const lang = promptLanguage(safePrompt, job.promptLang);
    // 原始编号 → 最终编号（参考图被丢掉时后面的会前移）
    const indexMap = new Map(kept.map((k, i) => [k.origNo, i + 1]));
    const { text: body, mentioned, unknown } = compileRefMentions(
      safePrompt,
      kept.map((k) => k.ref),
      lang,
      indexMap,
    );
    if (unknown.length) {
      const list = [...new Set(unknown)].map((n) => `[图片${n}]`).join('、');
      warnings.push(`提示词里的参考图编号不存在，已保留原文：${list}`);
      console.log(`    ⚠️ 参考图编号不存在：${list}`);
    }
    const prompt = buildPrompt(body, kept.map((k) => k.ref), lang, mentioned);
    assertPromptSafe(safePrompt, job.file);
    warnPromptStyle(prompt, job.file);

    console.log(`\n    ── ${job.file} ──`);
    console.log(`       参考图 ${refs.length} 张：${kept.map((k) => k.ref).join(', ') || '无'}`);
    console.log(`       提示词 ${prompt.length} 字符（其中图例 ${prompt.length - body.length} 字符）`);

    const size = job.size ?? '2048x2048';

    // 生图失败要重试：实测内容审核是**概率性**的——
    // 同一个提示词带 size 时成功、去掉 size 时被
    // InputTextSensitiveContentDetected 拦截。这种抖动只能靠重试兜。
    const MAX_ATTEMPTS = 3;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (opts.signal?.aborted) {
        return { file: job.file, ok: false, error: '已取消', ...(warnings.length ? { warnings } : {}) };
      }
      const t0 = Date.now();
      try {
        const r = await gateway.generate({
          prompt,
          referenceImages: refs,
          size,
          count: 1,
          format: 'png',
          signal: opts.signal,
        });
        const img = r.images[0];
        if (!img) throw new Error('未返回图片');

        const res = await fetch(img.url, { signal: opts.signal });
        if (!res.ok) throw new Error(`下载 HTTP ${res.status}`);

        const buf = Buffer.from(await res.arrayBuffer());
        // ⚠️ 只认 PNG：output_format 有可能被忽略（返回 JPEG），
        //    按 PNG 头读宽高会得到乱码，还会把 JPEG 存成 .png。
        if (!(buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)) {
          return {
            file: job.file,
            ok: false,
            error: `接口返回的不是 PNG（前 4 字节 ${buf.subarray(0, 4).toString('hex')}）`,
            ...(warnings.length ? { warnings } : {}),
          };
        }
        writeFileSync(target, buf);
        console.log(
          `       ✓ ${job.file}  ${buf.readUInt32BE(16)}×${buf.readUInt32BE(20)}  ` +
            `${(buf.length / 1024).toFixed(0)} KB  ${((Date.now() - t0) / 1000).toFixed(0)}s` +
            (attempt > 1 ? `（第 ${attempt} 次尝试）` : ''),
        );
        return {
          file: job.file,
          ok: true,
          bytes: buf.length,
          ...(warnings.length ? { warnings } : {}),
        };
      } catch (e) {
        if (opts.signal?.aborted) {
          console.log(`       ✗ ${job.file} 已取消`);
          return { file: job.file, ok: false, error: '已取消', ...(warnings.length ? { warnings } : {}) };
        }
        const msg = (e as Error).message;
        const short = msg.split('\n').filter(Boolean).slice(-1)[0] ?? msg;
        if (attempt < MAX_ATTEMPTS) {
          console.log(`       ↻ ${job.file} 第 ${attempt} 次失败：${short.slice(0, 160)}`);
          console.log(`         重试…`);
          await new Promise((r) => setTimeout(r, 1500 * attempt));
        } else {
          console.log(`       ✗ ${job.file} 连续 ${MAX_ATTEMPTS} 次失败：${short.slice(0, 300)}`);
          return {
            file: job.file,
            ok: false,
            error: short.slice(0, 300),
            ...(warnings.length ? { warnings } : {}),
          };
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
      if (opts.signal?.aborted) return;
      const i = next++;
      results[i] = await generateOne(orders[i]).catch((e) => ({
        file: orders[i]!.file,
        ok: false,
        error: String((e as Error).message ?? e),
      }));
      const r = results[i]!;
      opts.onProgress?.({
        file: r.file,
        index: i + 1,
        total: orders.length,
        ok: r.ok,
        ...(r.skipped ? { skipped: true } : {}),
        ...(r.error ? { error: r.error } : {}),
      });
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, orders.length) }, () => worker()),
  );
  // 取消时未开始的任务是空洞——过滤掉，别让 JSON 里出现 null
  return results.filter((r): r is AssetJobResult => Boolean(r));
}
