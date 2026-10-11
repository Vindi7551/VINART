/**
 * 端到端探针：思考块 + 耗时（含工具执行的整轮）是否真的通了。
 *
 * 验四件事（全部断言、失败即非 0 退出）：
 *   ① SSE 出现 `reasoning` 事件，且内容非空
 *   ② 终章 reasoning 事件带 full:true（前端据此覆盖而非追加）
 *   ③ `done` 事件带 durationMs 且 > 0
 *   ④ 落盘事件里 assistant 消息带 durationMs（历史回放能复原耗时——用户要求）
 *
 * 为什么走真 HTTP 而不是直接调函数：要验的正是「接线」——
 * chat-session 的 yield → server 的 SSE 分流 → 转录落盘 这条链。
 *
 * 运行：node scripts/run-ts.mjs scripts/_probe-reasoning-e2e.ts
 *      前置：8787 已在跑（改了后端必须重启，否则验的是旧代码）
 */
import { readFileSync } from 'node:fs';

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

const API = 'http://localhost:8787';

// ── 建一个临时工作目录会话（会话跟目录走；用唯一名字避免撞已有会话）──
const stamp = Date.now();
const sessionId = `probe_reasoning_${stamp}`;
const workDir = process.cwd();

const createResp = await fetch(`${API}/api/sessions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ workDir, sessionId }),
});
ok(createResp.ok || createResp.status === 409, `建会话 HTTP ${createResp.status}`);

// ── 发一条会触发思考的消息（数学题——探针已验证它必产 reasoning）──
const chatResp = await fetch(`${API}/api/sessions/${sessionId}/chat`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    text: '鸡兔同笼：35 个头、94 只脚。鸡和兔各几只？只回答数字，不要解释。',
    activeLayout: null,
  }),
});
ok(chatResp.ok, `chat HTTP ${chatResp.status}`, chatResp.ok ? '' : await chatResp.text());
if (!chatResp.body) throw new Error('无 body');

const decoder = new TextDecoder();
let buf = '';
let reasoningChars = 0;
let sawReasoningEvent = false;
let sawFullFinal = false;
let doneDuration = 0;
let sawDone = false;
let contentChars = 0;

const reader = chatResp.body.getReader();
for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  buf += decoder.decode(value, { stream: true });
  let idx: number;
  while ((idx = buf.indexOf('\n\n')) >= 0) {
    const frame = buf.slice(0, idx);
    buf = buf.slice(idx + 2);
    const lines = frame.split('\n');
    const ev = lines.find((l) => l.startsWith('event: '))?.slice(7) ?? '';
    const dataLine = lines.find((l) => l.startsWith('data: '));
    if (!dataLine) continue;
    let data: { content?: string; full?: boolean; durationMs?: number; message?: string };
    try {
      data = JSON.parse(dataLine.slice(6));
    } catch {
      continue;
    }
    if (ev === 'reasoning' && data.content) {
      sawReasoningEvent = true;
      if (data.full) sawFullFinal = true;
      // full 是覆盖语义，统计时只取最终全文；非 full 累加
      if (!data.full) reasoningChars += data.content.length;
      else reasoningChars = data.content.length;
    }
    if (ev === 'chunk' && data.content) contentChars += data.content.length;
    if (ev === 'done') {
      sawDone = true;
      doneDuration = data.durationMs ?? 0;
    }
    if (ev === 'error') throw new Error(`SSE error: ${data.message}`);
  }
}

console.log('');
ok(sawReasoningEvent, 'SSE 出现 reasoning 事件');
ok(reasoningChars > 0, `reasoning 内容非空（${reasoningChars} 字符）`);
ok(sawFullFinal, '终章 reasoning 事件带 full:true（覆盖语义）');
ok(contentChars > 0, `正文非空（${contentChars} 字符）`);
ok(sawDone, '收到 done 事件');
ok(doneDuration > 0, `done.durationMs > 0（${doneDuration}ms）`);

// ── 落盘校验：assistant 消息带 durationMs（历史回放复原耗时）──
const evResp = await fetch(`${API}/api/sessions/${sessionId}`);
const { events } = (await evResp.json()) as { events: Array<{ kind: string; role?: string; durationMs?: number }> };
const assistantMsg = events.find((e) => e.kind === 'message' && e.role === 'assistant');
ok(!!assistantMsg, '转录里有 assistant 消息事件');
ok(
  typeof assistantMsg?.durationMs === 'number' && assistantMsg.durationMs > 0,
  `落盘的 assistant 消息带 durationMs（${assistantMsg?.durationMs ?? '无'}ms）`,
);

// ── 清理：删掉探针会话（不留垃圾）──
await fetch(`${API}/api/sessions/${sessionId}`, { method: 'DELETE' }).catch(() => undefined);

console.log(`\n${fails.length === 0 ? `✓ 全部通过（${pass}）` : `✗ 失败 ${fails.length} 项：\n  - ${fails.join('\n  - ')}`}`);
process.exit(fails.length === 0 ? 0 : 1);
