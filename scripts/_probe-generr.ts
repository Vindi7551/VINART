/**
 * 一次性诊断：绕过网关的降级封装，直接打生图 API 看真实错误。
 *
 * 起因：step-layout 报 `All 1 image provider(s) exhausted`——
 * gateway 的 fallback 把 provider 的错误静默吞掉了，看不到真正原因。
 * 这里直接 fetch，把原始响应打出来。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const keys = JSON.parse(readFileSync('keys.json', 'utf8'));
const ark = keys.providers.find((p: { name: string }) => p.name === 'volcano-ark');
const endpoint = `${ark.baseURL}/images/generations`;

const spec = JSON.parse(
  readFileSync(resolve('test_product/specs/img1.json'), 'utf8'),
);
const prompt: string = spec.generate[0].prompt;

console.log(`提示词长度: ${prompt.length} 字符`);
console.log(`模型: ${ark.models[0].model}`);

async function tryCall(label: string, body: Record<string, unknown>) {
  console.log(`\n${'─'.repeat(60)}\n${label}\n${'─'.repeat(60)}`);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ark.apiKey}` },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    console.log(`HTTP ${res.status}`);
    console.log(text.slice(0, 900));
  } catch (e) {
    console.log(`异常: ${(e as Error).message}`);
  }
}

// ① 不带参考图，纯提示词 —— 判断是不是提示词本身的问题
await tryCall('① 纯提示词，无参考图', {
  model: ark.models[0].model,
  prompt,
  size: '2048x2048',
  response_format: 'url',
});

// ② 把提示词截短到 300 字符以内，判断是不是长度限制
await tryCall('② 截短的提示词（前 280 字符）', {
  model: ark.models[0].model,
  prompt: prompt.slice(0, 280),
  size: '2048x2048',
  response_format: 'url',
});

// ③ 不带 size 参数
await tryCall('③ 完整提示词但不传 size', {
  model: ark.models[0].model,
  prompt,
  response_format: 'url',
});
