/**
 * Blink 渲染器
 *
 * 通过 headless Chromium（Playwright）将 HTML 渲染为高分辨率成品图。
 * 仅 Node.js 环境可用。浏览器环境应使用 iframe preview。
 */

// ══════════════════════════════════════════
// 类型
// ══════════════════════════════════════════

export interface RenderConfig {
  width: number;
  height: number;
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

export interface BlinkRenderer {
  render(input: RenderInput, outputDir: string, config: RenderConfig): Promise<RenderOutput>;
  dispose(): Promise<void>;
}

// ══════════════════════════════════════════
// 工厂
// ══════════════════════════════════════════

/**
 * 启动浏览器，带**自动回退**。
 *
 * Playwright ≥ 1.49 起，`chromium.launch({ headless: true })` 默认使用精简的
 * `chrome-headless-shell` 二进制。若本机只装了完整 Chromium 而缺 headless shell，
 * 默认启动会直接抛 "Executable doesn't exist at ...chrome-headless-shell.exe"。
 * （本机实测正是这种情况：只有 chromium-1228。）
 *
 * 所以这里先试默认路径，失败则显式回退到 `channel: 'chromium'`（完整 Chromium）。
 * 两条路径都能出图，渲染结果一致——headless shell 只是更小更快。
 *
 * 想用默认路径的话，执行：npx playwright install chromium-headless-shell
 */
async function launchBrowser() {
  const { chromium } = await import('playwright');

  try {
    return await chromium.launch({ headless: true });
  } catch (defaultErr) {
    try {
      const b = await chromium.launch({ headless: true, channel: 'chromium' });
      console.warn(
        '[render] 默认 headless shell 不可用，已回退到完整 Chromium（channel=chromium）。' +
          ' 想改用默认路径：npx playwright install chromium-headless-shell',
      );
      return b;
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

export function createBlinkRenderer(): BlinkRenderer {
  let browser: Awaited<ReturnType<typeof launchBrowser>> | null = null;

  async function getBrowser() {
    if (!browser || !browser.isConnected()) {
      browser = await launchBrowser();
    }
    return browser;
  }

  return {
    async render(input, outputDir, config): Promise<RenderOutput> {
      const { mkdirSync, statSync } = await import('fs');
      const { join } = await import('path');

      const {
        width,
        height,
        deviceScaleFactor = 2,
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

      const b = await getBrowser();
      const context = await b.newContext({
        viewport: { width, height },
        deviceScaleFactor,
        // 透明时也要让 context 本身无底色
        ...(wantAlpha ? { colorScheme: 'light' as const } : {}),
      });
      const page = await context.newPage();

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

          outW = Math.round(box.width * deviceScaleFactor);
          outH = Math.round(box.height * deviceScaleFactor);
        } else {
          await page.screenshot({
            path: imagePath,
            type: format,
            quality: format === 'jpeg' ? quality : undefined,
            fullPage,
            omitBackground: wantAlpha,
          });

          outW = Math.round(width * deviceScaleFactor);
          outH = Math.round(height * deviceScaleFactor);
        }

        const stat = statSync(imagePath);

        return {
          imagePath,
          width: outW,
          height: outH,
          size: stat.size,
        };
      } finally {
        await context.close();
      }
    },

    async dispose() {
      if (browser) {
        await browser.close();
        browser = null;
      }
    },
  };
}
