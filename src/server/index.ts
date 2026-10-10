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
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const PORT = Number(process.env.PORT) || 8787;

const PNG_PRIORITY = ['final.png', 'sketch.png'];

/**
 * 版式编辑数据链路(前端逐元素编辑的持久层):
 *   GET  /api/layout/<name>/data   → { name, spec, appearance, html }
 *   POST /api/layout/<name>/save   → body { spec?, appearance? } 写盘
 *   POST /api/layout/<name>/render → 复用聊天链的 render_design 工具(零模型调用)
 * name 只允许字母数字横线下划线,防路径穿越。
 *
 * ⚠️ **三个动作都必须带 `?session=`**（render 必须有会话，save/data 建议带）。
 * 带会话 → 落 <workDir>/designs/<name>/（一个工作目录就是一个项目）；
 * 不带会话 → 退回仓库硬编码 test_product/layout/<name>（旧静态资源模式）。
 * 历史事故:客户端只有 data 带、save/render 没带 → 保存到仓库副本,
 * 结果「改了、保存了、项目里的图没变」。客户端拼 URL 统一走 App 的 layoutApiUrl()。
 */
// 渲染互斥:同一时间只允许一个渲染任务(历史:run/pipeline/render 共用)
let running: { stepId: string } | null = null;

async function handleLayout(
  req: IncomingMessage,
  res: ServerResponse,
  rest: string,
  sessionId: string | null,
) {
  // 目录名可能含点号(取自图片文件名,如 61bIICZBYDL._AC_SL1500_-PT01)——
  // 只禁斜体与 .. ,再用 resolve 后的前缀校验做根本性防穿越
  const m = /^([^/\\]+)\/(data|save|render)$/.exec(rest);
  const name = m?.[1] ?? '';
  // 会话模式 layoutsRoot = <workDir>/designs；无 session → 仓库旧约定 test_product/layout
  let LAYOUT_ROOT = resolve('test_product/layout');
  const workDir = sessionId ? await transcript.getWorkDir(sessionId) : null;
  if (sessionId && workDir) LAYOUT_ROOT = join(workDir, 'designs');
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
    // ⚠️ html **始终现场生成**——不从任何落盘快照读。这样编辑视图永远与
    // spec + appearance 一致；落盘快照（final.html / final.linked.html）已于
    // 2026-10-09 删除，那条路整个消失。spec 才是编辑的数据源。
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
    // {{KEY}} → file API 绝对路径（多根解析：版式目录 → 工作目录）。
    // 旧写法是文件名 + base tag（designs/<name>/）——素材在 designs/ 里、
    // 贴图在 uploads/ 里，固定 base 必 404（可编辑视图图片全空的实锤根因）。
    const assetRoots = [dir, ...(workDir ? [workDir] : [])];
    const html = rendered.html.replace(
      /\{\{(\w+)\}\}/g,
      (key: string) => {
        const filename = (rendered.assets as Record<string, string>)[key.slice(2, -2)] ?? key;
        for (const r of assetRoots) {
          const p = resolve(r, filename);
          if (existsSync(p)) {
            if (sessionId && workDir) {
              const rel = relative(workDir, p).split(sep).join('/');
              return `/api/sessions/${sessionId}/file/${rel}`;
            }
            return `/files/${relative(dir, p).split(sep).join('/')}`; // legacy 静态映射
          }
        }
        return filename;
      },
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
    if (!sessionId) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('render 需要会话:请带 ?session=<id>');
    }
    if (running) {
      res.writeHead(409, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(`已有任务在跑: ${running.stepId}`);
    }
    if (!existsSync(specPath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(`no spec: ${name}`);
    }
    console.log(`[render] ${name} → final`);
    running = { stepId: `render:${name}` };
    try {
      // ⚠️ 复用聊天链的 render_design 工具，**不再自己 spawn step-layout**：
      // 此前两条渲染实现不一致——step-layout 侧不传 searchRoots（工作目录相对的
      // 贴图素材解析不到）、且规格路径硬编码 test_product/layout/<name>；
      // 而聊天链的 render_design 用共享渲染器 + [workDir, 项目根] 回退根 + 校验。
      // 入口唯一化后，网页点「重渲」与让 AI 重渲走同一份逻辑。
      const result = await createRenderDesignTool({ sessionId }).execute(
        { name },
        { dir, signal: new AbortController().signal },
      );
      res.writeHead(result.isError ? 500 : 200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: !result.isError, log: result.content }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, log: String(e) }));
    } finally {
      running = null;
    }
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

  // 列表：一级分组——条目带 home（= 工作目录 = 项目根），前端按它分组
  if (path === '/api/sessions' && method === 'GET') {
    res.writeHead(200, JSON_HDR);
    return res.end(JSON.stringify(await transcript.listSessions()));
  }
  // 新建（**惰性**：只分配 id + 登记落点，不落盘、不写索引）
  // workDir 必填——会话跟着工作目录走，没选目录不允许开始对话。
  if (path === '/api/sessions' && method === 'POST') {
    const body = (await readJsonBody(req).catch(() => ({}))) as { workDir?: string };
    const dir = String(body.workDir ?? '').trim();
    if (!dir) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('缺少 workDir——会话必须绑定工作目录（先选目录再开始对话）');
    }
    const id = await transcript.createSession(dir);
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
  // 删除（流式中拒绝——生成到一半的对话删了等于白烧钱，且 abort 时序不可控）
  if (!sub && method === 'DELETE') {
    if (isSessionStreaming(sessionId)) {
      res.writeHead(409, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('该会话正在生成中——先点停止，等流结束再删除');
    }
    await transcript.deleteSession(sessionId);
    dropChatSession(sessionId);
    res.writeHead(200, JSON_HDR);
    return res.end(JSON.stringify({ ok: true }));
  }
  // ── 工作目录:设置(📂)与读取 ──
  // 会话的工作目录在创建时绑定、之后不可更改（换目录 = 新开会话）——只有尚未落盘的
  // 惰性会话能改，已绑定的返回 409。
  if (sub === 'workdir' && method === 'POST') {
    const body = (await readJsonBody(req)) as { workDir?: string };
    const dir = String(body.workDir ?? '').trim();
    if (!dir) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('缺少 workDir');
    }
    let abs: string;
    try {
      abs = await transcript.setWorkDir(sessionId, dir);
    } catch (e) {
      res.writeHead(409, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end((e as Error).message);
    }
    res.writeHead(200, JSON_HDR);
    return res.end(JSON.stringify({ ok: true, workDir: abs }));
  }
  if (sub === 'workdir' && method === 'GET') {
    res.writeHead(200, JSON_HDR);
    return res.end(JSON.stringify({ workDir: await transcript.getWorkDir(sessionId) }));
  }

  // ── 产物清单(只列会话工作目录的 designs)──
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
    // 贴图=产品照，落会话工作目录的 uploads/（<workDir>/uploads/）——
    // 一个工作目录就是一个项目，rel 相对 workDir，重放零改动。
    const workDir = await transcript.getWorkDir(sessionId);
    const uploadsBase = resolve(workDir, 'uploads');
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
      mkdirSync(uploadsBase, { recursive: true });
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
      const systemNote = await buildSystemNote(sessionId, body.activeLayout as string | undefined);
      await transcript.appendEvent(sessionId, {
        ts: new Date().toISOString(),
        kind: 'message',
        id: `msg_${crypto.randomUUID().slice(0, 8)}`,
        role: 'user',
        text,
        ...(savedImages.length ? { images: savedImages, fileIds } : {}),
      } as Parameters<typeof transcript.appendEvent>[1]);

      // tool-call 落账 promise 收集：流结束先等账本落齐再发 done——
      // 否则「对话刚结束就刷新会话」可能与写盘竞态，账本读到不完整
      const pendingWrites: Promise<void>[] = [];
      for await (const chunk of session.send(text, attachments.length ? attachments : undefined, {
        systemNote,
        // 进度事件分流：子 agent spawn/result → 'agent'（委派卡片）；
        // kind:'tool-call'（主 AI 工具循环中间轮）→ 落转录账本 + 'tool' 实时推——
        // 不落账的话刷新会话后「AI 调过工具」完全蒸发；不进模型上下文，纯审计
        // kind:'artifacts'（工具产出新图）→ 'artifacts'（前端实时刷 gallery）
        onEvent: (evt) => {
          if (evt.kind === 'tool-call') {
            pendingWrites.push(
              transcript.appendEvent(sessionId, {
                ts: new Date().toISOString(),
                kind: 'action',
                action: 'tool-call',
                detail: evt,
              } as Parameters<typeof transcript.appendEvent>[1]),
            );
            send('tool', evt);
          } else if (evt.kind === 'artifacts') send('artifacts', evt);
          else send('agent', evt);
        },
      })) {
        if (chunk.content) send('chunk', { content: chunk.content });
      }
      await Promise.all(pendingWrites);

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

/**
 * systemNote 组装：skill 目录（稳定，放前面保 cache 前缀）+ 版式摘要（易变，放后面）。
 * 两段都可能为空；拼接顺序固定——skill 集合不变则目录字节不变，前缀照常命中。
 */
async function buildSystemNote(sessionId: string, layoutName?: string | null): Promise<string> {
  const workDir = await transcript.getWorkDir(sessionId);
  const catalog = renderSkillCatalog(workDir);
  const layoutNote = await buildLayoutNote(sessionId, layoutName);
  return [catalog, layoutNote].filter(Boolean).join('\n\n');
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

/**
 * 产物清单(**按会话**——唯一入口是 `/api/sessions/<sid>/artifacts`)。
 * 只列当前项目的 designs（gallery 跟随项目走，切项目即切清单——不聚合其他项目）；
 * 未设置项目 → 旧约定 `<workDir>/designs`（历史数据兼容）。
 *
 * 曾经的 `/api/artifacts`(无会话 → 扫硬编码 `test_product/layout`)已删除：
 * 那条路忽略 workDir、且客户端 `itemUrl` 少拼一段 `<name>` 拼不出可用缩略图
 * （2026-10-09 移除，见 .workbuddy/memory/2026-10-09.md）。
 */
function handleArtifacts(res: ServerResponse, sessionId: string) {
  void (async () => {
    const workDir = await transcript.getWorkDir(sessionId);
    const items = scanArtifactRoot(join(workDir, 'designs'));
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(items));
  })().catch(() => {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end('[]');
  });
}

/** 扫一个 layouts 根目录 → 产物条目（PNG 排序：final > sketch > 其他） */
function scanArtifactRoot(layoutsRoot: string) {
  if (!existsSync(layoutsRoot)) return [];
  return readdirSync(layoutsRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const abs = join(layoutsRoot, d.name);
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
        layoutsRoot, // 前端用它 + name 组成卡片 key（唯一标识）
        pngs: files.filter((f) => f.endsWith('.png')),
        htmls: files.filter((f) => f.endsWith('.html')),
      };
    });
}

//
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


import * as transcript from '../designharness/session/transcript';
import { renderSkillCatalog } from '../designharness/skills/registry';
import { getChatSession, dropChatSession, isSessionStreaming } from '../designharness/session/chat-store';
import type { Attachment } from '../designharness/gateway/type/chat';
import { uploadImageFile, FILES_API_MAX_BYTES } from '../designharness/gateway/util/files-api';
// 重渲复用聊天链的成品渲染工具（/api/layout/<name>/render）——见该工具顶部注释
import { createRenderDesignTool } from '../designharness/tools/render-design';
import { getChatModelNames, getOpenAICompatChatConfig } from '../config';

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;

  if (path === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }

  // 已注册的模型（来自 keys.json 的注册表，前端工具条显示「当前模型」用）——
  // 不在前端硬编码模型名：换配置时界面自动跟着变。
  if (path === '/api/models') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ chat: getChatModelNames() }));
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

  // ── 认领工作目录（前端「选目录」就调这个）──
  // 语义 = 登记进注册表（写前与注册表对账）+ 对账该目录的会话索引。
  // 没有它，「选了一个目录」这个动作对列表毫无影响 → 打开旧目录看不见里面的会话。
  if (path === '/api/workdirs' && req.method === 'POST') {
    const body = (await readJsonBody(req).catch(() => ({}))) as { dir?: string };
    const dir = String(body.dir ?? '').trim();
    if (!dir) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('缺少 dir');
    }
    try {
      const report = await transcript.claimWorkDir(dir);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify(report));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(`认领工作目录失败：${(e as Error).message}`);
    }
  }

  if (path.startsWith('/api/layout/')) {
    return await handleLayout(req, res, path.slice('/api/layout/'.length), url.searchParams.get('session'));
  }
  if (path === '/api/sessions' || path.startsWith('/api/sessions/')) {
    return await handleSessions(req, res, path, req.method ?? 'GET');
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('not found');
});

server.listen(PORT, () => {
  console.log(`API server 已启动: http://localhost:${PORT}`);

});
