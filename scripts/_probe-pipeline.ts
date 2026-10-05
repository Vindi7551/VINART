/**
 * 探针 — 一键编排端到端验收
 *
 * 用 test_ipad 产品真实跑完整链:POST 上传 → SSE 订阅 → 断言 exit code 0。
 * 深度=sketch(零生图花费),槽位=PT01。
 *
 * 运行：npm run step scripts/_probe-pipeline.ts
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = 'http://localhost:5173';
const IMAGE = resolve('test_product/test_ipad/1.png');
const BULLETS = resolve('test_product/test_ipad/sellingpoint.txt');
const OUT = resolve('.tmp-run/pipeline-log.txt');

const t0 = Date.now();
const log: string[] = [];
const note = (s: string) => {
  log.push(s);
  console.log(s);
};

// 1) 上传
const imageB64 = readFileSync(IMAGE).toString('base64');
const bullets = readFileSync(BULLETS, 'utf8');
note('上传产品图 + 卖点…');
const post = await fetch(`${BASE}/api/pipeline`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'test-ipad',
    lang: 'en',
    depth: 'sketch',
    slot: 'PT01',
    image: `data:image/png;base64,${imageB64}`,
    bullets,
  }),
});
if (!post.ok) {
  note(`✗ POST 失败: ${post.status} ${await post.text()}`);
  writeFileSync(OUT, log.join('\n'));
  process.exit(1);
}
const { id } = (await post.json()) as { id: string };
note(`已受理 pipeline id=${id}`);

// 2) SSE 订阅执行流
const resp = await fetch(`${BASE}/api/pipeline-run/${id}`);
if (!resp.ok || !resp.body) {
  note(`✗ SSE 失败: ${resp.status}`);
  writeFileSync(OUT, log.join('\n'));
  process.exit(1);
}

let exitCode: number | null = null;
let lastPhase = '';
const reader = resp.body.getReader();
const decoder = new TextDecoder();
let buf = '';
while (exitCode === null) {
  const { done, value } = await reader.read();
  if (done) break;
  buf += decoder.decode(value, { stream: true });
  let i: number;
  while ((i = buf.indexOf('\n\n')) >= 0) {
    const frame = buf.slice(0, i);
    buf = buf.slice(i + 2);
    const ev = /^event: (.+)$/m.exec(frame)?.[1];
    const dataRaw = /^data: (.+)$/m.exec(frame)?.[1];
    if (!ev || !dataRaw) continue;
    const data = JSON.parse(dataRaw);
    if (ev === 'phase') {
      lastPhase = data.cmd;
      note(`\n▶ ${data.cmd}`);
    } else if (ev === 'log') {
      note(`  ${data.line}`);
    } else if (ev === 'exit') {
      exitCode = data.code;
      note(
        `\n${data.code === 0 ? '✓ 全链完成' : `✗ 在「${data.failed ?? '?'}」阶段失败`} (exit=${data.code})`,
      );
    }
  }
}
const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
note(`\n总耗时 ${elapsed}s;最后阶段: ${lastPhase}`);
writeFileSync(OUT, log.join('\n'));
console.log(`\n完整日志已存 ${OUT}`);
process.exit(exitCode === 0 ? 0 : 1);
