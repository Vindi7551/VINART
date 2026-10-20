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
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
// 字体库（服务端读盘 → @font-face CSS；浏览器只拿到 URL）
import {
  buildFontCss,
  fontFileByDir,
  listFontFamilies,
  usedFontChecks,
  usedFontFamilies,
} from '../fonts/registry';
// 文档模型（`buildLayoutNote` 要把"当前打开的版式"讲给 LLM 听 —— 结构见 `vocabulary.ts` 文件头）
import { iterElements, type DesignDocument } from '../document/vocabulary';
// 草图里的内置占位图 id（`planToIntent` 用同一个常量）
import { PLACEHOLDER_ASSET } from '../schema/plan';

const PORT = Number(process.env.PORT) || 8787;

const PNG_PRIORITY = ['final.png', 'sketch.png'];

/**
 * 版式编辑数据链路(前端逐元素编辑的持久层):
 *   GET  /api/layout/<name>/data   → { name, doc, html }（html = emitDocument 现场生成）
 *   POST /api/layout/<name>/save   → body { doc } 写 doc.json
 *   POST /api/layout/<name>/render → emitDocument + blink 渲染 final.png
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

// ══════════════════════════════════════════════════════════════════════
// 会话事件推送（常驻 SSE）
// ══════════════════════════════════════════════════════════════════════

/**
 * **活着的会话事件流**：`sessionId → 打开的响应`（一个会话可以同时开着好几个页面）。
 *
 * ## 为什么需要它
 *
 * 在此之前前端**没有任何常驻通道** —— 唯一的 SSE 是 `/chat` 那一轮对话的流，说完就断。
 * 于是"**别人**出了图"（直接 `POST /api/layout/<n>/render`，或者将来某个工具）
 * 前端完全不知道：画廊要等下一次对话结束、或者用户手动 F5 才更新。
 *
 * ⇒ 挂一条常驻的 `GET /api/sessions/<sid>/stream`，服务端有事就 `pushSessionEvent`。
 *    现在只推 `artifacts`（出图了 ⇒ 画廊重拉清单），以后渲染进度之类也能走它。
 */
const liveStreams = new Map<string, Set<ServerResponse>>();

/** 给某个会话的**所有**打开的页面推一条 SSE 事件。没人听就什么都不做 */
function pushSessionEvent(sessionId: string, event: string, data: unknown): void {
  const set = liveStreams.get(sessionId);
  if (!set?.size) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) {
    try {
      res.write(payload);
    } catch {
      set.delete(res); // 写失败 = 这条已经断了（`close` 事件也兜着，这里只是快点清）
    }
  }
}

/**
 * 递归收集文档里引用的**素材名**。
 *
 * ⚠️ **四个地方都可能出现素材引用，一个都不能漏**：
 *    · `asset`（image / svg）
 *    · `fill` 里的 `url(...)`（形状的图案填充；字符串或数组）
 *    · `mask` 里的 `url(...)`（蒙版图）
 *    · `stroke.paint` 里的 `url(...)`（图片描边 → `border-image`）
 *    漏掉的后果是**断图、而且不报错**：名字没进 `assets`，emit 就只当它是一段普通 CSS 值，
 *    原样写出去，浏览器拿它当相对 URL 去 404。
 */
/**
 * ⚠️ **文档结构是「画布 → 图层 → 元素」**（2026-10-16 改，见 `vocabulary.ts` 文件头）：
 *    `doc.layers` 是**图层**，素材挂在 `Layer.elements` 里的元素上，组还能再嵌套。
 *    ⇒ 必须**递归到元素**去挖，只看 `doc.layers` 一层会**一个素材都收不到**
 *      （后果见上：断图、而且不报错）。
 */
function collectAssetNames(doc: { layers: unknown[] }): string[] {
  const out = new Set<string>();
  /** 从一个 CSS 值里挖 `url(名字)`。`data:` / `http(s):` / 路径**不是素材名**，跳过 */
  const takeUrls = (v: unknown): void => {
    const one = (s: string) => {
      for (const m of s.matchAll(/url\(\s*['"]?([^)'"]+)/g)) {
        const name = m[1].trim();
        if (!/^(data:|https?:|\/|\.\.?\/)/i.test(name)) out.add(name);
      }
    };
    if (typeof v === 'string') one(v);
    else if (Array.isArray(v)) for (const x of v) if (typeof x === 'string') one(x);
  };
  const walk = (ls: unknown[]): void => {
    for (const l of ls) {
      const n = l as {
        type?: string;
        asset?: string;
        fill?: unknown;
        mask?: unknown;
        stroke?: { paint?: string };
        /** 元素（图层 / 组都有这个字段） */
        elements?: unknown[];
      };
      if (n.asset) out.add(n.asset);
      takeUrls(n.fill);
      takeUrls(n.mask);
      takeUrls(n.stroke?.paint);
      if (Array.isArray(n.elements)) walk(n.elements);
    }
  };
  walk(doc.layers);
  return [...out];
}

/** 扩展名 → MIME（**文件流 与 data URL 共用这一份**） */
const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  json: 'application/json',
  md: 'text/markdown',
  txt: 'text/plain',
};

const mimeOf = (p: string): string =>
  MIME[p.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';

/** 读盘 → `data:<mime>;base64,...` */
const dataUrlOf = (p: string): string => `data:${mimeOf(p)};base64,${readFileSync(p).toString('base64')}`;

/**
 * **素材名 → URL** —— **唯一一处"找文件"的地方**。
 *
 * ⚠️ 为什么必须只有一份：`/data`（预览）和 `/render`（出图）原来**各写了一遍**（复制粘贴），
 *    只有最后一行不同。而 `/render` 那行写的是 `file://` ——
 *    `page.setContent()` 出来的文档是 `about:blank`，**Chromium 禁止从非 `file://` 页面
 *    加载 `file://` 子资源**（安全边界，没有开关）⇒ **出图里所有素材都是裂图**；
 *    而预览那条路（`/api/sessions/.../file/...`）好好的。
 *    ⇒ "预览看得见、出图看不见"，还一声不响（服务端把 `unsupported` 也丢了）。
 *
 * `urlFor` 由调用方决定 URL 形态：**预览**给 http 路由；**出图**给 **data URL**
 * （不受 scheme / CORS 限制、产物自包含 —— 与 `@font-face` 内联是同一个思路）。
 */
function resolveAssets(
  doc: { layers: unknown[] },
  roots: string[],
  urlFor: (abs: string) => string,
): Record<string, string> {
  const out: Record<string, string> = {};
  const names = collectAssetNames(doc);
  // 内置占位图：不在版式目录/工作目录里找，永远用 data URL（预览和出图都自包含）。
  if (names.includes(PLACEHOLDER_ASSET)) {
    const p = resolve('designassets/builtin/placeholder.svg');
    if (existsSync(p)) out[PLACEHOLDER_ASSET] = dataUrlOf(p);
  }
  for (const nm of names) {
    for (const r of roots) {
      const p = resolve(r, nm);
      if (existsSync(p)) {
        out[nm] = urlFor(p);
        break;
      }
    }
  }
  return out;
}

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
  // ⭐ 新协议：**一个文件就是一份 DesignDocument**（词汇表）。
  //    旧产物（design-sketch.json / design-appearance.json）不迁移——读到没有 doc.json
  //    一律 404 提示重新生成（旧格式没有值得保留的信息，见 docs/MIGRATION.md）。
  const docPath = join(dir, 'doc.json');

  if (req.method === 'GET' && action === 'data') {
    if (!existsSync(docPath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(
        `no doc: ${name}（旧格式产物不兼容——请在对话里重新生成这份版式）`,
      );
    }
    const doc = JSON.parse(readFileSync(docPath, 'utf8'));
    // ⚠️ html **始终现场生成**（emitDocument 纯函数）——编辑视图永远与 doc 一致，
    //    doc 是唯一数据源（与旧协议同理念）。
    //    素材解析：doc 里引用的素材名 → [版式目录, 工作目录] 找文件 → URL。
    //    **预览这条路的 URL 形态是 http 路由**（见 `resolveAssets` 的对照）。
    const { emitDocument } = await import('../render/vocabulary/emit');
    const assetRoots = [dir, ...(workDir ? [workDir] : [])];
    const assets = resolveAssets(doc, assetRoots, (p) =>
      sessionId && workDir
        ? `/api/sessions/${sessionId}/file/${relative(workDir, p).split(sep).join('/')}`
        : `/files/${relative(dir, p).split(sep).join('/')}`,
    );
    // 预览/编辑：库里所有字体的 @font-face（相对地址）；浏览器用到才下载。
    // 这样编辑器里换字体不需要重建 HTML。
    const faceCss = buildFontCss({ baseUrl: '/api/fonts' });
    const { html } = emitDocument(doc, { assets, faceCss });
    // ⭐ assets 映射随 data 下发——前端结构性变化（undo/增删）时**在浏览器里自己
    //    emitDocument**（编辑即渲染，无网络往返），素材映射从这里拿。
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(
      JSON.stringify({
        name,
        doc,
        html,
        assets,
        // 编辑器字体下拉用；不含文件本身。
        // 旧拉丁字体也放出来，但给一个「（仅英文）」显示标签（中文会 fallback）。
        fontFamilies: listFontFamilies().map((f) => f.family),
        fontLabels: Object.fromEntries(
          listFontFamilies()
            .filter((f) => !f.scripts?.includes('hans'))
            .map((f) => [f.family, `${f.family}（仅英文）`]),
        ),
      }),
    );
  }

  if (req.method === 'POST' && action === 'save') {
    let body = '';
    req.on('data', (c: Buffer) => (body += c));
    req.on('end', () => {
      try {
        const payload = JSON.parse(body) as { doc?: unknown };
        mkdirSync(dir, { recursive: true });
        if (payload.doc) {
          writeFileSync(docPath, JSON.stringify(payload.doc, null, 2) + '\n', 'utf8');
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
    if (!existsSync(docPath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(`no doc: ${name}`);
    }
    console.log(`[render] ${name} → final`);
    running = { stepId: `render:${name}` };
    try {
      // ⭐ 新链：emitDocument（词汇 → HTML）+ blink 渲染 PNG。
      //    ⚠️ 素材**必须内联成 data URL** —— 曾经这里是 `pathToFileURL()`（注释还写着
      //    "渲染器本地读盘最稳"，实际**最不稳**）：渲染器用 `page.setContent()`，
      //    文档是 `about:blank` ⇒ Chromium 禁止加载 `file://` 子资源 ⇒ 出图里素材全裂。
      //    完整理由见 `resolveAssets` 上面那段。
      const doc = JSON.parse(readFileSync(docPath, 'utf8')) as DesignDocument;
      const { emitDocument } = await import('../render/vocabulary/emit');
      const assetRoots = [dir, ...(workDir ? [workDir] : [])];
      const assets = resolveAssets(doc, assetRoots, dataUrlOf);
      // 出图：只带这份 doc 用到的字体；绝对地址供 about:blank 页面跨源加载。
      const fontFamilies = usedFontFamilies(doc);
      const faceCss = buildFontCss({
        baseUrl: `http://127.0.0.1:${PORT}/api/fonts`,
        families: fontFamilies,
      });
      const fontChecks = usedFontChecks(doc);
      const { html } = emitDocument(doc, { assets, faceCss });
      const { createBlinkRenderer } = await import('../render/rasterize/blink-renderer');
      const renderer = await createBlinkRenderer();
      try {
        const out = await renderer.render(
          { html },
          dir,
          {
            width: doc.canvas.width,
            height: doc.canvas.height,
            deviceScaleFactor: 2,
            format: 'png',
            filename: 'final',
            fontChecks,
          },
        );
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, png: out.imagePath }));
        // ⭐ 出完图**推一次**：画廊据此重拉清单。
        //    原来这个事件只有"对话链产出"才会推（见 `/chat` 里 `evt.kind === 'artifacts'`）——
        //    直接调本端点出图，前端永远不知道 ⇒ 只能手动 F5。
        pushSessionEvent(sessionId, 'artifacts', { layout: name, png: out.imagePath });
      } finally {
        await renderer.dispose();
      }
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
    /^\/api\/sessions\/([\w.-]+)(?:\/(events|chat|artifacts|workdir|file|stream|active)(?:\/(.*))?)?$/.exec(path);

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
        activeLayout: await transcript.getActiveLayout(sessionId),
      }),
    );
  }
  // 设置当前打开的版式（不创建会话：session 不存在 → noSession，客户端只存内存）
  if (sub === 'active' && method === 'POST') {
    let body: { layout?: unknown };
    try {
      body = (await readJsonBody(req, 1024 * 1024)) as { layout?: unknown };
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(`请求体无效：${(e as Error).message}`);
    }
    const layout = typeof body.layout === 'string' && body.layout.trim() ? body.layout.trim() : null;
    const ok = await transcript.setActiveLayout(sessionId, layout);
    res.writeHead(200, JSON_HDR);
    return res.end(JSON.stringify({ ok, noSession: !ok, layout }));
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
    res.writeHead(200, { 'Content-Type': mimeOf(abs) });
    return res.end(readFileSync(abs));
  }

  // ── 常驻事件流(服务端主动推:出图了、以后还有渲染进度)────────────────
  // ⚠️ **长连接**：绝不能 `res.end()`，清理只靠 `req.on('close')`。
  //    前端用 `EventSource`（自带断线重连），所以服务重启也不用管。
  if (sub === 'stream' && method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n'); // 先吐一个注释帧，让前端立刻知道连上了
    const set = liveStreams.get(sessionId) ?? new Set<ServerResponse>();
    set.add(res);
    liveStreams.set(sessionId, set);
    // 心跳：25 秒一个注释帧 —— 免得中间层（代理 / 系统）把空闲连接掐掉
    const beat = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        /* 写失败由下面的 close 收拾 */
      }
    }, 25_000);
    req.on('close', () => {
      clearInterval(beat);
      set.delete(res);
      if (!set.size) liveStreams.delete(sessionId);
    });
    return;
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
    let body: {
      text?: string;
      activeLayout?: string;
      images?: string[];
      references?: ChatReference[];
    };
    try {
      // 96MB：覆盖单张 64MiB 图（Files API 上限）的 base64 ~86MB + JSON 余量。
      // chat 请求体本身已改走 file_id 引用，不受 DeepSeek 48MB 请求体限制约束，
      // 这个上限只管「前端→后端」这一跳的传输体积。
      body = (await readJsonBody(req, 96 * 1024 * 1024)) as {
        text?: string;
        activeLayout?: string;
        images?: string[];
        references?: ChatReference[];
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
    // Fix C · 落点合理性校验：workDir 必须是**已登记的项目目录**之一。
    // 若解析出了别的路径（代码走错分支、注册表被外部改动），宁可显式 500，
    // 也不把用户贴图静默写进一个没人认领的目录——那正是"首图丢失"事故的形态。
    // （登记由 createSession/registerRoot 保证，正常路径恒过。）
    const knownRoots = await transcript.listRoots();
    if (!knownRoots.some((r) => resolve(r) === resolve(workDir))) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(
        `贴图落点异常：会话 ${sessionId} 解析出的工作目录 ${workDir} 不在已登记目录中` +
          `（已登记：${knownRoots.join('、') || '（空）'}）——拒绝写入，避免图落到无人认领的位置。`,
      );
    }
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
      // 文件名带随机段：`Date.now()` 在循环内逐张取，同毫秒 + 同扩展名的两张图
      // 会拼出同一个名字 → 后者覆盖前者（数据丢失）。时间戳只作可读性前缀。
      const rel = `uploads/chat-${Date.now()}-${i}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
      const abs = resolve(workDir, rel);
      try {
        mkdirSync(uploadsBase, { recursive: true });
        writeFileSync(abs, buf);
      } catch (e) {
        // 写盘失败必须**显式失败**，不能静默——否则事件里留下一个指向不存在文件的
        // 路径引用，前端/渲染层会一路"图丢失"却查不到原因（实测踩过）。
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end(`第 ${i + 1} 张贴图落盘失败（${abs}）：${(e as Error).message}`);
      }
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
      const systemNote = await buildSystemNote(
        sessionId,
        body.activeLayout as string | undefined,
        body.references,
      );
      await transcript.appendEvent(sessionId, {
        ts: new Date().toISOString(),
        kind: 'message',
        id: `msg_${crypto.randomUUID().slice(0, 8)}`,
        role: 'user',
        text,
        ...(savedImages.length ? { images: savedImages, fileIds } : {}),
      } as Parameters<typeof transcript.appendEvent>[1]);
      // 本轮 activeLayout 落 session meta（此时会话已存在；不创建）
      await transcript.setActiveLayout(sessionId, (body.activeLayout as string | undefined) ?? null);

      // 整轮耗时计时起点：用户消息已落盘之后、模型请求之前。
      // 口径 = 含工具执行的整轮（用户明确要求），不是首字节延迟。
      const roundStart = Date.now();
      // 本轮思考链：流式片段先拼（前端要边想边显示），终章 chunk 再给出权威全文覆盖
      let reasoningFull = '';

      // tool-call 落账 promise 收集：流结束先等账本落齐再发 done——
      // 否则「对话刚结束就刷新会话」可能与写盘竞态，账本读到不完整
      const pendingWrites: Promise<void>[] = [];
      for await (const chunk of session.send(text, attachments.length ? attachments : undefined, {
        systemNote,
        activeLayout: body.activeLayout as string | undefined,
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
          else if (evt.kind === 'doc-patch') send('doc-patch', evt);
          else send('agent', evt);
        },
      })) {
        if (chunk.content) send('chunk', { content: chunk.content });
        // 思考链：与 chunk 平行的独立事件——前端单独渲染成可折叠块。
        // 终章 chunk 带的是**整轮权威全文**（finishReason 'stop' 且 content 为空那个），
        // 用 full 标志区分：`full` 事件让前端**覆盖**而非追加（流式期是分段拼的）。
        if (chunk.reasoningContent) {
          const isFull = chunk.finishReason === 'stop' && !chunk.content;
          if (isFull) reasoningFull = chunk.reasoningContent;
          send('reasoning', { content: chunk.reasoningContent, full: isFull });
        }
      }
      await Promise.all(pendingWrites);

      // assistant 完整回复落盘(send 内部已 push 到历史)
      const msgs = session.messages;
      const last = msgs[msgs.length - 1];
      const full =
        last && last.role === 'assistant' && typeof last.content === 'string'
          ? last.content
          : '';
      const durationMs = Date.now() - roundStart;
      if (full) {
        await transcript.appendEvent(sessionId, {
          ts: new Date().toISOString(),
          kind: 'message',
          id: `msg_${crypto.randomUUID().slice(0, 8)}`,
          role: 'assistant',
          text: full,
          // 耗时随消息落盘——历史回放靠它复原「用时 X s」（只在前端算的话刷新即丢）
          durationMs,
        });
      }
      // 思考链**默认不落盘**（体积 + 不进模型：见 SessionEvent 注释）。
      // 若确需审计，把 REASONING_PERSIST 环境变量置 1 即写入事件（离线分析用）。
      if (reasoningFull && process.env.VINART_PERSIST_REASONING === '1') {
        await transcript.appendEvent(sessionId, {
          ts: new Date().toISOString(),
          kind: 'action',
          action: 'reasoning',
          detail: { text: reasoningFull },
        } as Parameters<typeof transcript.appendEvent>[1]);
      }
      send('done', { ok: true, durationMs: full ? durationMs : 0 });
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

/** 用户 `@` 引用的元素（前端 contentEditable chip 序列化后传上来） */
interface ChatReference {
  kind?: string;
  layout?: string;
  id?: string;
  name?: string;
}

/**
 * systemNote 组装：skill 目录（稳定，放前面保 cache 前缀）+ 版式摘要 + 当前引用（易变，放后面）。
 * 两段都可能为空；拼接顺序固定——skill 集合不变则目录字节不变，前缀照常命中。
 */
async function buildSystemNote(
  sessionId: string,
  layoutName?: string | null,
  references?: ChatReference[],
): Promise<string> {
  const workDir = await transcript.getWorkDir(sessionId);
  const catalog = renderSkillCatalog(workDir);
  // 字体库清单（稳定段）：中文与「仅英文」分开列，避免 AI 拿拉丁子集写中文。
  const allFonts = listFontFamilies();
  const cjkFonts = allFonts.filter((f) => f.scripts?.includes('hans'));
  const latinFonts = allFonts.filter((f) => !f.scripts?.includes('hans'));
  const fontNote = [
    cjkFonts.length ? `【字体库·中文】${cjkFonts.map((f) => f.family).join('、')}` : '',
    latinFonts.length
      ? `【字体库·仅英文】${latinFonts.map((f) => f.family).join('、')}（没有中文字形，中文文字不要用）`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
  const layoutNote = await buildLayoutNote(sessionId, layoutName);
  const refs = (Array.isArray(references) ? references : [])
    .filter((r) => r && typeof r.id === 'string' && r.id.trim())
    .map((r) => {
      const kind = typeof r.kind === 'string' && r.kind ? r.kind : 'element';
      const layout = typeof r.layout === 'string' && r.layout ? r.layout : layoutName ?? '';
      const name = typeof r.name === 'string' && r.name ? `「${r.name}」` : '';
      return `- ${r.id}${name} (${kind}${layout ? `, layout: ${layout}` : ''})`;
    })
    .join('\n');
  const refNote = refs ? `【当前引用】\n${refs}` : '';
  return [catalog, fontNote, layoutNote, refNote].filter(Boolean).join('\n\n');
}

/**
 * 版式摘要 → systemNote 注入（让 LLM 知道「当前打开的版式」；每轮按最新状态重算）。
 *
 * ⚠️ **2026-10-16 改成读 `doc.json`**：此前它读的是**旧契约**的
 *    `design-sketch.json` + `design-appearance.json` —— 那两个契约整层已删，
 *    而这两个文件在交付目录里**再没有任何程序会读**（只剩这里）。
 *    继续读下去的后果：给旧版式注入**旧契约的描述**，对 `smoke` / `vocab-full`
 *    则**什么都不注入**（`doc.json` 在、但 `design-sketch.json` 不在 ⇒ 早退）。
 */
async function buildLayoutNote(sessionId: string, layoutName?: string | null): Promise<string> {
  const wd = await transcript.getWorkDir(sessionId);
  const designsDir = join(wd, 'designs');
  const designs = existsSync(designsDir)
    ? readdirSync(designsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
    : [];
  const series = designs.length ? `【本会话的版式】${designs.join('、')}` : '';

  if (!layoutName) {
    return series ? `${series}\n【当前没有打开的版式】` : '';
  }
  const docPath = join(wd, 'designs', layoutName, 'doc.json');
  if (!existsSync(docPath)) {
    const activeNote = `【当前打开的版式】${layoutName}（还没有 doc.json）`;
    return series ? `${series}\n${activeNote}` : activeNote;
  }
  try {
    const doc = JSON.parse(readFileSync(docPath, 'utf8')) as DesignDocument;
    // 结构是「画布 → 图层 → 元素」（见 `vocabulary.ts` 文件头）⇒ 逐图层展开它的元素。
    const layers = doc.layers
      .map((l) => {
        const els = [...iterElements(l)]
          .map((e) => {
            const t = e.type === 'text' ? e.runs.map((r) => r.text).join(' ') : '';
            const nm = e.name ? `「${e.name}」` : '';
            return `  - ${e.id}(${e.type})${nm}${t ? `「${t.slice(0, 40)}」` : ''}`;
          })
          .join('\n');
        return `- 图层 ${l.id}${l.name ? `「${l.name}」` : ''}（${l.elements.length} 个元素）\n${els}`;
      })
      .join('\n');
    const activeNote =
      `【当前打开的版式】${layoutName}(${doc.canvas.width}×${doc.canvas.height})\n` +
      `图层:\n${layers}\n` +
      `用户说「标题/按钮/某个词」时,指的就是上面清单里的对应元素。`;
    return series ? `${series}\n${activeNote}` : activeNote;
  } catch {
    return series;
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
    // 画廊缩略图也用同一套字体（相对地址）；否则缩略图与主画布字体不一致。
    const faceCss = buildFontCss({ baseUrl: '/api/fonts' });
    const items = scanArtifactRoot(join(workDir, 'designs')).map((it) => {
      if (!it.doc) return { ...it, assets: {}, faceCss };
      const abs = join(workDir, 'designs', it.name);
      const assets = resolveAssets(it.doc, [abs, workDir], (p) =>
        `/api/sessions/${sessionId}/file/${relative(workDir, p).split(sep).join('/')}`,
      );
      return { ...it, assets, faceCss };
    });
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
      const docPath = join(abs, 'doc.json');
      let doc: DesignDocument | null = null;
      if (existsSync(docPath)) {
        try {
          doc = JSON.parse(readFileSync(docPath, 'utf8')) as DesignDocument;
        } catch {
          doc = null;
        }
      }
      return {
        name: d.name,
        layoutsRoot, // 前端用它 + name 组成卡片 key（唯一标识）
        pngs: files.filter((f) => f.endsWith('.png')),
        htmls: files.filter((f) => f.endsWith('.html')),
        doc,
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
// （createRenderDesignTool 已随旧链弃用——render 端点走 emitDocument + blink）
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

  // ── 字体库：清单 + woff2 静态文件 ──
  // 预览用相对地址 `/api/fonts/...`；出图用绝对 `http://127.0.0.1:8787/api/fonts/...`。
  // ⚠️ 必须带 CORS：出图页面是 about:blank，字体请求跨源。
  if (path === '/api/fonts' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
    });
    return res.end(
      JSON.stringify({
        families: listFontFamilies().map((f) => ({
          family: f.family,
          dir: f.dir,
          weights: f.weights,
          scripts: f.scripts ?? ['latin'],
          license: f.license ?? null,
          character: f.character ?? null,
          bestFor: f.bestFor ?? null,
        })),
      }),
    );
  }
  if (path.startsWith('/api/fonts/') && req.method === 'GET') {
    const rest = path.slice('/api/fonts/'.length).split('/');
    if (rest.length !== 2) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('bad font path');
    }
    const file = fontFileByDir(decodeURIComponent(rest[0]!), decodeURIComponent(rest[1]!));
    if (!file || !existsSync(file)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('font not found');
    }
    const st = statSync(file);
    res.writeHead(200, {
      'Content-Type': 'font/woff2',
      'Content-Length': st.size,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Access-Control-Allow-Origin': '*',
    });
    const stream = createReadStream(file);
    stream.on('error', () => res.destroy());
    return stream.pipe(res);
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
