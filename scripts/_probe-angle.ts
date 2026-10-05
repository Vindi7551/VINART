/**
 * 探针：生成模型能不能出【我们手上没有的角度】？
 *
 * 为什么这是决定性的：
 * 现有素材只有一张正面平视照。而套图里这几张全都需要新角度或新状态——
 *   PT03 切菜/上菜（俯视或斜俯视 + 食材 + 手部）
 *   PT04 侧视看厚度 1,5 cm（纯侧面平视）
 *   PT05 支架折叠态（结构变化）
 *   PT06 上油护理动作（手部 + 道具）
 * 合成路线**变不出这些**。所以「生成模型参与商品生成」不是偏好，是前提。
 *
 * 本次测两个最难的角度：
 *   A. 斜俯视 + 食材 + 刀 —— 功能演示图（PT03 用）
 *   B. 纯侧面平视 —— 看厚度（PT04 用）
 *
 * 运行：npm run step scripts/_probe-angle.ts
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getImageGateway } from '../src/config';

const PRODUCT = resolve('test_product/af39f425-770e-472e-a21e-6964f7864974.png');
const OUT_DIR = resolve('test_product/probe');
const REF_MAX = 768;

/** 不变的「保商品」约束，拼在每个提示词后面 */
const HOLD = [
  'Das Brett muss wie im Referenzbild aussehen: dunkles Akazienholz mit welliger Maserung,',
  'die Gravur «KLASSIKER 40» in dieser Anordnung, der schwarze Metallständer.',
  'Keine Personen, keine Gesichter, keine lesbaren Fremdtexte, keine Logos, kein Wasserzeichen.',
].join(' ');

const CASES = [
  {
    name: 'A-kitchen-45deg',
    desc: '斜俯视 + 食材 + 刀（功能演示，PT03 用）',
    prompt: [
      'Fotorealistische Aufnahme einer modernen Küche mit warmem Tageslicht.',
      'Kamera in etwa 45 Grad Aufsicht von schräg oben auf eine helle Arbeitsplatte gerichtet.',
      'Auf dem Holzbrett aus dem Referenzbild liegen frisch geschnittenes Brot, Käse und Trauben,',
      'daneben ein Kochmesser. Das Brett steht flach auf der Arbeitsplatte.',
      HOLD,
    ].join(' '),
  },
  {
    name: 'B-side-view',
    desc: '纯侧面平视看厚度（PT04 用）',
    prompt: [
      'Fotorealistische Produktaufnahme vor neutralem hellem Hintergrund, Studio-Ausleuchtung.',
      'Kamera exakt auf Höhe der Tischkante, direkt von der Seite, sodass die Dicke des Brettes',
      'deutlich als schmale Kante sichtbar ist.',
      'Das Brett steht aufrecht auf seiner schmalen Unterkante, der Metallständer ist',
      'leicht angewinkelt dahinter sichtbar.',
      HOLD,
    ].join(' '),
  },
];

async function main() {
  console.log('\n' + '═'.repeat(66));
  console.log('探针 — 能否生成我们手上没有的角度');
  console.log('═'.repeat(66));

  const { chromium } = await import('playwright');
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch {
    browser = await chromium.launch({ headless: true, channel: 'chromium' });
  }

  try {
    const page = await browser.newPage();
    const raw = readFileSync(PRODUCT).toString('base64');
    const refDataUrl = await page.evaluate(
      async (a: { b64: string; max: number }) => {
        const img = new Image();
        img.src = `data:image/png;base64,${a.b64}`;
        await img.decode();
        const s = Math.min(1, a.max / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.round(img.naturalWidth * s);
        const h = Math.round(img.naturalHeight * s);
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        return c.toDataURL('image/jpeg', 0.9);
      },
      { b64: raw, max: REF_MAX },
    );
    await page.close();
    console.log(`\n参考图已就绪（${REF_MAX}px 上限的 jpeg data URL）`);

    mkdirSync(OUT_DIR, { recursive: true });
    const gateway = getImageGateway();

    for (const c of CASES) {
      console.log('\n' + '─'.repeat(66));
      console.log(`【${c.name}】${c.desc}`);
      console.log('─'.repeat(66));
      const t0 = Date.now();
      try {
        const r = await gateway.generate({
          prompt: c.prompt,
          referenceImages: [refDataUrl],
          size: '2048x2048',
          count: 1,
          format: 'png',
        });
        console.log(`  ✓ ${Date.now() - t0}ms　${r.images.length} 张`);
        for (let i = 0; i < r.images.length; i++) {
          const res = await fetch(r.images[i].url);
          if (!res.ok) {
            console.log(`    ✗ 下载 HTTP ${res.status}`);
            continue;
          }
          const buf = Buffer.from(await res.arrayBuffer());
          const out = resolve(OUT_DIR, `${c.name}.png`);
          writeFileSync(out, buf);
          console.log(`    → ${out}  ${buf.readUInt32BE(16)}×${buf.readUInt32BE(20)}  ${(buf.length / 1024).toFixed(0)} KB`);
        }
      } catch (e) {
        console.log(`  ✗ 失败：${(e as Error).message.split('\n')[0]}`);
      }
    }

    console.log('\n' + '═'.repeat(66));
    console.log('逐张核对：商品是否还是同一个商品？角度是否真的变了？');
    console.log('═'.repeat(66) + '\n');
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error('\n✗ 失败:', e);
  process.exit(1);
});
