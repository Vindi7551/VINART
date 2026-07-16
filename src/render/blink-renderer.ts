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

export function createBlinkRenderer(): BlinkRenderer {
  let browser: Awaited<ReturnType<typeof import('playwright')['chromium']['launch']>> | null = null;

  async function getBrowser() {
    if (!browser || !browser.isConnected()) {
      const { chromium } = await import('playwright');
      browser = await chromium.launch({ headless: true });
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
      } = config;

      const b = await getBrowser();
      const context = await b.newContext({
        viewport: { width, height },
        deviceScaleFactor,
      });
      const page = await context.newPage();

      try {
        if (input.isFilePath) {
          const fileUrl = `file:///${input.html.replace(/\\/g, '/')}`;
          await page.goto(fileUrl, { waitUntil: 'networkidle' });
        } else {
          await page.setContent(input.html, { waitUntil: 'networkidle' });
        }

        await page.evaluate(() => document.fonts?.ready);

        mkdirSync(outputDir, { recursive: true });

        const ext = format === 'jpeg' ? 'jpg' : 'png';
        const filename = `render-${Date.now()}.${ext}`;
        const imagePath = join(outputDir, filename);

        await page.screenshot({
          path: imagePath,
          type: format,
          quality: format === 'jpeg' ? quality : undefined,
          fullPage,
        });

        const stat = statSync(imagePath);

        return {
          imagePath,
          width: Math.round(width * deviceScaleFactor),
          height: fullPage ? 0 : Math.round(height * deviceScaleFactor),
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
