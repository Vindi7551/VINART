/**
 * 可行性验证：HTML → 按层拆分 → canvas 合并还原
 *
 * 目的：在第二阶段真正动手前，先把「拆层 + 合并」这条链路验一遍。
 * 如果现在就有问题，比等做完整个设计引擎再发现便宜得多。
 *
 * 做法：
 *   1. 把 G03 成品 HTML 的 `.canvas` 直接子节点**逐个单独截屏**（透明背景）
 *      —— 用 `RenderConfig.selector` + `transparent`
 *   2. 记录每个节点的 boundingBox（x/y/w/h）—— 这就是"几何清单"
 *   3. 把 N 张层图按几何清单用 canvas 合并回一张
 *   4. **和原始成品图逐像素对比**，算平均色差
 *
 * 注意：这一轮不做"合理的图层分组"（`.rule` + `.hl` + `.rule` 本该合并成"标题组"），
 * 就老实按 DOM 直接子节点拆，看最坏情况下能不能还原。
 * 图层分组是视图层的事，与"能不能还原"是两件事，先验后者。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const G03 = resolve('test_product/g03');
const HTML_LINKED = resolve(G03, 'final.linked.html');
const ORIGINAL = resolve(G03, 'final.png');
const OUT = resolve('test_product/layer-probe');
const W = 2000;
const H = 2000;

interface LayerRecord {
  index: number;
  tag: string;
  cls: string;
  x: number;
  y: number;
  w: number;
  h: number;
  file: string;
}

async function main() {
  console.log('\n' + '═'.repeat(70));
  console.log('可行性验证：HTML → 按层拆分 → canvas 合并还原');
  console.log('═'.repeat(70));

  for (const [p, label] of [[HTML_LINKED, 'HTML'], [ORIGINAL, '原始成品图']] as const) {
    if (!existsSync(p)) {
      console.error(`\n✗ 找不到${label}：${p}`);
      process.exit(1);
    }
  }
  mkdirSync(OUT, { recursive: true });

  const { createBlinkRenderer } = await import('../src/render/blink-renderer');
  const renderer = createBlinkRenderer();

  try {
    // ── 1. 列出 .canvas 的直接子节点 ──
    const { chromium } = await import('playwright');
    let browser: Awaited<ReturnType<typeof chromium.launch>>;
    try {
      browser = await chromium.launch({ headless: true });
    } catch {
      browser = await chromium.launch({ headless: true, channel: 'chromium' });
    }

    const page = await browser.newPage();
    await page.setViewportSize({ width: W, height: H });
    await page.goto(`file:///${HTML_LINKED.replace(/\\/g, '/')}`, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts?.ready);

    const nodes = await page.evaluate(() => {
      const c = document.querySelector('.canvas');
      if (!c) return [];
      return [...c.children].map((el, i) => {
        const r = el.getBoundingClientRect();
        return {
          index: i,
          tag: el.tagName.toLowerCase(),
          cls: el.getAttribute('class') ?? '',
          x: r.x,
          y: r.y,
          w: r.width,
          h: r.height,
        };
      });
    });
    await page.close();
    await browser.close();

    console.log(`\n[1] DOM 直接子节点：${nodes.length} 个\n`);
    console.log('      #  元素                              位置/尺寸');
    for (const n of nodes) {
      console.log(
        `     ${String(n.index).padStart(2)}  ${(n.tag + ' .' + n.cls).padEnd(34)}` +
          ` x=${n.x.toFixed(0).padStart(4)} y=${n.y.toFixed(0).padStart(4)} ` +
          `w=${n.w.toFixed(0).padStart(4)} h=${n.h.toFixed(0).padStart(4)}`,
      );
    }

    // ── 2. 逐层截屏（透明背景）──
    console.log(`\n[2] 逐层截屏（transparent）`);
    const records: LayerRecord[] = [];
    for (const n of nodes) {
      const file = `layer-${String(n.index).padStart(2, '0')}.png`;
      // ★ 关键：必须先隐藏其它层，否则 selector 截到的是"那片画面"而不是这一层
      const r = await renderer.render({ html: HTML_LINKED, isFilePath: true }, OUT, {
        width: W, height: H, deviceScaleFactor: 1, format: 'png',
        filename: file.replace('.png', ''),
        selector: `.canvas > *:nth-child(${n.index + 1})`,
        transparent: true,
        injectCss:
          // ① 中性化**所有祖先的背景** —— 否则空出来的地方会被画布底色填满，
          //    每张层图都变成不透明（实测：colorType=2 无 alpha），
          //    `.inset` 会变成一整块深色矩形，合并时糊掉底下的场景。
          `html,body,.canvas{background:transparent !important}` +
          // ② 隐藏其它层，只留目标层
          `.canvas > *{visibility:hidden !important}` +
          `.canvas > *:nth-child(${n.index + 1}){visibility:visible !important}`,
      });
      const buf = readFileSync(r.imagePath);
      records.push({
        index: n.index, tag: n.tag, cls: n.cls,
        x: Math.round(n.x), y: Math.round(n.y),
        w: r.width, h: r.height, file: r.imagePath,
      });
      process.stdout.write(
        `     ${String(n.index).padStart(2)}  ${(n.tag + ' .' + n.cls).padEnd(30)} ` +
          `${String(buf.readUInt32BE(16)).padStart(4)}×${String(buf.readUInt32BE(20)).padStart(4)}  ` +
          `${(buf.length / 1024).toFixed(1)} KB\n`,
      );
    }

    // 几何清单落盘——拆与合共用这一份
    writeFileSync(resolve(OUT, 'layers.json'), JSON.stringify(records, null, 2), 'utf8');
    console.log(`\n     几何清单 → layers.json（${records.length} 层）`);

    // ── 3. canvas 合并 ──
    console.log(`\n[3] canvas 合并（按几何清单顺序 drawImage）`);
    const b64 = Object.fromEntries(
      records.map((r) => [r.index, readFileSync(r.file).toString('base64')]),
    );
    const originalB64 = readFileSync(ORIGINAL).toString('base64');

    const mergePage = await (async () => {
      const { chromium: c2 } = await import('playwright');
      let b: Awaited<ReturnType<typeof c2.launch>>;
      try {
        b = await c2.launch({ headless: true });
      } catch {
        b = await c2.launch({ headless: true, channel: 'chromium' });
      }
      return { browser: b, page: await b.newPage() };
    })();
    await mergePage.page.setViewportSize({ width: W, height: H });
    await mergePage.page.setContent('<html><body></body></html>');

    const merged = await mergePage.page.evaluate(
      async (a: { layers: LayerRecord[]; data: Record<string, string>; W: number; H: number }) => {
        const load = (src: string) =>
          new Promise<HTMLImageElement>((res, rej) => {
            const im = new Image();
            im.onload = () => res(im);
            im.onerror = rej;
            im.src = 'data:image/png;base64,' + src;
          });

        const c = document.createElement('canvas');
        c.width = a.W;
        c.height = a.H;
        const ctx = c.getContext('2d')!;
        ctx.clearRect(0, 0, a.W, a.H);

        for (const layer of a.layers) {
          const img = await load(a.data[String(layer.index)]);
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'source-over';
          ctx.drawImage(img, layer.x, layer.y, layer.w, layer.h);
        }
        return c.toDataURL('image/png');
      },
      { layers: records, data: b64, W, H },
    );

    const mergedBuf = Buffer.from(merged.split(',')[1], 'base64');
    const mergedPath = resolve(OUT, 'merged.png');
    writeFileSync(mergedPath, mergedBuf);
    console.log(`     合并结果 → ${mergedPath}  ${(mergedBuf.length / 1024).toFixed(0)} KB`);

    // ── 4. 与原图逐像素对比 ──
    console.log(`\n[4] 与原始成品图逐像素对比`);
    const diff2 = await mergePage.page.evaluate(
      async (a: { merged: string; original: string }) => {
        const load = (src: string) =>
          new Promise<HTMLImageElement>((res, rej) => {
            const im = new Image();
            im.onload = () => res(im);
            im.onerror = rej;
            im.src = 'data:image/png;base64,' + src;
          });
        const [ia, ib] = await Promise.all([load(a.merged), load(a.original)]);
        const cv = document.createElement('canvas');
        cv.width = ia.naturalWidth;
        cv.height = ia.naturalHeight;
        const ctx = cv.getContext('2d')!;
        ctx.drawImage(ia, 0, 0);
        const da = ctx.getImageData(0, 0, cv.width, cv.height).data;
        ctx.clearRect(0, 0, cv.width, cv.height);
        ctx.drawImage(ib, 0, 0);
        const db = ctx.getImageData(0, 0, cv.width, cv.height).data;

        let sum = 0, maxD = 0, over2 = 0, over10 = 0;
        const n = da.length / 4;
        for (let i = 0; i < da.length; i += 4) {
          const d = (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2])) / 3;
          sum += d;
          if (d > maxD) maxD = d;
          if (d > 2) over2++;
          if (d > 10) over10++;
        }
        return {
          mean: sum / n, max: maxD,
          over2: over2 / n, over10: over10 / n,
          size: `${cv.width}×${cv.height}`,
        };
      },
      { merged: merged.split(',')[1], original: originalB64 },
    );

    if (diff2) {
      console.log(`     尺寸        ${diff2.size}`);
      console.log(`     平均色差    ${diff2.mean.toFixed(3)} / 255`);
      console.log(`     最大色差    ${diff2.max.toFixed(1)} / 255`);
      console.log(`     色差>2 占比 ${(diff2.over2 * 100).toFixed(2)}%`);
      console.log(`     色差>10占比 ${(diff2.over10 * 100).toFixed(2)}%`);
      console.log(
        `\n     判定：${diff2.mean < 1 ? '✓ 几乎完全还原' : diff2.mean < 4 ? '△ 基本还原，有可见差异' : '✗ 还原失败'}`,
      );
    }

    await mergePage.browser.close();
  } finally {
    await renderer.dispose();
  }
  console.log();
}

main().catch((e) => {
  console.error('✗', e);
  process.exit(1);
});
