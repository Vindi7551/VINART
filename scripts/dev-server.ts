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
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
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
    script: 'scripts/step-01-perceive.ts',
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
    script: 'scripts/step-02-claims.ts',
    buildArgs: rawArgs,
  },
  {
    id: 'step-03-slots',
    label: '03 · 套图规划',
    description: '卖点审计 → 每张图回答什么购买问题(给 04 消费)。消费 02 的输出(step-02.json 同目录)。',
    argsHint: 'test_product/shirt/step-02.json --bullets test_product/shirt/童装卖点.txt --lang en',
    script: 'scripts/step-03-slots.ts',
    buildArgs: rawArgs,
  },
  {
    id: 'step-04-brief',
    label: '04 · 方案编写',
    description: '规划+卖点+事实 → 每个副图位的创意方案 md(test_product/briefs/)。全部槽位较贵,建议先 --only 单跑。',
    argsHint: '--bullets test_product/shirt/童装卖点.txt --only PT01',
    script: 'scripts/step-04-brief.ts',
    buildArgs: rawArgs,
  },
  {
    id: 'step-05-appearance',
    label: '05 · 外观编译',
    description: '版式+方案+产品照 → 专属配色 design-appearance.json(多轮 LLM+视觉验收,较慢)。',
    argsHint: 'test_product/layout/shirt-PT01/design-sketch.json --brief test_product/briefs/shirt-PT01.md',
    script: 'scripts/step-05-appearance.ts',
    buildArgs: rawArgs,
  },
  {
    id: 'step-order',
    label: '06 · 素材订单',
    description: '版式+方案 → assets.json(生图提示词+参考图角色,gen 阶段的前置)。',
    argsHint: 'test_product/layout/shirt-PT01/design-sketch.json --brief test_product/briefs/shirt-PT01.md',
    script: 'scripts/step-order.ts',
    buildArgs: rawArgs,
  },
  {
    id: 'step-layout',
    label: '07 · 出图',
    description: '吃版式规格出图:sketch 草图(零 API,秒出)/ gen 生素材(烧钱)/ final 成品。spec 必填。',
    argsHint: 'test_product/layout/shirt-PT01/design-sketch.json sketch --no-library',
    script: 'scripts/step-layout.ts',
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
async function handleLayout(req: IncomingMessage, res: ServerResponse, rest: string) {
  // 目录名可能含点号(取自图片文件名,如 61bIICZBYDL._AC_SL1500_-PT01)——
  // 只禁斜体与 .. ,再用 resolve 后的前缀校验做根本性防穿越
  const m = /^([^/\\]+)\/(data|save|render)$/.exec(rest);
  const LAYOUT_ROOT = resolve('test_product/layout');
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
    const { renderDesign } = await import('../src/workflow/design-sketch/render');
    const { applyAppearance } = await import('../src/workflow/design-sketch/design-appearance');
    const { loadAppearance, loadPalette, loadTypography } = await import(
      '../src/workflow/design-sketch/runtime'
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
        'scripts/step-layout.ts',
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

function handleArtifacts(res: ServerResponse) {  const layoutDir = resolve('test_product/layout');
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
            dir: `test_product/layout/${d.name}`,
            pngs: files.filter((f) => f.endsWith('.png')),
            htmls: files.filter((f) => f.endsWith('.html')),
          };
        })
    : [];
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(items));
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
    const dir = resolve('test_product', name);
    mkdirSync(dir, { recursive: true });
    const imagePath = resolve(dir, `${name}.${ext}`);
    writeFileSync(imagePath, Buffer.from(m[2], 'base64'));
    const bulletsPath = resolve(dir, 'selling-points.txt');
    writeFileSync(bulletsPath, String(body.bullets).trim() + '\n', 'utf8');

    const id = randomUUID();
    pendingPipelines.set(id, {
      name,
      lang: body.lang === 'de' ? 'de' : 'en',
      depth: body.depth === 'final' ? 'final' : 'sketch',
      slot: typeof body.slot === 'string' && /^PT\d{2}$/.test(body.slot) ? body.slot : 'all',
      imagePath,
      bulletsPath,
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

  const facts = `test_product/${p.name}/step-01.json`;
  const claims = `test_product/${p.name}/step-02.json`;
  try {
    // ── 链 A 四步(中间产物全部进产品目录,互不覆盖)──
    const phases: { label: string; script: string; args: string[]; allowExit?: number[] }[] = [
      { label: '01 · 图像识别', script: 'scripts/step-01-perceive.ts', args: [p.imagePath] },
      {
        label: '02 · 卖点审计',
        script: 'scripts/step-02-claims.ts',
        args: [facts, '--bullets', p.bulletsPath, '--lang', p.lang],
      },
      {
        label: '03 · 套图规划',
        script: 'scripts/step-03-slots.ts',
        args: [claims, '--bullets', p.bulletsPath, '--lang', p.lang],
      },
      {
        label: '04 · 方案编写',
        script: 'scripts/step-04-brief.ts',
        args: [
          '--facts', facts,
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
    const briefsDir = resolve('test_product/briefs');
    const briefs = existsSync(briefsDir)
      ? readdirSync(briefsDir)
          .filter((f) => f.startsWith(`${p.name}-`) && f.endsWith('.md'))
          .sort()
      : [];
    if (!briefs.length) {
      send('log', { line: `✗ 没有找到任何 brief(test_product/briefs/${p.name}-*.md)` });
      send('exit', { code: 1, failed: '04 方案编写' });
      return res.end();
    }
    send('log', { line: `找到 ${briefs.length} 份方案:${briefs.join(', ')}` });

    for (const brief of briefs) {
      const briefPath = resolve(briefsDir, brief);
      const layoutName = brief.replace(/\.[^.]+$/, '');
      const specPath = resolve('test_product/layout', layoutName, 'design-sketch.json');

      send('log', { line: `───── 编译版式 · ${layoutName} ─────` });
      let code = await spawnPhase(
        'src/workflow/design-sketch/compile.ts',
        [briefPath, '--product', p.imagePath],
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
          'scripts/step-05-appearance.ts',
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

        const layoutArgs = [specPath, 'gen', 'final', '--product', p.imagePath];
        send('log', { line: `───── 出成品图 · ${layoutName}(含 AI 生图) ─────` });
        code = await spawnPhase('scripts/step-layout.ts', layoutArgs, send, () => aborted);
      } else {
        const layoutArgs = [specPath, 'sketch', '--no-library'];
        send('log', { line: `───── 渲草图 · ${layoutName}(零 API) ─────` });
        code = await spawnPhase('scripts/step-layout.ts', layoutArgs, send, () => aborted);
      }
      if (aborted) break;
      if (code !== 0) {
        send('exit', { code, failed: `出图 ${layoutName}` });
        return res.end();
      }
    }

    send('log', { line: `✓ 全链完成。产物在 test_product/layout/ 与 test_product/briefs/` });
    send('exit', { code: 0 });
    res.end();
  } finally {
    pipelineActive = false;
  }
}

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
  if (path === '/api/artifacts') return handleArtifacts(res);
  if (path.startsWith('/api/layout/')) return await handleLayout(req, res, path.slice('/api/layout/'.length));
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
