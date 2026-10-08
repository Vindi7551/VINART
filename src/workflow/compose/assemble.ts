/**
 * ═══════════════════════════════════════════════════════════════════════
 * 最终组装 —— 版式 + 素材 → final.html / final.png
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 从 `step-layout.ts` 的 final 段抽出（它原来长在驱动的 main 里）。
 *
 * ## 职责
 *
 *   ① 缺素材检查（缺 → 中止——继续会渲出断图空壳 PNG，体积偏小易误判成功）
 *   ② 文字自适应（实测两遍：量 scrollWidth/clientWidth → 回填系数重渲）
 *   ③ emitHtml 双输出（final.html 自包含快照 / final.linked.html 可编辑源码）
 *   ④ Blink 渲染 → final.png（交付成品）
 *
 * ## 不在这里的
 *
 *   版式渲染器（`design-sketch/render.ts`）· 素材生成（`assetsgen/`）·
 *   草图渲染（`design-sketch/sketch.ts`）——本阶段只**消费**它们的产物。
 *
 * ## 产物分工
 *
 *   final.linked.html = 源码（给人改：改 CSS/文案 → 重跑 final，零模型调用）
 *   final.html        = 快照（图内联 data URL，单文件可分享）
 *   final.png         = 成品（Blink 渲自包含版，交付上传）
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { DesignSketch } from '../design-sketch/design-sketch';
import type { Palette, Typography } from '../design-sketch/render-style';
import { fitTargets, renderDesign, type FitMap } from '../design-sketch/render';
import type { BlinkRenderer } from '../../render/blink-renderer';
import type { AssetOrders } from '../assetsgen/asset-order';
import type { CanvasHost } from '../assetsgen/image';
import { emitHtml, inlineAssets } from './emit-html';

export interface AssembleOptions {
  spec: DesignSketch;
  /** 素材订单——写进溯源注释（这张图用了哪些生成素材） */
  orders: AssetOrders;
  /** 素材与产物的目录（同一目录，linked.html 用相对路径引用素材） */
  outDir: string;
  palette: Palette;
  typography: Typography;
  /** 提供浏览器页（文字自适应的测量在页面里做） */
  host: CanvasHost;
  /** --font 试字体时给文件名带方案名，多个变体并存比较 */
  nameOverride?: string | null;
  /**
   * 可选注入的渲染器（只用到 render）。给了 → 复用调用方的浏览器实例
   * （服务进程/工具链路——渲染走共享渲染器，零额外起停）；
   * 不给 → 内部自起自关（CLI 驱动脚本的历史行为）。
   */
  renderer?: Pick<BlinkRenderer, 'render'>;
}

export interface AssembleResult {
  /** 成品 PNG 绝对路径 */
  png: string;
  /** 自包含快照 HTML 绝对路径 */
  html: string;
  /** 可编辑源码 HTML 绝对路径 */
  linked: string;
}

export async function assembleFinal(opts: AssembleOptions): Promise<AssembleResult> {
  const { spec, orders, outDir, palette, typography, host } = opts;

  console.log('\n[3] 成品');
  const { html, assets } = renderDesign(spec, { mode: 'final', palette, typography });

  // ── 缺素材检查 ──
  // 缺素材时必须**中止**，而不是警告后继续——
  // 继续的话 emitHtml 读不到文件会崩，而且会渲染出一张断图的空壳 PNG，
  // 那种图体积会明显偏小，容易被误当成"渲染成功"。
  // 抛错而不是 process.exit：本函数也被服务进程（聊天工具链路）调用，exit 会带走整个服务。
  const missing = Object.entries(assets).filter(([, f]) => !existsSync(resolve(outDir, f)));
  if (missing.length) {
    throw new Error(
      `缺少素材：${missing.map(([k, f]) => `${k}=${f}`).join(', ')}。` +
        '先跑生图阶段（gen）把素材放进版式目录再重试 final。',
    );
  }

  // ── 文字自适应 ──
  // 字号写死的话，装不下会换行把版式撑破（实测踩过）。
  // 做法：先拿可渲染的完整 HTML 去浏览器里量一遍，算出每处需要缩多少，
  // 再回填系数重新生成。纯 CSS 做不到这件事，必须实测。
  const ids = fitTargets(spec);
  const C = spec.canvas;
  let fits: FitMap = {};
  if (ids.length) {
    // playwright 的 Page 收窄成用到的形态（与 cutout.ts 的 cast 模式一致）
    const measurePage = (await host.newPage()) as unknown as {
      evaluate: <T>(fn: (arg?: unknown) => T, arg?: unknown) => Promise<T>;
      close: () => Promise<void>;
      setViewportSize: (s: { width: number; height: number }) => Promise<void>;
      setContent: (html: string, opts?: { waitUntil?: string }) => Promise<void>;
    };
    // 测量视口必须与画布同尺寸——否则量出的可用宽是错的
    await measurePage.setViewportSize({ width: C.width, height: C.height });
    await measurePage.setContent(inlineAssets(html, assets, outDir), { waitUntil: 'load' });
    // ⚠️ 等字体就绪：woff2 内联是异步的，不等就量 = 量到兜底字体的宽，系数全错
    await measurePage.evaluate(() => document.fonts?.ready);
    fits = await measurePage.evaluate((keys: unknown) => {
      const out: Record<string, number> = {};
      for (const k of keys as string[]) {
        const wrap = document.querySelector(`[data-fit="${k}"]`);
        const inner = wrap?.querySelector('.btfit') as HTMLElement | null;
        if (!inner) continue;
        const avail = inner.clientWidth;
        const need = inner.scrollWidth;
        if (avail > 0 && need > avail) out[k] = avail / need;
      }
      return out;
    }, ids);
    await measurePage.close();

    const entries = Object.entries(fits);
    if (entries.length) {
      console.log(`    文字自适应：${entries.map(([k, v]) => `${k} ×${v.toFixed(3)}`).join('，')}`);
    } else {
      console.log('    文字自适应：全部装得下，无需缩放');
    }
  }

  // ── 第二遍：回填系数重新生成 ──
  const finalRender = renderDesign(spec, { mode: 'final', fits, palette, typography });
  // --font 试字体时给文件名带方案名，多个变体可以并存比较
  const finalName = opts.nameOverride ? `final-${opts.nameOverride}` : 'final';
  const emitted = emitHtml({
    template: finalRender.html,
    assets: finalRender.assets,
    assetDir: outDir,
    outDir,
    name: finalName,
    meta: finalMeta(spec, orders, fits, typography),
  });

  // ── 渲成品 PNG ──
  // 注入了 renderer → 复用（服务进程共享渲染器，零起停）；
  // 没注入 → 自起自关（CLI 驱动脚本的历史行为）。
  const { createBlinkRenderer } = await import('../../render/blink-renderer');
  const r = opts.renderer ?? createBlinkRenderer({ deviceScaleFactor: 1 });
  let pngPath = '';
  try {
    // ⚠️ 必须渲 selfContainedHtml（占位符已替换成真素材）——
    // 拿含 {{占位符}} 的模板渲是断图的空壳。
    const out = await r.render({ html: emitted.selfContainedHtml }, outDir, {
      width: C.width, height: C.height, format: 'png', filename: finalName,
    });
    pngPath = out.imagePath;
    const buf = readFileSync(out.imagePath);
    console.log(`    PNG  → ${finalName}.png  ${buf.readUInt32BE(16)}×${buf.readUInt32BE(20)}  ${(buf.length / 1024).toFixed(0)} KB`);
    // 体积异常检查：素材缺失时 PNG 会明显偏小，这是最便宜的异常信号。
    // （纯文字版式没有图，体积本来就小，不适用此检查。）
    const hasImages = spec.layers.some((l) => l.type === 'image');
    if (hasImages && buf.length / 1024 < 200) {
      console.log(`    ⚠️ 成品体积异常偏小（${(buf.length / 1024).toFixed(0)} KB）——检查素材是否缺失或占位符未替换`);
    }
  } finally {
    // 只在内部自建的实例上 dispose——注入的渲染器归调用方管
    if (!opts.renderer) await (r as Awaited<ReturnType<typeof createBlinkRenderer>>).dispose();
  }
  console.log(`    HTML → ${finalName}.html（${(emitted.selfContainedBytes / 1024).toFixed(0)} KB 自包含）`);
  console.log(`           ${finalName}.linked.html（${(emitted.linkedBytes / 1024).toFixed(0)} KB 可编辑）`);

  return { png: pngPath, html: emitted.selfContained, linked: emitted.linked };
}

// ── 溯源注释 ──

function finalMeta(spec: DesignSketch, orders: AssetOrders, fits: FitMap, typ: Typography): Record<string, string> {
  const gen = orders.map((a) => a.file).join(', ') || '（无，素材已就绪）';
  const fitNote = Object.keys(fits).length
    ? `文字自适应系数 ${Object.entries(fits).map(([k, v]) => `${k}×${v.toFixed(3)}`).join('，')}`
    : '文字自适应：无需缩放';
  return {
    产物: '成品图 — 版式源文件',
    标题: spec.title ?? spec.name,
    画布: `${spec.canvas.width}×${spec.canvas.height} @1x`,
    生成素材: gen,
    图层结构: spec.layers.map((l) => `${l.id}(${l.type})`).join(' → '),
    文字层: '全部由 HTML+CSS 渲染，不经生成模型——避免德文变音符号出错',
    排版方案: `${typ.schemeName}（标题 ${typ.headingFamily.replace(/'/g, '').split(',')[0]} ${typ.headingWeight} / 正文 ${typ.bodyFamily.replace(/'/g, '').split(',')[0]} ${typ.bodyWeight}）`,
    字体: typ.faceCss ? '已内联 woff2（data URL）——换机器不会变样' : '⚠️ 使用系统字体，换机器会变样',
    文字自适应: fitNote,
    改版式: '改下面的 <style> 里的 CSS，重跑 final 阶段即可，不需调用大模型',
  };
}
