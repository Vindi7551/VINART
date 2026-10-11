/**
 * 探针：deepseek-flash 流式响应里 reasoning_content 到底有没有内容？
 *
 * 为什么必须先跑这个：
 * 官方文档说 thinking 默认 enabled，但 Flash 级模型可能裁掉推理输出。
 * 若返回为空 → 透传层无从接起，得先改请求体；若不空 → 只改透传即可。
 * 两条路成本差一个数量级，不能靠推测。
 *
 * 断言口径（不是打印）：
 *   ① SSE 里出现过 `reasoning_content` 键（字段存在性）
 *   ② 至少一个 chunk 的 reasoning_content 非空（内容存在性）
 *   ③ reasoning 总字符数 > 0
 * 任一失败 → 抛错 + 非 0 退出。
 *
 * 运行：node scripts/run-ts.mjs scripts/_probe-reasoning-stream.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let pass = 0;
const fails: string[] = [];
function ok(cond: boolean, msg: string, extra = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${msg}`);
  } else {
    fails.push(msg);
    console.log(`  ✗ ${msg}${extra ? ` —— ${extra}` : ''}`);
  }
}

// ── 读 keys.json 取 deepseek 配置（与生产同源，不硬编码 key）──
const keys = JSON.parse(readFileSync(resolve('keys.json'), 'utf8')) as {
  providers: Array<{ name: string; type: string; apiKey: string; baseURL: string; models: Array<{ model: string }> }>;
};
const p = keys.providers.find((x) => x.name === 'deepseek');
if (!p) throw new Error('keys.json 里找不到 deepseek provider');
const model = p.models[0].model;
console.log(`探针目标：${p.baseURL}  model=${model}\n`);

// 刻意给一个"值得思考"的问题，最大化推理概率（简单问答可能不触发思考）
const body = {
  model,
  messages: [
    { role: 'system', content: 'You are a careful assistant.' },
    { role: 'user', content: '一个笼子里有鸡和兔共 35 只，脚共 94 只。鸡和兔各几只？请说明推理过程。' },
  ],
  stream: true,
  stream_options: { include_usage: true },
  max_tokens: 4096,
};

const resp = await fetch(`${p.baseURL}/chat/completions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.apiKey}` },
  body: JSON.stringify(body),
});
ok(resp.ok, `HTTP ${resp.status}`, resp.ok ? '' : await resp.text());
if (!resp.body) throw new Error('响应无 body');

// ── 逐帧解析 SSE ──
const decoder = new TextDecoder();
let buf = '';
let sawReasoningKey = false;
let reasoningChars = 0;
let contentChars = 0;
let reasoningSamples: string[] = [];
let usage: unknown = null;
let firstReasoningAt: number | null = null;
let firstContentAt: number | null = null;
const t0 = Date.now();

const reader = resp.body.getReader();
for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  buf += decoder.decode(value, { stream: true });
  let idx: number;
  while ((idx = buf.indexOf('\n\n')) >= 0) {
    const frame = buf.slice(0, idx);
    buf = buf.slice(idx + 2);
    const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
    if (!dataLine) continue;
    const raw = dataLine.slice(6);
    if (raw === '[DONE]') continue;
    let json: {
      choices?: Array<{ delta?: { content?: string; reasoning_content?: string } }>;
      usage?: unknown;
    };
    try {
      json = JSON.parse(raw);
    } catch {
      continue;
    }
    const delta = json.choices?.[0]?.delta;
    if (delta) {
      if ('reasoning_content' in delta) sawReasoningKey = true;
      const rc = delta.reasoning_content;
      if (typeof rc === 'string' && rc.length > 0) {
        if (firstReasoningAt === null) firstReasoningAt = Date.now() - t0;
        reasoningChars += rc.length;
        if (reasoningSamples.length < 3) reasoningSamples.push(rc.slice(0, 60).replace(/\n/g, '⏎'));
      }
      const c = delta.content;
      if (typeof c === 'string' && c.length > 0) {
        if (firstContentAt === null) firstContentAt = Date.now() - t0;
        contentChars += c.length;
      }
    }
    if (json.usage) usage = json.usage;
  }
}
const totalMs = Date.now() - t0;

// ── 断言 ──
console.log('');
ok(sawReasoningKey, 'SSE 中出现过 reasoning_content 键');
ok(reasoningChars > 0, `reasoning 内容非空（${reasoningChars} 字符）`);
ok(contentChars > 0, `正文内容非空（${contentChars} 字符）`);

console.log('\n── 观测数据 ──');
console.log(`  reasoning 字符数 : ${reasoningChars}`);
console.log(`  正文      字符数 : ${contentChars}`);
console.log(`  首条 reasoning   : ${firstReasoningAt === null ? '未出现' : firstReasoningAt + 'ms'}`);
console.log(`  首条正文         : ${firstContentAt === null ? '未出现' : firstContentAt + 'ms'}`);
console.log(`  整轮耗时         : ${totalMs}ms`);
console.log(`  usage            : ${usage ? JSON.stringify(usage) : '未返回'}`);
if (reasoningSamples.length) {
  console.log('  reasoning 片段   :');
  reasoningSamples.forEach((s) => console.log(`    · ${s}`));
}

console.log(`\n${fails.length === 0 ? `✓ 全部通过（${pass}）` : `✗ 失败 ${fails.length} 项：\n  - ${fails.join('\n  - ')}`}`);
process.exit(fails.length === 0 ? 0 : 1);
