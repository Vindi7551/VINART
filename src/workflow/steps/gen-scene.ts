/**
 * 场景底图生成工具
 *
 * 从 step-04 的设计草案里读 `production.scene_prompt_de` 与 `negative_prompt_de`，
 * 调图片生成模型出图，下载保存到 test_product/assets/<SLOT>-bg.png。
 * step-05 渲染时会自动检测并复用这张底图。
 *
 * ⚠️ 生成的内容**只允许是场景/背景/光影**。
 * 商品本体必须来自实物照片——生成模型重画商品会导致木纹漂移、弧边走形、
 * 刻字错位，被平台判「与实物不符」。设计草案的提示词与负面词里已经写明了这一点。
 *
 * ⚠️ 语言提示：图片生成模型的提示词支持以中文/英文为主，德语提示词可能效果打折。
 * 若出图不理想，可用 --prompt 直接传中文提示词覆盖。
 *
 * 运行：
 *   npm run step scripts/gen-scene.ts                 # 默认 PT01
 *   npm run step scripts/gen-scene.ts -- PT05
 *   npm run step scripts/gen-scene.ts -- PT01 --count 4   # 一次出 4 张挑
 *   npm run step scripts/gen-scene.ts -- PT01 --prompt "中文覆盖提示词"
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getImageGateway } from '../../config';

// ── 参数 ──

const argv = process.argv.slice(2);
let slot = 'PT01';
let count = 1;
let promptOverride: string | null = null;

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--count') count = Math.max(1, parseInt(argv[++i] ?? '1', 10) || 1);
  else if (a === '--prompt') promptOverride = argv[++i] ?? null;
  else if (!a.startsWith('--')) slot = a.toUpperCase();
}

const DESIGN = resolve(`test_product/step-04-design.${slot}.json`);
const ASSET_DIR = resolve('test_product/assets');

async function main() {
  console.log('\n' + '═'.repeat(66));
  console.log(`场景底图生成 — ${slot}`);
  console.log('═'.repeat(66));

  if (!existsSync(DESIGN)) {
    console.error(`\n✗ 找不到设计草案：${DESIGN}`);
    console.error(`\n请先跑：\n  npm run step scripts/step-04-design.ts -- --only ${slot}`);
    process.exit(1);
  }

  const design = JSON.parse(readFileSync(DESIGN, 'utf8')).design;
  const p = design?.production ?? {};

  const scenePrompt: string | null = promptOverride ?? p.scene_prompt_de ?? null;
  const negative: string | null = p.negative_prompt_de ?? null;

  if (!scenePrompt) {
    console.error(`\n✗ 设计草案里没有 scene_prompt_de，也没有用 --prompt 指定`);
    process.exit(1);
  }

  // 火山方舟 provider 没有独立的负面提示词参数，把负面词并进提示词尾。
  // 多数图像模型能理解这种「不要出现 X」的尾缀写法。
  const fullPrompt = negative
    ? `${scenePrompt}\n\nNicht darstellen: ${negative}`
    : scenePrompt;

  console.log(`\n[1] 提示词`);
  console.log(`    来源 : ${promptOverride ? '命令行覆盖' : '设计草案 scene_prompt_de'}`);
  console.log(`    长度 : ${fullPrompt.length} 字符`);
  console.log(`    张数 : ${count}`);
  console.log('\n    ── 正文 ──');
  console.log(fullPrompt.split('\n').map((l) => '    ' + l).join('\n'));

  const gateway = getImageGateway();

  // 尺寸：目标画布 2000×2000，取 2048×2048；若模型不接受具体像素则回退 '2K'
  const sizesToTry = ['2048x2048', '2K'];
  let result = null;
  for (const size of sizesToTry) {
    try {
      console.log(`\n[2] 提交生图请求（size=${size}）…`);
      const t0 = Date.now();
      result = await gateway.generate({ prompt: fullPrompt, size, count, format: 'png' });
      console.log(`    ✓ 完成 ${Date.now() - t0}ms　模型 ${result.model}　size=${size}`);
      console.log(`    张数 ${result.images.length}　用量 ${JSON.stringify(result.usage)}`);
      break;
    } catch (e) {
      console.log(`    ✗ size=${size} 失败：${(e as Error).message.split('\n')[0]}`);
    }
  }

  if (!result) {
    console.error('\n✗ 所有尺寸都失败');
    process.exit(1);
  }

  // ── 下载 ──
  mkdirSync(ASSET_DIR, { recursive: true });
  console.log(`\n[3] 下载到 ${ASSET_DIR}`);
  for (let i = 0; i < result.images.length; i++) {
    const img = result.images[i];
    const suffix = result.images.length > 1 ? `-${i + 1}` : '';
    const outPath = resolve(ASSET_DIR, `${slot}-bg${suffix}.png`);

    const res = await fetch(img.url);
    if (!res.ok) {
      console.log(`    ✗ 第 ${i + 1} 张下载失败 HTTP ${res.status}`);
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(outPath, buf);

    // 直接读 PNG 头核验真实尺寸，不信返回值
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    console.log(`    ✓ ${outPath}`);
    console.log(`        ${w}×${h}　${(buf.length / 1024).toFixed(0)} KB　（原图声称 ${img.size}）`);
  }

  console.log(
    `\n[4] 下一步\n` +
      `    npm run step scripts/step-05-render.ts -- ${slot}\n` +
      `    （step-05 会优先用 assets/${slot}-bg.png，多张时用 -1/-2 后缀需手工改名）`,
  );
  console.log();
}

main().catch((e) => {
  console.error('\n✗ 失败:', e);
  process.exit(1);
});
