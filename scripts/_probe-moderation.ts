/**
 * 诊断：内容审核拦截的触发源是提示词，还是参考图？
 *
 * 已知：完整的生日派对提示词 + 2 张参考图 → 稳定被
 * `InputTextSensitiveContentDetected` 拦截（连续 3 次）。
 * 但同样的提示词**不带参考图**时成功过。
 *
 * 本探针做减法：
 *   A. 参考图 + 极简干净提示词   → 通过则说明触发源在提示词
 *   B. 参考图 + 完整提示词       → 复现拦截
 *   C. 无参考图 + 完整提示词     → 通过则说明参考图提高了审核门槛
 *
 * 每次成功都会消耗约 16k tokens，所以只跑必要的三个。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const keys = JSON.parse(readFileSync('keys.json', 'utf8'));
const ark = keys.providers.find((p: { name: string }) => p.name === 'volcano-ark');
const endpoint = `${ark.baseURL}/images/generations`;
const model = ark.models[0].model;

const spec = JSON.parse(readFileSync(resolve('test_product/specs/img1.json'), 'utf8'));
const fullPrompt: string = spec.generate[0].prompt;

const OUT = resolve('test_product/layout/img1');
const PRODUCT = resolve(OUT, 'product-cutout.png');
const SKETCH = resolve(OUT, 'sketch.png');

async function main() {
  const { chromium } = await import('playwright');
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch {
    browser = await chromium.launch({ headless: true, channel: 'chromium' });
  }

  try {
    const page = await browser.newPage();
    const toRef = async (path: string, max: number) => {
      const b64 = readFileSync(path).toString('base64');
      return page.evaluate(
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
        { b64, max },
      );
    };
    const refProduct = await toRef(PRODUCT, 768);
    const refSketch = await toRef(SKETCH, 1024);
    await page.close();

    console.log(`参考图已就绪（商品 ${(refProduct.length / 1024).toFixed(0)} KB / 草图 ${(refSketch.length / 1024).toFixed(0)} KB）\n`);

    async function call(label: string, prompt: string, images: string[] | undefined) {
      const body: Record<string, unknown> = {
        model,
        prompt,
        size: '2048x2048',
        response_format: 'url',
      };
      if (images?.length) body.image = images.length === 1 ? images[0] : images;

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ark.apiKey}` },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      let verdict = `HTTP ${res.status}`;
      if (res.ok) verdict += '  ✓ 通过';
      else {
        try {
          const j = JSON.parse(text);
          verdict += `  ✗ ${j.error?.code ?? ''} — ${(j.error?.message ?? '').slice(0, 90)}`;
        } catch {
          verdict += `  ✗ ${text.slice(0, 120)}`;
        }
      }
      console.log(`${label}`);
      console.log(`  → ${verdict}\n`);
    }

    const CLEAN = 'Festliche Geburtstagsfeier mit mehreren Personen, warmes Abendlicht, Holztisch, Blumen.';

    await call('A. 参考图 ×2 + 极简干净提示词', CLEAN, [refProduct, refSketch]);
    await call('B. 参考图 ×2 + 完整提示词（复现拦截）', fullPrompt, [refProduct, refSketch]);
    await call('C. 无参考图 + 完整提示词', fullPrompt, undefined);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error('✗', e);
  process.exit(1);
});
