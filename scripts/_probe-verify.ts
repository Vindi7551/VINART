/**
 * 验证：去掉触发段后是否通过；以及 S12 能否改写保留原意。
 *
 * 已知 S12「Keine weiteren Schriften oder Buchstaben im Bild, keine Logos,
 * kein Wasserzeichen, keine Fremdmarken.」单独提交即被拦截。
 * 现在验证两点：
 *   1. 完整提示词去掉 S12 是否通过
 *   2. S12 换一种说法（不提 Marken/Logos）能否通过
 */

import { readFileSync } from 'node:fs';

const keys = JSON.parse(readFileSync('keys.json', 'utf8'));
const ark = keys.providers.find((p: { name: string }) => p.name === 'volcano-ark');
const endpoint = `${ark.baseURL}/images/generations`;
const model = ark.models[0].model;

const FULL = JSON.parse(readFileSync('test_product/specs/img1.json', 'utf8')).generate[0]
  .prompt as string;

const S12 = 'Keine weiteren Schriften oder Buchstaben im Bild, keine Logos, kein Wasserzeichen, keine Fremdmarken.';
const WITHOUT = FULL.replace(S12, '').trim();

/** 改写：完全不提 Marken / Logos / Wasserzeichen */
const REWRITE = 'Das Bild enthält ausser der Gravur auf dem Brett keine Schriftzeichen.';

async function call(label: string, prompt: string) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ark.apiKey}` },
    body: JSON.stringify({ model, prompt, size: '2048x2048', response_format: 'url' }),
  });
  const text = await res.text();
  let v = `HTTP ${res.status}`;
  if (res.ok) v += '  ✓ 通过';
  else {
    try {
      v += `  ✗ ${JSON.parse(text).error?.code ?? ''}`;
    } catch {
      v += `  ✗ ${text.slice(0, 80)}`;
    }
  }
  console.log(`  ${label.padEnd(40)} ${v}`);
}

async function main() {
  console.log('\n验证\n' + '─'.repeat(70));
  await call('① 完整提示词去掉 S12', WITHOUT);
  await call('② S12 改写为不含 Marken/Logos 的版本', WITHOUT + ' ' + REWRITE);
  console.log();
}

main().catch((e) => {
  console.error('✗', e);
  process.exit(1);
});
