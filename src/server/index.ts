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

const PORT = Number(process.env.PORT) || 8787;

const PNG_PRIORITY = ['final.png', 'sketch.png'];

/**
 * 版式编辑数据链路(前端逐元素编辑的持久层):
 *   GET  /api/layout/<name>/data   → { spec, appearance, html }(linked.html 原文)
 *   POST /api/layout/<name>/save   → body { spec?, appearance? } 写盘
 *   POST /api/layout/<name>/render → spawn step-layout final(纯重渲,零 API 成本)
 * name 只允许字母数字横线下划线,防路径穿越。
 */
// 渲染互斥:同一时间只允许一个渲染子进程(历史:run/pipeline/render 共用)
let running: { stepId: string; child: ChildProcess } | null = null;

async function handleLayout(
  req: IncomingMessage,
  res: ServerResponse,
  rest: string,
  sessionId: string | null,
  projectQuery: string | null,
) {
  // 目录名可能含点号(取自图片文件名,如 61bIICZBYDL._AC_SL1500_-PT01)——
  // 只禁斜体与 .. ,再用 resolve 后的前缀校验做根本性防穿越
  const m = /^([^/\\]+)\/(data|save|render)$/.exec(rest);
  const name = m?.[1] ?? '';
  // 会话模式 layoutsRoot：query 的 project 优先 → 会话当前项目；版式级读回退
  // （新位置不存在 → 旧 <workDir>/designs/<name>）；无 session → 旧约定
  let LAYOUT_ROOT = resolve('test_product/layout');
  if (sessionId) {
    const workDir = await transcript.getWorkDir(sessionId);
    const project = projectQuery ?? (await transcript.getProject(sessionId));
    const newRoot = project ? join(workDir, project, 'designs') : null;
    const legacyRoot = join(workDir, 'designs');
    if (name && newRoot && existsSync(join(newRoot, name))) LAYOUT_ROOT = newRoot;
    else if (name && existsSync(join(legacyRoot, name))) LAYOUT_ROOT = legacyRoot;
    else LAYOUT_ROOT = newRoot ?? legacyRoot;
  }
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
    /^\/api\/sessions\/([\w.-]+)(?:\/(events|chat|artifacts|workdir|file|projects|project)(?:\/(.*))?)?$/.exec(path);

  // 列表：条目带 workDir/project（对话列表两层分组）；项目 displayName 就地映射
  if (path === '/api/sessions' && method === 'GET') {
    const list = await transcript.listSessions();
    // 按 workDir 缓存各自的项目索引（displayName 查找，通常只有一两个工作目录）
    const displayNameCache = new Map<string, Map<string, string>>();
    const enriched = list.map((s) => {
      let names: Map<string, string> | undefined;
      if (s.workDir) {
        names = displayNameCache.get(s.workDir);
        if (!names) {
          names = new Map(listProjects(s.workDir).map((p) => [p.name, p.displayName ?? p.name]));
          displayNameCache.set(s.workDir, names);
        }
      }
      return { ...s, projectDisplayName: (s.project && names?.get(s.project)) || null };
    });
    res.writeHead(200, JSON_HDR);
    return res.end(JSON.stringify(enriched));
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
        project: await transcript.getProject(sessionId),
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

  // ── 项目:清单(索引过滤幽灵)与切换(注册+meta)──
  if (sub === 'projects' && method === 'GET') {
    const workDir = await transcript.getWorkDir(sessionId);
    res.writeHead(200, JSON_HDR);
    return res.end(
      JSON.stringify({
        projects: listProjects(workDir).map((p) => ({ name: p.name, displayName: p.displayName ?? p.name })),
        current: await transcript.getProject(sessionId),
      }),
    );
  }
  if (sub === 'project' && method === 'POST') {
    const body = (await readJsonBody(req)) as { name?: string; displayName?: string };
    const name = String(body.name ?? '').trim();
    const displayName = String(body.displayName ?? '').trim();
    if (!PROJECT_NAME_RE.test(name)) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('项目名非法：只能用英文、数字、点、下划线、连字符（展示名可以是中文）');
    }
    const workDir = await transcript.getWorkDir(sessionId);
    registerProject(workDir, name, displayName || undefined);
    await transcript.setProject(sessionId, name);
    res.writeHead(200, JSON_HDR);
    return res.end(JSON.stringify({ ok: true, project: name, displayName: displayName || name }));
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
    // 贴图=产品照，归项目走（<workDir>/<project>/uploads/）；未设项目 → 旧约定
    // workDir/uploads（聊天不能因没设项目而发不出，rel 自带项目前缀，重放零改动）。
    const workDir = await transcript.getWorkDir(sessionId);
    const chatProject = await transcript.getProject(sessionId);
    const uploadsBase = chatProject ? resolve(workDir, chatProject, 'uploads') : resolve(workDir, 'uploads');
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
      const rel = chatProject ? `${chatProject}/uploads/chat-${Date.now()}-${i}.${ext}` : `uploads/chat-${Date.now()}-${i}.${ext}`;
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

function handleArtifacts(res: ServerResponse, sessionId?: string | null) {
  void (async () => {
    // 无 session → legacy 根（旧习惯保留）；有 session → 聚合工作目录下
    // **所有注册项目**的 designs（gallery 按项目分组），旧数据
    // <workDir>/designs（未设项目时代的产物）作为一组兜底。
    if (!sessionId) {
      const items = scanArtifactRoot(resolve('test_product/layout'), null, 'legacy', 'test_product/layout');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify(items));
    }
    const workDir = await transcript.getWorkDir(sessionId);
    const groups: { layoutsRoot: string; project: string | null }[] = [];
    for (const p of listProjects(workDir)) {
      const root = join(workDir, p.name, 'designs');
      if (existsSync(root)) groups.push({ layoutsRoot: root, project: p.name });
    }
    const legacyRoot = join(workDir, 'designs');
    if (existsSync(legacyRoot)) groups.push({ layoutsRoot: legacyRoot, project: null });
    const items = groups.flatMap((g) =>
      scanArtifactRoot(g.layoutsRoot, g.project, 'session', `@session/${sessionId}`),
    );
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(items));
  })().catch(() => {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end('[]');
  });
}

/** 扫一个 layouts 根目录 → 产物条目（PNG 排序：final > sketch > 其他） */
function scanArtifactRoot(
  layoutsRoot: string,
  project: string | null,
  rootTag: 'session' | 'legacy',
  dirLabel: string,
) {
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
        project, // 所属项目（null = 旧数据未分组）——前端分组展示 + layout API 带回
        // root:前端拼产物 URL 的分支依据——session 走 file API,
        // legacy 走 /files/ 静态映射。dir 仅作展示/键用
        root: rootTag,
        dir: dirLabel,
        layoutsRoot,
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
import { listProjects, registerProject, PROJECT_NAME_RE } from '../designharness/session/projects';
import { renderSkillCatalog } from '../designharness/skills/registry';
import { getChatSession, dropChatSession, isSessionStreaming } from '../designharness/session/chat-store';
import type { Attachment } from '../designharness/gateway/type/chat';
import { uploadImageFile, FILES_API_MAX_BYTES } from '../designharness/gateway/util/files-api';
import { getOpenAICompatChatConfig } from '../config';

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;

  if (path === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
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

  if (path === '/api/projects' && req.method === 'GET') {
    // 无会话时的项目清单（惰性会话：前端只缓存环境，建会话前就要能浏览项目下拉）
    const dir = url.searchParams.get('dir') ?? '';
    const HDR = { 'Content-Type': 'application/json; charset=utf-8' };
    if (!dir || !existsSync(dir)) {
      res.writeHead(200, HDR);
      return res.end(JSON.stringify({ projects: [] }));
    }
    res.writeHead(200, HDR);
    return res.end(
      JSON.stringify({
        projects: listProjects(dir).map((p) => ({ name: p.name, displayName: p.displayName ?? p.name })),
      }),
    );
  }
  if (path === '/api/projects' && req.method === 'POST') {
    // 无会话时的项目注册（目录组头 ✎ 提交即建：文件夹与索引立即落盘——
    // 用户要在文件管理器里先看到/先放素材是真实工作流）
    const body = (await readJsonBody(req)) as { dir?: string; name?: string; displayName?: string };
    const dir = String(body.dir ?? '').trim();
    const name = String(body.name ?? '').trim();
    const displayName = String(body.displayName ?? '').trim();
    const HDR = { 'Content-Type': 'application/json; charset=utf-8' };
    if (!dir || !existsSync(dir)) {
      res.writeHead(400, HDR);
      return res.end('工作目录不存在');
    }
    if (!PROJECT_NAME_RE.test(name)) {
      res.writeHead(400, HDR);
      return res.end('项目名非法：只能用英文、数字、点、下划线、连字符（展示名可以是中文）');
    }
    try {
      const created = registerProject(dir, name, displayName || undefined);
      res.writeHead(200, HDR);
      return res.end(JSON.stringify({ ok: true, dir: created }));
    } catch (e) {
      res.writeHead(400, HDR);
      return res.end((e as Error).message);
    }
  }
  if (path === '/api/artifacts') return handleArtifacts(res, url.searchParams.get('session'));
  if (path.startsWith('/api/layout/')) {
    return await handleLayout(req, res, path.slice('/api/layout/'.length), url.searchParams.get('session'), url.searchParams.get('project'));
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
