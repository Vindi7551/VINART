/**
 * Blink 渲染器
 *
 * 通过 headless Chromium（Playwright）将 HTML 渲染为高分辨率成品图。
 * 仅 Node.js 环境可用。浏览器环境应使用 iframe preview。
 */

import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ══════════════════════════════════════════
// 类型
// ══════════════════════════════════════════

export interface RenderConfig {
  width: number;
  height: number;
  /**
   * 输出缩放。**与本实例当前档位不同时会重启浏览器换档**（persistent
   * context 的 dsf 是 context 级的），连续同档渲染零开销。
   * 不传则用 createBlinkRenderer 时给的默认值。
   */
  deviceScaleFactor?: number;
  format?: 'png' | 'jpeg';
  quality?: number;
  fullPage?: boolean;
  /** 输出文件名（不含扩展名）。不传则用 render-<时间戳> */
  filename?: string;
  /**
   * 页面就绪判定。默认 `'load'`。
   *
   * ⚠️ 不要改回 `'networkidle'`。实测（同一份自包含 HTML，各 5 次取中位）：
   *   load 119ms / domcontentloaded 123ms / **networkidle 623ms**
   * 我们的 HTML 图片全是 data URL、字体是系统字体，**没有任何网络请求可等**，
   * networkidle 只是在等一个不会发生的事件，白等约 500ms。
   * （另：Puppeteer 已明确不再支持 setContent 用 networkidle，默认也改成了 load。）
   * 渲染外部网页时才需要改这里。
   */
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit';
  /**
   * **只截某个元素**，而不是整个视口。传 CSS 选择器，取第一个匹配元素。
   *
   * 用途：把某一块单独出图（例如底部徽章条单独导成一个素材）。
   * 与 `fullPage` 互斥；元素截图时返回的 width/height 是**元素的实测尺寸**，
   * 不是视口尺寸。
   */
  selector?: string;
  /**
   * **透明背景**（仅 PNG）。
   *
   * ⚠️ **底色归文档，不归这里。** 画布底色是 `DesignDocument.canvas.background`
   *    （**省略 = 白底**，要透明得在文档里显式写 `'transparent'`）。
   *    这个开关只是"**文档没铺底色时**"的兜底，**默认 `false` ⇒ 出图是白底**。
   *
   * 实现两层：
   * 1. 截图时 `omitBackground: true`（去掉浏览器默认的白色底）
   * 2. 注入 `html,body{background:transparent}` 覆盖根元素背景
   *
   * ⚠️ 但**内层容器自己设的背景色不会被清掉**。所以要做透明素材，
   * HTML 里就别给内容层上背景色（例如 `.canvas` 不要 background）。
   * 这是刻意的：如果无差别清掉所有背景，设计本身就毁了。
   *
   * `format: 'jpeg'` 不支持 alpha，会被忽略并给出警告。
   */
  transparent?: boolean;
  /**
   * 注入额外的 CSS（在页面加载后、截图前）。
   *
   * 用途之一是**图层隔离**：拆层时先 `* { visibility: hidden }` 再只显示目标层，
   * 否则 `selector` 截到的是"元素所在的那片画面"，会连同上下其它层一起截进来
   * （实测踩过：`.inset` 与 `.inset-edge` 两个完全不同的元素，截出来逐字节相同）。
   *
   * 用 `visibility` 而不是 `display`：前者保留布局，不会引起重排位移。
   */
  injectCss?: string;
}

export interface RenderInput {
  html: string;
  isFilePath?: boolean;
}

export interface RenderOutput {
  imagePath: string;
  width: number;
  height: number;
  size: number;
}

export interface BlinkRendererOptions {
  /**
   * 默认输出缩放（截图像素 = CSS 像素 × 此值）。
   * 单次 render 仍可用 config.deviceScaleFactor 临时换档
   * （换档 = 重启浏览器，persistent context 的 dsf 是 context 级的）。
   */
  deviceScaleFactor?: number;
}

export interface BlinkRenderer {
  render(input: RenderInput, outputDir: string, config: RenderConfig): Promise<RenderOutput>;
  /**
   * 开一个裸页——结构与 CanvasHost 兼容（assembleFinal 的文字自适应测量用）。
   * 复用当前 context：调用方 close 页即可，浏览器实例不动。
   * dsf 取 1 档——测量页量的是 CSS 像素，与输出缩放无关。
   */
  newPage(): Promise<{
    evaluate: <T>(fn: (arg: unknown) => T, arg?: unknown) => Promise<T>;
    close(): Promise<void>;
    setViewportSize: (size: { width: number; height: number }) => Promise<void>;
  }>;
  /** 关闭浏览器并等待退出。自管 userDataDir 后实测 ~1.5s（原临时 profile 时 5.9s） */
  dispose(): Promise<void>;
}

// ══════════════════════════════════════════
// 工厂
// ══════════════════════════════════════════

/**
 * 启动浏览器（persistent context），带**自动回退**。
 *
 * Playwright ≥ 1.49 起，默认使用精简的 `chrome-headless-shell` 二进制。
 * 若本机只装了完整 Chromium 而缺 headless shell，默认启动会直接抛
 * "Executable doesn't exist at ...chrome-headless-shell.exe"。
 * 所以先试默认路径，失败则显式回退到 `channel: 'chromium'`（完整 Chromium）。
 * 两条路径都能出图，渲染结果一致——headless shell 只是更小更快。
 * 想用默认路径的话，执行：npx playwright install chromium-headless-shell
 *
 * ── 为什么是 launchPersistentContext + 自管 userDataDir ──
 * 实测（2026-10-07）：chromium.launch() 的 close 总耗时 5.9s 里，chromium
 * 自身退出只占 1.4s，剩下 4.5s 全是 playwright 在删它的临时 profile 目录
 * （`playwright_chromiumdev_profile-*`，Windows Defender 对刚关闭的文件
 * 实时扫描导致 rmSync 反复重试）。传自管 userDataDir 时 playwright 不删
 * 它（runtime 校验要求必须走 launchPersistentContext），close 降到 ~1.5s。
 * 代价与对策：
 *  - profile 目录会遗留 → 下一次创建时异步清扫（sweepStaleProfiles）；
 *  - deviceScaleFactor 变成 context 级 → 挪到实例选项（见 BlinkRendererOptions）；
 *  - 所有 render 共用一个 context → localStorage/cookie 跨渲染留存
 *    （我们的 HTML 是自包含 data URL 产物，不用存储，无影响）；
 *    并发渲染 = 同 context 多 page，天然安全。
 */
const PROFILE_ROOT = join(tmpdir(), 'vinart-chromium-profile');
let profileSwept = false;

async function sweepStaleProfiles(): Promise<void> {
  if (profileSwept) return;
  profileSwept = true;
  try {
    const { readdir, stat, rm } = await import('node:fs/promises');
    for (const d of await readdir(PROFILE_ROOT)) {
      const p = join(PROFILE_ROOT, d);
      // 正在使用的目录 mtime 新鲜（chromium 在写）；只清 1 小时前的遗留。
      // 本模块的浏览器实例受 5 分钟空闲回收约束，活不过 1 小时，不会误删。
      const st = await stat(p).catch(() => null);
      if (st && Date.now() - st.mtimeMs > 3_600_000) {
        await rm(p, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(() => {});
      }
    }
  } catch {
    /* 扫不动就算了，只是攒几个临时目录 */
  }
}

async function launchPersistentProfile(deviceScaleFactor: number) {
  const { chromium } = await import('playwright');
  const { mkdirSync } = await import('node:fs');
  const { randomBytes } = await import('node:crypto');

  mkdirSync(PROFILE_ROOT, { recursive: true });
  void sweepStaleProfiles();
  const userDataDir = join(PROFILE_ROOT, `p-${Date.now()}-${randomBytes(4).toString('hex')}`);

  const opts = {
    headless: true,
    deviceScaleFactor,
    // 占位视口（persistent 的 dsf 不允许配 null viewport）；每次 render 仍会
    // page.setViewportSize 覆盖成 config 的宽高
    viewport: { width: 1280, height: 720 },
    colorScheme: 'light' as const,
  };

  try {
    return await chromium.launchPersistentContext(userDataDir, opts);
  } catch (defaultErr) {
    try {
      const ctx = await chromium.launchPersistentContext(userDataDir, {
        ...opts,
        channel: 'chromium',
      });
      console.warn(
        '[render] 默认 headless shell 不可用，已回退到完整 Chromium（channel=chromium）。' +
          ' 想改用默认路径：npx playwright install chromium-headless-shell',
      );
      return ctx;
    } catch (fallbackErr) {
      // 两条路都失败 → 把两个原因都说清楚，别让人只看到后半截
      throw new Error(
        'Chromium 启动失败，两条路径都不可用。\n' +
          `  1) 默认 headless shell：${(defaultErr as Error).message}\n` +
          `  2) channel=chromium　：${(fallbackErr as Error).message}\n` +
          '  处理：npx playwright install chromium',
      );
    }
  }
}

export function createBlinkRenderer(opts: BlinkRendererOptions = {}): BlinkRenderer {
  const defaultDsf = opts.deviceScaleFactor;
  let context: Awaited<ReturnType<typeof launchPersistentProfile>> | null = null;
  let currentDsf: number | null = null;

  async function ensureContext(dsfWanted: number) {
    if (context && currentDsf === dsfWanted) return context;
    if (context) {
      // 档位变了 → 关掉旧的换档（自管 profile，close ~1.5s）
      const old = context;
      context = null;
      currentDsf = null;
      await old.close().catch(() => {});
    }
    context = await launchPersistentProfile(dsfWanted);
    currentDsf = dsfWanted;
    // 浏览器自己退出（崩溃等）时把句柄放掉，下次 render 重新启动
    context.once('close', () => {
      if (context !== null) context = null;
    });
    return context;
  }

  return {
    async newPage() {
      const ctx = await ensureContext(1);
      return ctx.newPage();
    },

    async render(input, outputDir, config): Promise<RenderOutput> {
      const { mkdirSync, statSync } = await import('fs');
      const { join } = await import('path');

      const {
        width,
        height,
        format = 'png',
        quality = 95,
        fullPage = false,
        filename: nameHint,
        waitUntil = 'load',
        selector,
        transparent = false,
        injectCss,
      } = config;

      if (transparent && format !== 'png') {
        console.warn(`[render] ⚠️ transparent 只对 PNG 有效，当前 format=${format}，将忽略`);
      }
      const wantAlpha = transparent && format === 'png';
      const dsf = config.deviceScaleFactor ?? defaultDsf ?? 2;

      const ctx = await ensureContext(dsf);
      const page = await ctx.newPage();
      await page.setViewportSize({ width, height });

      try {
        if (input.isFilePath) {
          const fileUrl = `file:///${input.html.replace(/\\/g, '/')}`;
          await page.goto(fileUrl, { waitUntil });
        } else {
          await page.setContent(input.html, { waitUntil });
        }

        await page.evaluate(() => document.fonts?.ready);

        // ── 注入额外 CSS（图层隔离等）──
        if (injectCss) {
          await page.addStyleTag({ content: injectCss });
          // 改动样式后要等一帧，否则可能截到旧画面
          await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
        }

        // ── 透明背景：先覆盖根元素背景 ──
        // 注意这**只管 html/body**。内层容器自己设的背景色不会被清掉——
        // 无差别清掉所有背景会把设计本身也毁掉。要做透明素材，HTML 里
        // 就别给内容层上背景色（例如 .canvas 不要 background）。
        if (wantAlpha) {
          await page.addStyleTag({
            content: 'html,body{background:transparent !important;background-color:transparent !important}',
          });
        }

        // ── 溢出检测 ──
        // 视口是固定尺寸，fullPage=false 时超出的内容会被**静默裁掉**，
        // 让人拿到一张悄悄缺了一块的图还以为是对的。这里主动量一次并报警。
        // 元素截图时视口尺寸无关紧要，改为检查该元素自身是否溢出。
        if (!fullPage) {
          if (selector) {
            const box = await page.evaluate((sel: string) => {
              const el = document.querySelector(sel) as HTMLElement | null;
              if (!el) return null;
              return { sw: el.scrollWidth, sh: el.scrollHeight, cw: el.clientWidth, ch: el.clientHeight };
            }, selector);
            if (!box) {
              console.warn(`[render] ⚠️ 选择器没有匹配到元素：${selector}`);
            } else if (box.sw - box.cw > 1 || box.sh - box.ch > 1) {
              console.warn(
                `[render] ⚠️ 元素 ${selector} 内容溢出，将被裁切：` +
                  `内容 ${box.sw}×${box.sh}，元素 ${box.cw}×${box.ch}`,
              );
            }
          } else {
            const box = await page.evaluate(() => {
              const d = document.documentElement;
              const bd = document.body;
              return {
                sw: Math.max(d.scrollWidth, bd ? bd.scrollWidth : 0),
                sh: Math.max(d.scrollHeight, bd ? bd.scrollHeight : 0),
                cw: d.clientWidth,
                ch: d.clientHeight,
              };
            });
            const overX = box.sw - box.cw;
            const overY = box.sh - box.ch;
            if (overX > 1 || overY > 1) {
              console.warn(
                `[render] ⚠️ 内容超出视口，将被裁切：内容 ${box.sw}×${box.sh}，视口 ${box.cw}×${box.ch}` +
                  `（超出 ${overX > 0 ? overX : 0}×${overY > 0 ? overY : 0} px）` +
                  '——检查是否漏了 overflow:hidden 或固定尺寸容器',
              );
            }
          }
        }

        mkdirSync(outputDir, { recursive: true });

        const ext = format === 'jpeg' ? 'jpg' : 'png';
        const safeName = nameHint ? nameHint.replace(/[^\w.-]+/g, '_') : `render-${Date.now()}`;
        const imagePath = join(outputDir, `${safeName}.${ext}`);

        // ── 截图：元素 或 视口 ──
        let outW: number;
        let outH: number;

        if (selector) {
          const locator = page.locator(selector).first();
          await locator.waitFor({ state: 'visible', timeout: 10_000 });
          const box = await locator.boundingBox();
          if (!box) throw new Error(`无法取得元素尺寸：${selector}`);

          await locator.screenshot({
            path: imagePath,
            type: format,
            quality: format === 'jpeg' ? quality : undefined,
            omitBackground: wantAlpha,
          });

          outW = Math.round(box.width * dsf);
          outH = Math.round(box.height * dsf);
        } else {
          await page.screenshot({
            path: imagePath,
            type: format,
            quality: format === 'jpeg' ? quality : undefined,
            fullPage,
            omitBackground: wantAlpha,
          });

          outW = Math.round(width * dsf);
          outH = Math.round(height * dsf);
        }

        const stat = statSync(imagePath);

        return {
          imagePath,
          width: outW,
          height: outH,
          size: stat.size,
        };
      } finally {
        // 只关 page，不关 context——context 就是整个浏览器，关了共享就没了
        await page.close().catch(() => {});
      }
    },

    async dispose() {
      if (context) {
        const c = context;
        context = null;
        await c.close();
      }
    },
  };
}
