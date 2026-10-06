/**
 * 把任意 HTML 文件渲染成 PNG —— 调试/验收用的小工具。
 *
 * 用法：
 *   npm run step scripts/render-html.ts -- <html路径> <输出名> [--w 2000] [--h 2000] [--scale 1]
 *
 * 典型场景：手工改了 finalv2.html 之类的源文件，想立刻看渲染效果。
 */

import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

async function main() {
  const argv = process.argv.slice(2);
  const TAKES = new Set(['--w', '--h', '--scale']);
  const used = new Set<number>();
  argv.forEach((a, i) => {
    if (TAKES.has(a)) {
      used.add(i);
      used.add(i + 1);
    }
  });
  const positional = argv.filter((_a, i) => !used.has(i));
  const argVal = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : null;
  };

  const htmlPath = resolve(positional[0] ?? '');
  const outName = positional[1] ?? 'render';
  const W = Number(argVal('--w') ?? 2000);
  const H = Number(argVal('--h') ?? 2000);
  const SCALE = Number(argVal('--scale') ?? 1);

  if (!existsSync(htmlPath)) {
    console.error(`✗ 找不到 HTML：${htmlPath}`);
    process.exit(1);
  }

  // 输出目录 = HTML 所在目录（和它的相对资源待在一起）
  const outDir = dirname(htmlPath);

  const { createBlinkRenderer } = await import('../../render/blink-renderer');
  const renderer = createBlinkRenderer();
  try {
    const out = await renderer.render({ html: htmlPath, isFilePath: true }, outDir, {
      width: W,
      height: H,
      deviceScaleFactor: SCALE,
      format: 'png',
      filename: outName,
    });
    const buf = readFileSync(out.imagePath);
    console.log(
      `\n✓ ${out.imagePath}\n  ${buf.readUInt32BE(16)}×${buf.readUInt32BE(20)}  ${(buf.length / 1024).toFixed(0)} KB`,
    );
  } finally {
    await renderer.dispose();
  }
  console.log();
}

void mkdirSync;
main().catch((e) => {
  console.error('✗', e);
  process.exit(1);
});
