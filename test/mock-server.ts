/**
 * Mock AI Provider 服务器。
 *
 * 模拟 OpenAI 兼容的 SSE 流式对话 API 和火山方舟图片生成 API。
 * 支持通过请求参数模拟故障（超时、503、429），用于测试 retry / fallback。
 *
 * 启动：在另一个终端运行 `npx tsx test/mock-server.ts`
 * 默认监听 http://localhost:19324
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'http';

const PORT = 19324;

/** 模拟的 SSE 对话 chunks */
const MOCK_CHAT_CHUNKS = [
  { choices: [{ delta: { content: '你好' } }] },
  { choices: [{ delta: { content: '！' } }] },
  { choices: [{ delta: { content: '我是' }, finish_reason: null }] },
  { choices: [{ delta: { content: 'AI' }, finish_reason: null }] },
  { choices: [{ delta: { content: '助手' } }] },
  { choices: [{ delta: {}, finish_reason: 'stop' }] },
  { usage: { prompt_tokens: 10, completion_tokens: 5 } },
];

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function jsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk: Buffer) => (data += chunk.toString()));
    req.on('end', () => {
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
  });
}

const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    if (req.url === '/chat/completions') {
      await handleChat(req, res);
    } else if (req.url === '/images/generations' || req.url === '/images/generations/fail') {
      await handleImage(req, res);
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'not found' }));
    }
  } catch {
    res.writeHead(500);
    res.end();
  }
});

// ── Chat SSE 流 ──

async function handleChat(req: IncomingMessage, res: ServerResponse) {
  const body = await jsonBody(req);

  // 模拟故障：model 名包含 "fail" 返回 503
  if (body.model && String(body.model).includes('fail')) {
    res.writeHead(503);
    res.end(JSON.stringify({ error: 'service unavailable' }));
    return;
  }

  // 模拟限流：model 名包含 "ratelimit" 返回 429
  if (body.model && String(body.model).includes('ratelimit')) {
    res.writeHead(429, { 'Retry-After': '1' });
    res.end(JSON.stringify({ error: 'rate limit exceeded' }));
    return;
  }

  // 模拟超时：model 名包含 "timeout" → 不响应
  if (body.model && String(body.model).includes('timeout')) {
    return;
  }

  // 正常 SSE 流
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  for (const chunk of MOCK_CHAT_CHUNKS) {
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    await sleep(50);
  }

  res.write('data: [DONE]\n\n');
  res.end();
}

// ── Image 生成 ──

async function handleImage(req: IncomingMessage, res: ServerResponse) {
  const body = await jsonBody(req);

  // 模拟故障
  if (req.url === '/images/generations/fail') {
    res.writeHead(503);
    res.end(JSON.stringify({ error: 'service unavailable' }));
    return;
  }

  // 正常响应
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      data: [
        { url: `https://picsum.photos/seed/${Date.now()}/1024/1024`, size: '2K' },
      ],
      usage: { generated_images: 1, total_tokens: 50 },
    }),
  );
}

server.listen(PORT, () => {
  console.log(`🧪 Mock AI server running at http://localhost:${PORT}`);
  console.log('   /chat/completions    — SSE chat (use model "fail"/"ratelimit"/"timeout" to test errors)');
  console.log('   /images/generations   — JSON image');
});
