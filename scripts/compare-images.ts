/**
 * 图像对比工具 —— 重构后验证"没把已经好的东西弄坏"。
 *
 * 用法：
 *   npm run step scripts/compare-images.ts -- <A图> <B图> [输出前缀]
 *   npm run step scripts/compare-images.ts -- <目录> old-final.png final.png
 *
 * 输出：
 *   - 终端：平均色差 / 最大色差 / 超阈值像素占比 / 判定
 *   - 图片：并排对照 + **色差放大图**（差异处高亮，一眼看出哪块变了）
 *
 * 为什么要放大色差图：单看平均值会漏掉"局部严重错位"。
 * 平均值 0.5 可能意味着"整体轻微抗锯齿差异"，也可能意味着"一小块完全错了但被平均掉"。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const OUT = resolve('test_product/compare');

interface DiffStat {
  w: number;
  h: number;
  mean: number;
  max: number;
  over2: number;
  over10: number;
  over40: number;
}

async function main() {
  const argv = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (argv.length < 2) {
    console.error('用法: npm run step scripts/compare-images.ts -- <A> <B> [输出前缀]');
    process.exit(1);
  }

  // 支持两种用法：两个文件路径，或 (目录, 文件名A, 文件名B)
  let pathA: string;
  let pathB: string;
  let prefix: string;
  if (argv.length >= 3 && existsSync(resolve(argv[0], argv[1]))) {
    const dir = resolve(argv[0]);
    pathA = resolve(dir, argv[1]);
    pathB = resolve(dir, argv[2]);
    prefix = argv[3] ?? `${basename(argv[1], '.png')}--vs--${basename(argv[2], '.png')}`;
  } else {
    pathA = resolve(argv[0]);
    pathB = resolve(argv[1]);
    prefix = argv[2] ?? 'compare';
  }

  for (const [p, label] of [[pathA, 'A'], [pathB, 'B']] as const) {
    if (!existsSync(p)) {
      console.error(`\n✗ 找不到 ${label}：${p}`);
      process.exit(1);
    }
  }

  console.log('\n' + '═'.repeat(70));
  console.log('图像对比');
  console.log('═'.repeat(70));
  console.log(`  A: ${pathA}`);
  console.log(`  B: ${pathB}`);

  mkdirSync(OUT, { recursive: true });

  const { chromium } = await import('playwright');
  let browser: Awaited<ReturnType<typeof chromium.launch>>;
  try {
    browser = await chromium.launch({ headless: true });
  } catch {
    browser = await chromium.launch({ headless: true, channel: 'chromium' });
  }

  const page = await browser.newPage();
  const a64 = readFileSync(pathA).toString('base64');
  const b64 = readFileSync(pathB).toString('base64');

  const result = await page.evaluate(
    async (arg: { a: string; b: string }) => {
      const load = (src: string) =>
        new Promise<HTMLImageElement>((res, rej) => {
          const im = new Image();
          im.onload = () => res(im);
          im.onerror = rej;
          im.src = 'data:image/png;base64,' + src;
        });
      const [ia, ib] = await Promise.all([load(arg.a), load(arg.b)]);

      const W = Math.max(ia.naturalWidth, ib.naturalWidth);
      const H = Math.max(ia.naturalHeight, ib.naturalHeight);

      const cv = document.createElement('canvas');
      cv.width = W;
      cv.height = H;
      const ctx = cv.getContext('2d')!;
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(ia, 0, 0);
      const da = ctx.getImageData(0, 0, W, H).data;
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(ib, 0, 0);
      const db = ctx.getImageData(0, 0, W, H).data;

      // 色差放大图：把差异乘 6 倍并染红，放在纯黑底上
      const dv = document.createElement('canvas');
      dv.width = W;
      dv.height = H;
      const vctx = dv.getContext('2d')!;
      const vd = vctx.createImageData(W, H);

      let sum = 0, maxD = 0, o2 = 0, o10 = 0, o40 = 0;
      const n = W * H;
      for (let i = 0; i < da.length; i += 4) {
        const d =
          (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2])) / 3;
        sum += d;
        if (d > maxD) maxD = d;
        if (d > 2) o2++;
        if (d > 10) o10++;
        if (d > 40) o40++;
        const v = Math.min(255, d * 6);
        vd.data[i] = v;
        vd.data[i + 1] = v * 0.25;
        vd.data[i + 2] = v * 0.25;
        vd.data[i + 3] = 255;
      }
      vctx.putImageData(vd, 0, 0);

      return {
        stat: { w: W, h: H, mean: sum / n, max: maxD, over2: o2 / n, over10: o10 / n, over40: o40 / n },
        heat: dv.toDataURL('image/png'),
        aUrl: ia.src,
        bUrl: ib.src,
      };
    },
    { a: a64, b: b64 },
  );

  const st = result.stat as DiffStat;
  console.log(`\n  尺寸        A/B 最大 ${st.w}×${st.h}`);
  console.log(`  平均色差    ${st.mean.toFixed(3)} / 255`);
  console.log(`  最大色差    ${st.max.toFixed(1)} / 255`);
  console.log(`  色差>2      ${(st.over2 * 100).toFixed(3)}%`);
  console.log(`  色差>10     ${(st.over10 * 100).toFixed(3)}%`);
  console.log(`  色差>40     ${(st.over40 * 100).toFixed(3)}%`);

  const verdict =
    st.mean < 0.5 && st.over10 < 0.01
      ? '✓ 一致（重构未改变渲染结果）'
      : st.mean < 3
        ? '△ 基本一致，有可见差异'
        : '✗ 差异显著';
  console.log(`\n  判定        ${verdict}`);

  // 输出对照图 + 色差放大图
  const heatPath = resolve(OUT, `${prefix}.heat.png`);
  writeFileSync(heatPath, Buffer.from((result.heat as string).split(',')[1], 'base64'));
  console.log(`\n  色差放大图 → ${heatPath}（差异处染红，越亮差越大）`);

  await page.close();
  await browser.close();
  console.log();
}

main().catch((e) => {
  console.error('✗', e);
  process.exit(1);
});
