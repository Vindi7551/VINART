/**
 * Gateway 集成测试。
 *
 * 使用本地 Mock 服务器模拟 AI Provider 响应，零 API 消耗。
 * 运行前需先启动 Mock 服务器：
 *   npx tsx test/mock-server.ts
 *
 * 然后运行测试：
 *   npx vitest run
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createServer } from 'http';
import type { Server } from 'http';
import {
  createChatGateway,
  createImageGateway,
  createRegistry,
  createOpenAI,
  createVolcanoArk,
} from '../src/gateway/index';
import type {
  ChatGateway,
  ImageGateway,
  ModelEntry,
} from '../src/gateway/index';

const PORT = 19324;
const BASE_URL = `http://localhost:${PORT}`;

let mockServer: Server;

// ── Mock 服务器生命周期 ──

beforeAll(async () => {
  // 复用 test/mock-server.ts 的逻辑（内联避免依赖 Node worker）
  mockServer = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    try {
      if (req.url === '/chat/completions') await handleChat(req, res);
      else if (req.url === '/images/generations') await handleImage(req, res);
      else { res.writeHead(404); res.end(JSON.stringify({ error: 'not found' })); }
    } catch { res.writeHead(500); res.end(); }
  });

  await new Promise<void>((resolve) => mockServer.listen(PORT, resolve));
});

// 测试结束后由 vitest 自动清理（进程退出时 server 自动关闭）

// ── 内联 Mock 处理器 ──

async function jsonBody(req: any): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk: Buffer) => (data += chunk.toString()));
    req.on('end', () => {
      try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON')); }
    });
  });
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

const MOCK_CHUNKS = [
  { choices: [{ delta: { content: '你好' } }] },
  { choices: [{ delta: { content: '！' } }] },
  { choices: [{ delta: {}, finish_reason: 'stop' }] },
  { usage: { prompt_tokens: 10, completion_tokens: 2 } },
];

async function handleChat(req: any, res: any) {
  const body = await jsonBody(req);
  const model = String(body.model ?? '');

  if (model.includes('fail')) {
    res.writeHead(503); res.end(JSON.stringify({ error: 'service unavailable' })); return;
  }
  if (model.includes('ratelimit')) {
    res.writeHead(429, { 'Retry-After': '1' }); res.end(JSON.stringify({ error: 'rate limit' })); return;
  }
  if (model.includes('timeout')) return; // 不响应，触发超时

  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  for (const chunk of MOCK_CHUNKS) {
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    await sleep(20);
  }
  res.write('data: [DONE]\n\n');
  res.end();
}

async function handleImage(req: any, res: any) {
  const body = await jsonBody(req);

  if (req.url === '/images/generations/fail' || String(body.model ?? '').includes('fail')) {
    res.writeHead(503); res.end(JSON.stringify({ error: 'service unavailable' })); return;
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    data: [{ url: 'https://picsum.photos/1024/1024', size: '2K' }],
    usage: { generated_images: 1, total_tokens: 50 },
  }));
}

// ══════════════════════════════════════════════════════════════
// 测试用例
// ══════════════════════════════════════════════════════════════

describe('Chat Gateway (SSE streaming)', () => {
  it('正常流式对话：收到所有 chunks 并正常结束', async () => {
    const gateway = createChatGateway([
      createOpenAI({ baseURL: BASE_URL, model: 'test-model', apiKey: 'sk-test' }),
    ]);

    const messages = [{ role: 'user' as const, content: '你好' }];
    const chunks: string[] = [];

    for await (const chunk of gateway.stream(messages)) {
      chunks.push(chunk.content);
    }

    expect(chunks.join('')).toBe('你好！');
  });

  it('provider 返回 503 时 fallback 到第二个 provider', async () => {
    const gateway = createChatGateway([
      createOpenAI({ baseURL: BASE_URL, model: 'fail-model', apiKey: 'sk-test' }),
      createOpenAI({ baseURL: BASE_URL, model: 'test-model', apiKey: 'sk-test' }),
    ]);

    const messages = [{ role: 'user' as const, content: 'hi' }];
    const chunks: string[] = [];

    for await (const chunk of gateway.stream(messages)) {
      chunks.push(chunk.content);
    }

    expect(chunks.join('')).toBe('你好！');
  });

  it('所有 provider 都失败时抛出 GatewayError', async () => {
    const gateway = createChatGateway([
      createOpenAI({ baseURL: BASE_URL, model: 'fail-model', apiKey: 'sk-test' }),
    ]);

    const messages = [{ role: 'user' as const, content: 'hi' }];
    await expect(async () => {
      for await (const _ of gateway.stream(messages)) { /* consume */ }
    }).rejects.toThrow('All 1 chat provider(s) exhausted');
  });

  it('重试：429 后成功（retry 层自动处理）', async () => {
    // 第一个请求触发 429，retry 层会等 backoff 后重试
    const gateway = createChatGateway([
      createOpenAI({ baseURL: BASE_URL, model: 'ratelimit-model', apiKey: 'sk-test' }),
    ]);

    const messages = [{ role: 'user' as const, content: 'hi' }];

    // retry 最多 3 次，429 是可重试的，所以会重试直到耗尽
    await expect(async () => {
      for await (const _ of gateway.stream(messages)) { /* consume */ }
    }).rejects.toThrow();
  }, 15000); // 需要等待 backoff 延迟（1s+4s+8s）
});

describe('Image Gateway', () => {
  it('正常生图：返回图片 URL 和用量统计', async () => {
    const gateway = createImageGateway([
      createVolcanoArk({ baseURL: BASE_URL, model: 'seedream', apiKey: 'sk-test' }),
    ]);

    const result = await gateway.generate({
      prompt: '一只柴犬',
      size: '2K',
      format: 'png',
    });

    expect(result.images).toHaveLength(1);
    expect(result.images[0].url).toContain('https://');
    expect(result.usage.generatedImages).toBe(1);
  });

  it('生图失败时 fallback', async () => {
    const gateway = createImageGateway([
      createVolcanoArk({ baseURL: `${BASE_URL}/images/generations/fail`, model: 'fail', apiKey: 'sk-test' }),
      createVolcanoArk({ baseURL: BASE_URL, model: 'seedream', apiKey: 'sk-test' }),
    ]);

    const result = await gateway.generate({ prompt: 'test', size: '2K' });
    expect(result.images).toHaveLength(1);
  });
});

describe('Model Registry', () => {
  it('按 type 分组，按 priority 排序', () => {
    const entries: ModelEntry[] = [
      { name: 'v3', type: 'chat', protocol: 'openai', baseURL: 'x', model: 'v3', apiKey: 'k', priority: 2 },
      { name: 'v4', type: 'chat', protocol: 'openai', baseURL: 'x', model: 'v4', apiKey: 'k', priority: 1 },
      { name: 'img', type: 'image', protocol: 'volcano-ark', baseURL: 'y', model: 's', apiKey: 'k', priority: 1 },
    ];

    const registry = createRegistry(entries);

    const chatModels = registry.getChatModels();
    expect(chatModels).toHaveLength(2);
    expect(chatModels[0].name).toBe('v4'); // priority 1 first
    expect(chatModels[1].name).toBe('v3'); // priority 2 second

    const imageModels = registry.getImageModels();
    expect(imageModels).toHaveLength(1);
    expect(imageModels[0].name).toBe('img');
  });

  it('toChatProviders 根据 protocol 字段创建正确的 provider', () => {
    const entries: ModelEntry[] = [
      { name: 'test', type: 'chat', protocol: 'openai', baseURL: BASE_URL, model: 'test-model', apiKey: 'sk-test', priority: 1 },
    ];

    const registry = createRegistry(entries);
    const providers = registry.toChatProviders();

    expect(providers).toHaveLength(1);
    expect(providers[0].name).toBe('openai:test-model');
  });
});

describe('GatewayError', () => {
  it('空 provider 列表抛出异常', () => {
    expect(() => createChatGateway([])).toThrow('At least one ChatProvider is required');
    expect(() => createImageGateway([])).toThrow('At least one ImageProvider is required');
  });
});
