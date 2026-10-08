/**
 * dev API 服务 —— 壳与管线之间的「传令兵」(第 1 步)
 *
 * 职责只有三件事:
 *   1. run  : spawn `run-ts.mjs <步骤脚本>` 跑一步,stdout/stderr 逐行以 SSE 推给前端
 *   2. steps: 列出可跑的步骤(前端按钮的单一数据源,和这里注册的完全一致)
 *   3. artifacts: 产物清单(第 0 步从 vite.config 挪过来,后端接口归拢到这一处)
 *
 * 运行:
 *   npm run dev:api          ← 手动单跑(调它时建议开两个终端)
 *   npm run dev              ← vite 启动时探测 :8787,没起来就自动拉起(见 vite.config.ts)
 *
 * 浏览器侧经 vite proxy /api → :8787 访问,同源无 CORS。
 *
 * ⚠️ 为什么用 process.cwd() 而不是 import.meta.url 定位项目根:
 *   本文件经 run-ts.mjs 打包到 .tmp-run/ 再执行,bundle 里 import.meta.url
 *   指向 .tmp-run/ 而不是项目根;cwd 才是可靠的(npm run 从项目根发起)。
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.PORT) || 8787;
/** 步骤硬超时:超过即强杀。防手滑写出死循环步骤后无人值守烧 API 钱 */
const STEP_TIMEOUT_MS = 10 * 60_000;

// ── 步骤注册表(唯一数据源:前端按钮从这里来) ──

interface StepDef {
  id: string;
  label: string;
  description: string;
  /** 参数框的占位示例:等于终端里 `--` 后面要敲的东西。空 = 不需要参数 */
  argsHint: string;
  script: string;
  buildArgs: (q: URLSearchParams) => string[];
}

/** 通用透传:前端参数框的内容,按空格切分,原样附加到 spawn 参数尾部。
 *  spawn 不经 shell,参数是字面量,不存在命令拼接;等价于用户在终端手敲。 */
function rawArgs(q: URLSearchParams): string[] {
  return (q.get('args') ?? '').trim().split(/\s+/).filter(Boolean);
}

const STEPS: StepDef[] = [
  {
    id: 'step-01-perceive',
    label: '01 · 图像识别',
    description: '产品照 → 结构化可见事实 JSON。不填参数用当前默认产品照。',
    argsHint: '可选:换个图片路径',
    script: 'src/workflow/steps/step-01-perceive.ts',
    buildArgs: (q) => {
      const image = q.get('image');
      return [...(image ? [image] : []), ...rawArgs(q)];
    },
  },
  {
    id: 'step-02-claims',
    label: '02 · 卖点审计',
    description: 'listing 卖点 → 要素级证据审计(给 03 消费)。消费 01 的输出(step-01.json 同目录)。',
    argsHint: 'test_product/shirt/step-01.json --bullets test_product/shirt/童装卖点.txt --lang en',
    script: 'src/workflow/steps/step-02-claims.ts',
    buildArgs: rawArgs,
  },
  {
    id: 'step-03-slots',
    label: '03 · 套图规划',
    description: '卖点审计 → 每张图回答什么购买问题(给 04 消费)。消费 02 的输出(step-02.json 同目录)。',
    argsHint: 'test_product/shirt/step-02.json --bullets test_product/shirt/童装卖点.txt --lang en',
    script: 'src/workflow/steps/step-03-slots.ts',
    buildArgs: rawArgs,
  },
  {
    id: 'step-04-brief',
    label: '04 · 方案编写',
    description: '规划+卖点+事实 → 每个副图位的创意方案 md(test_product/briefs/)。全部槽位较贵,建议先 --only 单跑。',
    argsHint: '--bullets test_product/shirt/童装卖点.txt --only PT01',
    script: 'src/workflow/steps/step-04-brief.ts',
    buildArgs: rawArgs,
  },
  {
    id: 'step-05-appearance',
    label: '05 · 外观编译',
    description: '版式+方案+产品照 → 专属配色 design-appearance.json(多轮 LLM+视觉验收,较慢)。',
    argsHint: 'test_product/layout/shirt-PT01/design-sketch.json --brief test_product/briefs/shirt-PT01.md',
    script: 'src/workflow/steps/step-05-appearance.ts',
    buildArgs: rawArgs,
  },
  {
    id: 'step-order',
    label: '06 · 素材订单',
    description: '版式+方案 → assets.json(生图提示词+参考图角色,gen 阶段的前置)。',
    argsHint: 'test_product/layout/shirt-PT01/design-sketch.json --brief test_product/briefs/shirt-PT01.md',
    script: 'src/workflow/steps/step-order.ts',
    buildArgs: rawArgs,
  },
  {
    id: 'step-layout',
    label: '07 · 出图',
    description: '吃版式规格出图:sketch 草图(零 API,秒出)/ gen 生素材(烧钱)/ final 成品。spec 必填。',
    argsHint: 'test_product/layout/shirt-PT01/design-sketch.json sketch --no-library',
    script: 'src/workflow/steps/step-layout.ts',
    buildArgs: rawArgs,
  },
];

// ── 产物清单(自 vite.config.ts 迁入;final.png 优先) ──

const PNG_PRIORITY = ['final.png', 'sketch.png'];

/**
 * 版式编辑数据链路(前端逐元素编辑的持久层):
 *   GET  /api/layout/<name>/data   → { spec, appearance, html }(linked.html 原文)
 *   POST /api/layout/<name>/save   → body { spec?, appearance? } 写盘
 *   POST /api/layout/<name>/render → spawn step-layout final(纯重渲,零 API 成本)
 * name 只允许字母数字横线下划线,防路径穿越。
 */
async function handleLayout(
  req: IncomingMessage,
  res: ServerResponse,
  rest: string,
  sessionId: string | null,
) {
  // 目录名可能含点号(取自图片文件名,如 61bIICZBYDL._AC_SL1500_-PT01)——
  // 只禁斜体与 .. ,再用 resolve 后的前缀校验做根本性防穿越
  const m = /^([^/\\]+)\/(data|save|render)$/.exec(rest);
  // 会话带工作目录 → layoutsRoot = <workDir>/designs;否则旧约定
  const sessionRoot = sessionId ? join(await transcript.getWorkDir(sessionId), 'designs') : null;
  const LAYOUT_ROOT = sessionRoot ?? resolve('test_product/layout');
  const name = m?.[1] ?? '';
  const dir = resolve(LAYOUT_ROOT, name);
  if (
    !m ||
    name.includes('..') ||
    !dir.startsWith(LAYOUT_ROOT + sep)
  ) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('bad layout path');
  }
  const action = m[2];
  const specPath = join(dir, 'design-sketch.json');
  const appPath = join(dir, 'design-appearance.json');

  if (req.method === 'GET' && action === 'data') {
    if (!existsSync(specPath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(`no spec: ${name}`);
    }
    const spec = JSON.parse(readFileSync(specPath, 'utf8'));
    const appearance = existsSync(appPath)
      ? JSON.parse(readFileSync(appPath, 'utf8'))
      : {};
    // ⚠️ html **始终现场生成**,不读 final.linked.html——那个文件是渲染快照,
    // 可能带着独立编辑器的注入残留;残留脚本与 React 下发的受控编辑器同屏
    // 会互相吞事件(实测:点选/拖拽全部失效)。spec 才是编辑的数据源。
    const { renderDesign } = await import('../workflow/design-sketch/render');
    const { applyAppearance } = await import('../workflow/design-sketch/design-appearance');
    const { loadAppearance, loadPalette, loadTypography } = await import(
      '../workflow/design-sketch/runtime'
    );
    const app2 = loadAppearance(specPath);
    const merged = {
      ...spec,
      layers: applyAppearance(spec.layers, app2),
    } as typeof spec;
    const rendered = renderDesign(merged, {
      mode: 'final',
      palette: loadPalette((app2.palette as string) ?? 'warm-copper'),
      typography: loadTypography((app2.fontScheme as string) ?? 'legacy-system'),
    });
    // {{KEY}} → 素材文件名(相对路径,由 /files 静态服务提供)
    let html = rendered.html.replace(
      /\{\{(\w+)\}\}/g,
      (key: string) => (rendered.assets as Record<string, string>)[key.slice(2, -2)] ?? key,
    );
    // 防御:即使未来读文件,也剥掉一切历史注入
    const s0 = html.indexOf('<!--vinart-editor-start-->');
    if (s0 >= 0) {
      const e0 = html.indexOf('<!--vinart-editor-end-->', s0);
      if (e0 >= 0) html = html.slice(0, s0) + html.slice(e0 + '<!--vinart-editor-end-->'.length);
    }
    html = html.replace(
      /<script type="application\/json" id="__vinart-data">[\s\S]*?<\/script>\s*/g,
      '',
    );
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ name, spec, appearance, html }));
  }

  if (req.method === 'POST' && action === 'save') {
    let body = '';
    req.on('data', (c: Buffer) => (body += c));
    req.on('end', () => {
      try {
        const payload = JSON.parse(body) as { spec?: unknown; appearance?: unknown };
        mkdirSync(dir, { recursive: true });
        if (payload.spec) {
          writeFileSync(specPath, JSON.stringify(payload.spec, null, 2) + '\n', 'utf8');
        }
        if (payload.appearance) {
          writeFileSync(appPath, JSON.stringify(payload.appearance, null, 2) + '\n', 'utf8');
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`save failed: ${(e as Error).message}`);
      }
    });
    return;
  }

  if (req.method === 'POST' && action === 'render') {
    if (running) {
      res.writeHead(409, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(`已有任务在跑: ${running.stepId}`);
    }
    if (!existsSync(specPath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(`no spec: ${name}`);
    }
    console.log(`[render] ${name} → final`);
    const child = spawn(
      process.execPath,
      [
        'scripts/run-ts.mjs',
        'src/workflow/steps/step-layout.ts',
        `test_product/layout/${name}/design-sketch.json`,
        'final',
        '--no-library',
      ],
      { cwd: process.cwd(), windowsHide: true },
    );
    running = { stepId: `render:${name}`, child };
    let out = '';
    const collect = (d: Buffer) => (out += d.toString());
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    const done = (code: number | null) => {
      running = null;
      console.log(`[render] exit=${code}`);
      res.writeHead(code === 0 ? 200 : 500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: code === 0, log: out.slice(-2000) }));
    };
    child.on('exit', done);
    child.on('error', (e) => {
      running = null;
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, log: String(e) }));
    });
    return;
  }

  res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('method not allowed');
}

/**
 * 会话层 API:
 *   GET    /api/sessions                → 索引(列表)
 *   POST   /api/sessions                → 新建 → { id }
 *   GET    /api/sessions/:id            → { id, events, messages, title }
 *   DELETE /api/sessions/:id            → 删除
 *   POST   /api/sessions/:id/events     → 追加事件(消息/操作)
 *   POST   /api/sessions/:id/chat       → { text } → SSE 流式 LLM 对话,完成后落盘
 */
async function handleSessions(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  method: string,
) {
  const JSON_HDR = { 'Content-Type': 'application/json; charset=utf-8' };
  const sessionIdMatch =
    /^\/api\/sessions\/([\w.-]+)(?:\/(events|chat|artifacts|workdir|file)(?:\/(.*))?)?$/.exec(path);

  // 列表
  if (path === '/api/sessions' && method === 'GET') {
    res.writeHead(200, JSON_HDR);
    return res.end(JSON.stringify(await transcript.listSessions()));
  }
  // 新建
  if (path === '/api/sessions' && method === 'POST') {
    const id = await transcript.createSession();
    res.writeHead(200, JSON_HDR);
    return res.end(JSON.stringify({ id }));
  }

  if (!sessionIdMatch) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('bad session path');
  }
  const sessionId = sessionIdMatch[1];
  const sub = sessionIdMatch[2];

  // 读单会话
  if (!sub && method === 'GET') {
    const events = await transcript.loadTranscript(sessionId);
    const workDir = await transcript.getWorkDir(sessionId);
    res.writeHead(200, JSON_HDR);
    return res.end(
      JSON.stringify({
        id: sessionId,
        events,
        messages: await transcript.deriveMessages(events, workDir),
        title: transcript.deriveTitle(events),
      }),
    );
  }
  // 删除
  if (!sub && method === 'DELETE') {
    await transcript.deleteSession(sessionId);
    dropChatSession(sessionId);
    res.writeHead(200, JSON_HDR);
    return res.end(JSON.stringify({ ok: true }));
  }
  // ── 工作目录:设置(📂)与读取 ──
  if (sub === 'workdir' && method === 'POST') {
    const body = (await readJsonBody(req)) as { workDir?: string };
    const dir = String(body.workDir ?? '').trim();
    if (!dir) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('缺少 workDir');
    }
    const abs = await transcript.setWorkDir(sessionId, dir);
    res.writeHead(200, JSON_HDR);
    return res.end(JSON.stringify({ ok: true, workDir: abs }));
  }
  if (sub === 'workdir' && method === 'GET') {
    res.writeHead(200, JSON_HDR);
    return res.end(JSON.stringify({ workDir: await transcript.getWorkDir(sessionId) }));
  }

  // ── 产物清单(按会话工作目录;legacy 回退 test_product/layout)──
  if (sub === 'artifacts' && method === 'GET') {
    return handleArtifacts(res, sessionId);
  }

  // ── 工作目录内文件流式服务(iframe 素材/缩略图的 base)──
  // 纯路径式:/api/sessions/<sid>/file/<rel...>。
  // 不要改成 ?rel= 查询串:<base href> 下的相对引用解析时
  // 会丢掉 base 的最后一段 path(file)且不继承 query,RFC 3986 §5.2.2。
  if (sub === 'file' && method === 'GET') {
    let rel: string;
    try {
      rel = (sessionIdMatch[3] ?? '').split('/').map(decodeURIComponent).join('/');
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('bad path');
    }
    const wd = await transcript.getWorkDir(sessionId);
    const abs = resolve(wd, rel);
    if (!abs.startsWith(wd + sep) || !existsSync(abs) || statSync(abs).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('not found');
    }
    const ext = abs.split('.').pop()?.toLowerCase() ?? '';
    const MIME: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      webp: 'image/webp',
      gif: 'image/gif',
      json: 'application/json',
      md: 'text/markdown',
      txt: 'text/plain',
    };
    res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
    return res.end(readFileSync(abs));
  }

  // 追加事件(编辑器操作与消息共用)
  if (sub === 'events' && method === 'POST') {
    const body = (await readJsonBody(req)) as Record<string, unknown>;
    const kind = body.kind as string;
    if (kind !== 'message' && kind !== 'action' && kind !== 'meta') {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('bad event kind');
    }
    await transcript.appendEvent(sessionId, {
      ...body,
      ts: String(body.ts ?? new Date().toISOString()),
    } as Parameters<typeof transcript.appendEvent>[1]);
    res.writeHead(200, JSON_HDR);
    return res.end(JSON.stringify({ ok: true }));
  }
  // LLM 对话(SSE 流式;完成后 user/assistant 消息落盘)
  if (sub === 'chat' && method === 'POST') {
    let body: { text?: string; activeLayout?: string; images?: string[] };
    try {
      // 96MB：覆盖单张 64MiB 图（Files API 上限）的 base64 ~86MB + JSON 余量。
      // chat 请求体本身已改走 file_id 引用，不受 DeepSeek 48MB 请求体限制约束，
      // 这个上限只管「前端→后端」这一跳的传输体积。
      body = (await readJsonBody(req, 96 * 1024 * 1024)) as {
        text?: string;
        activeLayout?: string;
        images?: string[];
      };
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(`请求体无效：${(e as Error).message}`);
    }
    const text = String(body.text ?? '').trim();
    const rawImages = Array.isArray(body.images) ? body.images : [];
    if (!text && rawImages.length === 0) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('缺少 text 或 images');
    }
    if (rawImages.length > 4) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('图片最多 4 张');
    }
    // 总量预检：readJsonBody 96MiB 兜底之前给一个明确错误（92MiB 留 JSON 结构余量）
    const totalB64 = rawImages.reduce((s, d) => s + String(d ?? '').length, 0);
    if (totalB64 > 92 * 1024 * 1024) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('图片总体积过大（base64 合计 >92MB）——前端应压缩后再传');
    }

    // 图片落盘到会话工作目录（大内容外置：transcript 只存相对路径+file_id，
    // 重放时 file 块直接引用，不再回读大文件）。放在 SSE 头之前做完——
    // 校验/上传失败直接 4xx/5xx，不留半截会话事件。
    // 单图阈值对齐 DeepSeek Files API：单文件 ≤64 MiB（api-docs.deepseek.com/guides/files_api）。
    const workDir = await transcript.getWorkDir(sessionId);
    const savedImages: string[] = [];
    const fileIds: string[] = [];
    const attachments: Attachment[] = [];
    const filesApi = getOpenAICompatChatConfig();
    for (const [i, du] of rawImages.entries()) {
      const m = /^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/.exec(String(du ?? ''));
      if (!m) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end(`第 ${i + 1} 张不是合法图片（需 dataURL image/png|jpeg|jpg|webp|gif）`);
      }
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length > FILES_API_MAX_BYTES) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end(`第 ${i + 1} 张超过 64 MiB（DeepSeek Files API 单文件上限，解码后 ${Math.round(buf.length / 1048576)}MB）`);
      }
      const ext = m[1] === 'png' ? 'png' : m[1] === 'webp' ? 'webp' : m[1] === 'gif' ? 'gif' : 'jpg';
      const rel = `uploads/chat-${Date.now()}-${i}.${ext}`;
      mkdirSync(resolve(workDir, 'uploads'), { recursive: true });
      writeFileSync(resolve(workDir, rel), buf);
      savedImages.push(rel);

      // 上传 Files API 拿 file_id——之后每轮对话（含历史重放）引用它，
      // 不再重传 base64。失败降级：≤32MiB 的图走内联 base64 照常发
      // （对话不被上传故障阻塞）；>32MiB 无降级路径，直接失败。
      let fileId: string | undefined;
      try {
        fileId = await uploadImageFile({
          ...filesApi,
          bytes: buf,
          filename: `chat-${i}.${ext}`,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (buf.length > 32 * 1024 * 1024) {
          res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
          return res.end(`第 ${i + 1} 张（${Math.round(buf.length / 1048576)}MB）上传 Files API 失败且超过 32MiB 无内联降级路径：${msg}`);
        }
        console.warn(`[chat] 第 ${i + 1} 张上传 Files API 失败，降级内联 base64：${msg}`);
      }
      fileIds.push(fileId ?? '');
      attachments.push({ name: rel, url: String(du), ...(fileId ? { fileId } : {}) });
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const send = (event: string, data: unknown) =>
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

    try {
      const session = getChatSession(sessionId);
      if (session.isStreaming) {
        send('error', { message: '该会话正在生成中' });
        return res.end();
      }
      const systemNote = await buildLayoutNote(sessionId, body.activeLayout as string | undefined);
      await transcript.appendEvent(sessionId, {
        ts: new Date().toISOString(),
        kind: 'message',
        id: `msg_${crypto.randomUUID().slice(0, 8)}`,
        role: 'user',
        text,
        ...(savedImages.length ? { images: savedImages, fileIds } : {}),
      } as Parameters<typeof transcript.appendEvent>[1]);

      for await (const chunk of session.send(text, attachments.length ? attachments : undefined, {
        systemNote,
        // 工具进度事件（子 agent spawn/result）→ SSE 'agent' 事件实时推前端委派卡片
        onEvent: (evt) => send('agent', evt),
      })) {
        if (chunk.content) send('chunk', { content: chunk.content });
      }

      // assistant 完整回复落盘(send 内部已 push 到历史)
      const msgs = session.messages;
      const last = msgs[msgs.length - 1];
      const full =
        last && last.role === 'assistant' && typeof last.content === 'string'
          ? last.content
          : '';
      if (full) {
        await transcript.appendEvent(sessionId, {
          ts: new Date().toISOString(),
          kind: 'message',
          id: `msg_${crypto.randomUUID().slice(0, 8)}`,
          role: 'assistant',
          text: full,
        });
      }
      send('done', { ok: true });
      res.end();
    } catch (e) {
      send('error', { message: String((e as Error).message ?? e) });
      res.end();
    }
    return;
  }

  res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('method not allowed');
}

/** 版式摘要 → systemNote 注入(让 LLM 知道「当前打开的版式」;每轮按最新状态重算) */
async function buildLayoutNote(sessionId: string, layoutName?: string | null): Promise<string> {
  if (!layoutName) return '';
  const wd = await transcript.getWorkDir(sessionId);
  const dir = join(wd, 'designs', layoutName);
  const specPath = join(dir, 'design-sketch.json');
  if (!existsSync(specPath)) return '';
  try {
    const spec = JSON.parse(readFileSync(specPath, 'utf8')) as {
      canvas: { width: number; height: number };
      layers: { id: string; type: string; text?: string | string[] }[];
    };
    const layers = spec.layers
      .map((l) => {
        const t = Array.isArray(l.text) ? l.text.join(' ') : (l.text ?? '');
        return `- ${l.id}(${l.type})${t ? `「${String(t).slice(0, 40)}」` : ''}`;
      })
      .join('\n');
    let appearanceNote = '';
    const appPath = join(dir, 'design-appearance.json');
    if (existsSync(appPath)) {
      const app = JSON.parse(readFileSync(appPath, 'utf8')) as {
        palette?: unknown;
        layers?: Record<string, { color?: string }>;
      };
      const colors = Object.entries(app.layers ?? {})
        .map(([k, v]) => `${k}=${v.color ?? '?'}`)
        .slice(0, 8)
        .join('、');
      appearanceNote = `\n外观(部分):${colors}`;
      void app.palette;
    }
    return (
      `【当前打开的版式】${layoutName}(${spec.canvas.width}×${spec.canvas.height})\n` +
      `图层:\n${layers}${appearanceNote}\n` +
      `用户说「标题/按钮/某个词」时,指的就是上面清单里的对应元素。`
    );
  } catch {
    return '';
  }
}

function handleArtifacts(res: ServerResponse, sessionId?: string | null) {
  void (async () => {
    const layoutsRoot = sessionId ? join(await transcript.getWorkDir(sessionId), 'designs') : resolve('test_product/layout');
    const layoutDir = layoutsRoot;
  const items = existsSync(layoutDir)
    ? readdirSync(layoutDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => {
          const abs = join(layoutDir, d.name);
          // 不在优先级表里的文件统一垫底(indexOf 会返回 -1,须映射掉)
          const rank = (f: string) => {
            const i = PNG_PRIORITY.indexOf(f);
            return i === -1 ? PNG_PRIORITY.length : i;
          };
          const files = readdirSync(abs).sort(
            (a, b) => rank(a) - rank(b) || a.localeCompare(b),
          );
          return {
            name: d.name,
            // root:前端拼产物 URL 的分支依据——session 走 file API,
            // legacy 走 /files/ 静态映射。dir 仅作展示/键用
            root: sessionId ? ('session' as const) : ('legacy' as const),
            dir: sessionId
              ? `@session/${sessionId}`
              : `test_product/layout/${d.name}`,
            layoutsRoot,
            pngs: files.filter((f) => f.endsWith('.png')),
            htmls: files.filter((f) => f.endsWith('.html')),
          };
        })
    : [];
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(items));
})().catch(() => {
  res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end('[]');
});
}

// ── 跑步骤:SSE ──

/** 同一时间只允许跑一步。步骤会烧 API 钱,并行互踩产物目录也没有意义 */
let running: { stepId: string; child: ChildProcess } | null = null;

function handleRun(req: IncomingMessage, res: ServerResponse, stepId: string, q: URLSearchParams) {
  const step = STEPS.find((s) => s.id === stepId);
  if (!step) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end(`unknown step: ${stepId}`);
  }
  if (running || pipelineActive) {
    res.writeHead(409, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end(`已有任务在跑${running ? `: ${running.stepId}` : '(一键编排)'}。等它结束再点。`);
  }

  // SSE 响应头。X-Accel-Buffering 让中间代理别攒缓冲(vite proxy 不会,但保险)
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (event: string, data: unknown) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const args = step.buildArgs(q);
  const display = `npm run step ${step.script}${args.length ? ' -- ' + args.join(' ') : ''}`;
  console.log(`[run] ${display}`);
  send('start', { step: step.id, label: step.label, cmd: display });

  const child = spawn(
    process.execPath,
    ['scripts/run-ts.mjs', step.script, ...args],
    { cwd: process.cwd(), windowsHide: true },
  );
  running = { stepId, child };

  // 行缓冲转发:chunk 可能只有半行,攒到 \n 再发
  let buf = '';
  const forward = (chunk: Buffer, isErr = false) => {
    buf += chunk.toString();
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, '');
      buf = buf.slice(i + 1);
      if (line) send('log', { line: isErr ? `[stderr] ${line}` : line });
    }
  };
  child.stdout?.on('data', (d: Buffer) => forward(d));
  child.stderr?.on('data', (d: Buffer) => forward(d, true));

  const timer = setTimeout(() => {
    send('log', { line: `⏱ 超过 ${STEP_TIMEOUT_MS / 60000} 分钟,强制终止` });
    child.kill();
  }, STEP_TIMEOUT_MS);

  child.on('exit', (code) => {
    clearTimeout(timer);
    running = null;
    console.log(`[run] ${step.id} 退出 (code=${code})`);
    send('exit', { code });
    res.end();
  });

  // 客户端断开(关标签页/点停止)→ 杀掉步骤。没人看的步骤不该继续烧钱
  req.on('close', () => {
    if (running?.child === child && !child.killed) {
      console.log(`[run] ${step.id} 客户端断开,终止步骤`);
      child.kill();
    }
  });
}

// ── 一键编排:产品图 + 卖点 → 自动跑完整链 ──
//
// 链:01 识别 → 02 审计 → 03 规划 → 04 方案 → compile(规格+素材订单,内挂)
//    → 07 出图(sketch 零 API / gen+final 烧钱)
// 编排只做 spawn 排队,跑的仍是 scripts/ 下的 CLI 薄壳——管线逻辑零旁路。

interface PipelineParams {
  name: string;
  lang: string;
  depth: 'sketch' | 'final';
  slot: string; // 'all' 或 'PT01' 这类槽位号
  imagePath: string;
  bulletsPath: string;
  /** 管线落盘根:会话工作目录(📂 设置)或缺省 test_product/<name> */
  workDir: string;
}

const pendingPipelines = new Map<string, PipelineParams>();
let pipelineActive = false;

function readJsonBody(req: IncomingMessage, maxBytes = 40 * 1024 * 1024): Promise<Record<string, unknown>> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > maxBytes) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

async function handlePipelinePost(req: IncomingMessage, res: ServerResponse) {
  try {
    const body = await readJsonBody(req);
    const name = String(body.name ?? '').trim().replace(/[^A-Za-z0-9._-]/g, '').slice(0, 40) || 'product';
    const m = /^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/.exec(String(body.image ?? ''));
    if (!m) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('缺少产品图(dataURL 格式 image/png|jpeg|webp)');
    }
    if (!String(body.bullets ?? '').trim()) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('缺少卖点文本');
    }
    const ext = m[1] === 'png' ? 'png' : m[1] === 'webp' ? 'webp' : 'jpg';
    // 管线产物落服务端 staging(test_product/<name>/)——前端负责搬运到用户所选目录
    const dir = resolve('test_product', name);
    // 落盘根:请求带 sessionId → 该会话的工作目录(📂);否则缺省 test_product/<name>
    const reqSessionId = typeof body.sessionId === 'string' && body.sessionId ? body.sessionId : null;
    const workDir = reqSessionId ? await transcript.getWorkDir(reqSessionId) : dir;
    mkdirSync(workDir, { recursive: true });
    const imagePath = resolve(workDir, `${name}.${ext}`);
    writeFileSync(imagePath, Buffer.from(m[2], 'base64'));
    const bulletsPath = resolve(workDir, 'selling-points.txt');
    writeFileSync(bulletsPath, String(body.bullets).trim() + '\n', 'utf8');

    const id = randomUUID();
    pendingPipelines.set(id, {
      name,
      lang: body.lang === 'de' ? 'de' : 'en',
      depth: body.depth === 'final' ? 'final' : 'sketch',
      slot: typeof body.slot === 'string' && /^PT\d{2}$/.test(body.slot) ? body.slot : 'all',
      imagePath,
      bulletsPath,
      workDir,
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id }));
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end((e as Error).message);
  }
}

/** spawn 一步并按 SSE 流式转发输出,resolve 退出码 */
function spawnPhase(
  script: string,
  args: string[],
  send: (event: string, data: unknown) => void,
  isAborted: () => boolean,
): Promise<number> {
  return new Promise((resolveCode) => {
    const display = `npm run step ${script}${args.length ? ' -- ' + args.join(' ') : ''}`;
    send('phase', { cmd: display });
    console.log(`[pipeline] ${display}`);
    const child = spawn(process.execPath, ['scripts/run-ts.mjs', script, ...args], {
      cwd: process.cwd(),
      windowsHide: true,
    });
    let buf = '';
    const forward = (chunk: Buffer, isErr = false) => {
      buf += chunk.toString();
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, '');
        buf = buf.slice(i + 1);
        if (line) send('log', { line: isErr ? `[stderr] ${line}` : line });
      }
    };
    child.stdout?.on('data', (d: Buffer) => forward(d));
    child.stderr?.on('data', (d: Buffer) => forward(d, true));
    const timer = setTimeout(() => child.kill(), 10 * 60_000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolveCode(code ?? -1);
    });
    if (isAborted() && !child.killed) child.kill();
  });
}

async function handlePipelineRun(res: ServerResponse, id: string, req: IncomingMessage) {
  const p = pendingPipelines.get(id);
  if (!p) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('pipeline 不存在(服务可能重启过,请重新提交)');
  }
  if (running || pipelineActive) {
    res.writeHead(409, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('已有任务在跑,等它结束再试');
  }
  pendingPipelines.delete(id);
  pipelineActive = true;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (event: string, data: unknown) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  let aborted = false;
  req.on('close', () => {
    aborted = true;
  });

  const facts = join(p.workDir, 'step-01.json');
  const claims = join(p.workDir, 'step-02.json');
  try {
    // ── 链 A 四步(中间产物全部进产品目录,互不覆盖)──
    const phases: { label: string; script: string; args: string[]; allowExit?: number[] }[] = [
      { label: '01 · 图像识别', script: 'src/workflow/steps/step-01-perceive.ts', args: [p.imagePath, '--out', facts] },
      {
        label: '02 · 卖点审计',
        script: 'src/workflow/steps/step-02-claims.ts',
        args: [facts, '--bullets', p.bulletsPath, '--lang', p.lang],
      },
      {
        label: '03 · 套图规划',
        script: 'src/workflow/steps/step-03-slots.ts',
        args: [claims, '--bullets', p.bulletsPath, '--lang', p.lang],
      },
      {
        label: '04 · 方案编写',
        script: 'src/workflow/steps/step-04-brief.ts',
        args: [
          '--facts', facts,
          '--workdir', p.workDir,
          '--bullets', p.bulletsPath, '--lang', p.lang, '--name', p.name,
          ...(p.slot === 'all' ? [] : ['--only', p.slot]),
        ],
        // 04 的 exit 2 = 部分槽位失败但成功的已落盘,允许继续
        allowExit: [0, 2],
      },
    ];

    for (const { label, script, args, allowExit } of phases) {
      send('log', { line: `───── ${label} ─────` });
      const code = await spawnPhase(script, args, send, () => aborted);
      if (aborted) break;
      if (code !== 0 && !(allowExit ?? [0]).includes(code)) {
        send('exit', { code, failed: label });
        return res.end();
      }
    }
    if (aborted) {
      send('exit', { code: -1, failed: '客户端断开' });
      return res.end();
    }

    // ── 找到 04 产出的 brief,逐份编译 + 出图 ──
    // briefs 落工作目录(workDir/briefs/);旧管线(无会话)兼容 test_product/briefs
    const briefsDir = join(p.workDir, 'briefs');
    const designsRoot = join(p.workDir, 'designs');
    const briefs = existsSync(briefsDir)
      ? readdirSync(briefsDir)
          .filter((f) => f.startsWith(`${p.name}-`) && f.endsWith('.md'))
          .sort()
      : [];
    if (!briefs.length) {
      send('log', { line: `✗ 没有找到任何 brief(${briefsDir}/${p.name}-*.md)` });
      send('exit', { code: 1, failed: '04 方案编写' });
      return res.end();
    }
    send('log', { line: `找到 ${briefs.length} 份方案:${briefs.join(', ')}` });

    for (const brief of briefs) {
      const briefPath = resolve(briefsDir, brief);
      const layoutName = brief.replace(/\.[^.]+$/, '');
      const specPath = resolve(designsRoot, layoutName, 'design-sketch.json');

      send('log', { line: `───── 编译版式 · ${layoutName} ─────` });
      let code = await spawnPhase(
        'src/workflow/design-sketch/compile.ts',
        [briefPath, '--product', p.imagePath, '--out', resolve(designsRoot, layoutName)],
        send,
        () => aborted,
      );
      if (aborted) break;
      if (code !== 0) {
        send('exit', { code, failed: `编译 ${layoutName}` });
        return res.end();
      }

      // sketch 深度:只渲草图(零 API,草图灰阶不需要外观);final 深度:外观编译 + 生素材 + 成品
      if (p.depth === 'final') {
        // ── 外观编译:专属配色(从产品照派生)。失败降级为默认配色继续出图 ──
        send('log', { line: `───── 外观编译 · ${layoutName}(专属配色) ─────` });
        code = await spawnPhase(
          'src/workflow/steps/step-05-appearance.ts',
          [specPath, '--brief', briefPath, '--product', p.imagePath],
          send,
          () => aborted,
        );
        if (aborted) break;
        if (code !== 0) {
          send('log', {
            line: `⚠️ 外观编译失败,该张将以默认配色出图(可稍后单跑 step-05 补)`,
          });
        }

        // --out 覆盖:成品/素材落工作目录 designs/<name>(spec 也在同目录)
        const layoutArgs = [specPath, 'gen', 'final', '--product', p.imagePath, '--out', resolve(designsRoot, layoutName)];
        send('log', { line: `───── 出成品图 · ${layoutName}(含 AI 生图) ─────` });
        code = await spawnPhase('src/workflow/steps/step-layout.ts', layoutArgs, send, () => aborted);
      } else {
        const layoutArgs = [specPath, 'sketch', '--no-library', '--out', resolve(designsRoot, layoutName)];
        send('log', { line: `───── 渲草图 · ${layoutName}(零 API) ─────` });
        code = await spawnPhase('src/workflow/steps/step-layout.ts', layoutArgs, send, () => aborted);
      }
      if (aborted) break;
      if (code !== 0) {
        send('exit', { code, failed: `出图 ${layoutName}` });
        return res.end();
      }
    }

    send('log', { line: `✓ 全链完成。产物在工作目录:` });
    send('exit', { code: 0 });
    res.end();
  } finally {
    pipelineActive = false;
  }
}

import * as transcript from '../designharness/session/transcript';
import { getChatSession, dropChatSession } from '../designharness/session/chat-store';
import type { Attachment } from '../designharness/gateway/type/chat';
import { uploadImageFile, FILES_API_MAX_BYTES } from '../designharness/gateway/util/files-api';
import { getOpenAICompatChatConfig } from '../config';

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;

  if (path === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, steps: STEPS.length }));
  }
  if (path === '/api/steps') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(
      JSON.stringify(
        STEPS.map(({ id, label, description, argsHint }) => ({
          id,
          label,
          description,
          argsHint,
        })),
      ),
    );
  }

  // ── 目录浏览(DSH 式):后端列目录,前端渲染应用内浏览器 ──
  // 相比系统对话框的优势:不依赖服务进程的桌面环境,必定能弹;路径由后端确认返回
  if (path === '/api/fs/list' && req.method === 'POST') {
    const body = (await readJsonBody(req)) as { dir?: string };
    const dir = String(body.dir ?? '').trim();
    const JSON_HDR_FS = { 'Content-Type': 'application/json; charset=utf-8' };
    // 未给路径 = 列盘符(Windows 起步视图)
    if (!dir) {
      const drives: string[] = [];
      for (const c of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
        const root = `${c}:\\`;
        if (existsSync(root)) drives.push(root);
      }
      res.writeHead(200, JSON_HDR_FS);
      return res.end(JSON.stringify({ current: '', entries: drives.map((d) => ({ name: d, kind: 'dir' })), isDriveList: true }));
    }
    const target = resolve(dir);
    if (!existsSync(target) || !statSync(target).isDirectory()) {
      res.writeHead(400, JSON_HDR_FS);
      return res.end(JSON.stringify({ error: '目录不存在' }));
    }
    try {
      const entries = readdirSync(target, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
        .map((d) => ({ name: d.name, kind: 'dir' as const }))
        .sort((a, b) => a.name.localeCompare(b.name));
      const parent = dirname(target);
      res.writeHead(200, JSON_HDR_FS);
      return res.end(JSON.stringify({
        current: target,
        entries,
        parent: parent.startsWith(target) ? null : parent, // 已到根则无上级
        isDriveList: false,
      }));
    } catch (e) {
      res.writeHead(200, JSON_HDR_FS);
      return res.end(JSON.stringify({ current: target, entries: [], error: `无法读取:${(e as Error).message}` }));
    }
  }
  if (path === '/api/fs/mkdir' && req.method === 'POST') {
    const body = (await readJsonBody(req)) as { parent?: string; name?: string };
    const parent = resolve(String(body.parent ?? ''));
    const name = String(body.name ?? '').trim();
    if (!name || /[\\/:*?"<>|]/.test(name) || name.startsWith('.')) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('非法目录名');
    }
    const created = join(parent, name);
    if (!existsSync(parent)) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('父目录不存在');
    }
    mkdirSync(created, { recursive: true });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ path: created }));
  }

  if (path === '/api/artifacts') return handleArtifacts(res, url.searchParams.get('session'));
  if (path.startsWith('/api/layout/')) {
    return await handleLayout(req, res, path.slice('/api/layout/'.length), url.searchParams.get('session'));
  }
  if (path === '/api/sessions' || path.startsWith('/api/sessions/')) {
    return await handleSessions(req, res, path, req.method ?? 'GET');
  }
  if (path.startsWith('/api/run/')) {
    return handleRun(req, res, path.slice('/api/run/'.length), url.searchParams);
  }
  if (path === '/api/pipeline' && req.method === 'POST') {
    return void handlePipelinePost(req, res);
  }
  if (path.startsWith('/api/pipeline-run/') && req.method === 'GET') {
    return void handlePipelineRun(res, path.slice('/api/pipeline-run/'.length), req);
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('not found');
});

server.listen(PORT, () => {
  console.log(`API server 已启动: http://localhost:${PORT}`);
  console.log(`已注册步骤: ${STEPS.map((s) => s.id).join(', ')}`);
});
