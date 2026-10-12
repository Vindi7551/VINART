/**
 * ═══════════════════════════════════════════════════════════════════════
 * spec 运行时 —— 把一份 design-sketch.json 变成草图 PNG
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 这段逻辑原本长在旧驱动脚本里，是它的私产。抽出来的原因很实际：
 * **方案编译那一步也要渲草图做校验**——但不能起子进程
 * （实测：某些环境里进程内 spawn 会 `EBUSY`，连 cmd.exe 都不用就走了 node 也不行）。
 *
 * 于是"读 spec → 读配色/字体 → 渲染 → 落盘"必须能**在当前进程内**调用。
 *
 * ⚠️ `wrap()` 那条规则在这里同样成立：渲染器**不依赖文件系统**，
 * 所有读文件的事都在这一层做完（字体内联成 data URL）。
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { renderDesign } from './declarative/render';
import { applyAppearance, type DesignAppearance } from '../document/design-appearance';
import {
  DEFAULT_TYPOGRAPHY,
  PALETTE,
  type Palette,
  type Typography,
} from './declarative/render-style';
import type { DesignSketch } from '../document/design-sketch';
import type { BlinkRenderer } from './rasterize/blink-renderer';

// ══════════════════════════════════════════════════════════════════════
// 共享渲染器
// ══════════════════════════════════════════════════════════════════════

/**
 * 进程内共享一个 Blink 渲染器（= 共享一个浏览器实例）。
 *
 * 实测（_probe-render-phases.ts，2026-10-07）：单张渲染六步耗时里
 * launch 1.06s / context 0.43s / goto 0.02s / 截图 0.21s——
 * 热路径渲染只要 ~0.7s。此前 renderSketchFile 每次调用都新建并关闭浏览器，
 * 每张草图要白付 launch + close（当时 close 5.8s，其中 4.5s 是删临时
 * profile 目录撞 Defender；改自管 userDataDir 后 close 降到 ~1.5s，
 * 见 blink-renderer.ts 的注释）。
 *
 * 共享后 close 只在两处发生：CLI 脚本收尾的显式 disposeSketchRenderer()、
 * 服务进程的 5 分钟空闲定时器（unref，不阻塞进程退出）。
 * 并发安全：blink-renderer 每次 render 开独立 context，多子 agent 并发渲染
 * 共享同一浏览器实例没有冲突。
 */
const RENDERER_IDLE_MS = 5 * 60_000;

let sharedRenderer: BlinkRenderer | null = null;
let idleTimer: NodeJS.Timeout | null = null;

async function disposeSharedRenderer(): Promise<void> {
  // 先置空再关：若还有并发渲染在路上，会拿到 null 走新建，不会撞一个
  // 正在关闭的浏览器
  const r = sharedRenderer;
  sharedRenderer = null;
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  await r?.dispose();
}

let exitHooksInstalled = false;

/**
 * **显式清理共享渲染器**（关闭浏览器并等待退出；自管 userDataDir 后 ~1.5s）。
 *
 * CLI 脚本（compile 等）在收尾 `process.exit` 前必须
 * **await** 本函数——`process.exit` 会立刻终止进程，浏览器若还活着，
 * 整条命令组会被 SIGTERM 带走（实测 exit 1，连 shell 里后续命令都不执行）。
 * 服务进程（design harness）不调用：靠 5 分钟空闲定时器自动回收。
 */
export async function disposeSketchRenderer(): Promise<void> {
  await disposeSharedRenderer();
}

/**
 * 拿共享渲染器实例（没有就启动一个）——给**渲成品**的工具链路复用：
 * assembleFinal 的文字自适应测量（host.newPage）与成品渲染共用这一个浏览器。
 * 生命周期与 renderSketchFile 同一套（5 分钟空闲自动回收）。
 */
export async function getSharedRenderer(): Promise<BlinkRenderer> {
  return withSharedRenderer(async (r) => r);
}

/**
 * 进程退出前的清理兜底（首次创建共享渲染器时装一次）。
 *
 * 正常收尾（事件循环排空）时触发；注意 `process.exit()` 不走这里，
 * 所以 CLI 脚本仍需显式调 `disposeSketchRenderer()`。
 */
function ensureExitHooks(): void {
  if (exitHooksInstalled) return;
  exitHooksInstalled = true;
  process.on('beforeExit', () => {
    // fire-and-forget：pending 的 close 让事件循环留到浏览器死透再排空
    void disposeSharedRenderer();
  });
}

async function withSharedRenderer<T>(fn: (r: BlinkRenderer) => Promise<T>): Promise<T> {
  if (!sharedRenderer) {
    const { createBlinkRenderer } = await import('./rasterize/blink-renderer');
    // 草图固定 1:1（deviceScaleFactor 是 persistent context 的实例级选项）
    sharedRenderer = createBlinkRenderer({ deviceScaleFactor: 1 });
    ensureExitHooks();
  }
  const r = sharedRenderer;
  if (idleTimer) clearTimeout(idleTimer);
  try {
    return await fn(r);
  } finally {
    if (sharedRenderer === r) {
      idleTimer = setTimeout(disposeSharedRenderer, RENDERER_IDLE_MS);
      idleTimer.unref();
    }
  }
}

const ELEMENTS = resolve('designassets/elements');
const FONT_ROOT = resolve('designassets/fonts');
const MIME_WOFF2 = 'font/woff2';

// ══════════════════════════════════════════════════════════════════════
// 读资产
// ══════════════════════════════════════════════════════════════════════

/**
 * 解析配色：传**字符串** → 引用 `designassets/elements/palette/<名>.json`（资产库沉淀）；
 * 传**对象** → 外观文件里内嵌的专属配色（每个产品自动生成，见 appearance 编译器），
 * 不查库、不落资产——好用的由人再提升进库。两种都缺 ink 时补渲染器兜底 ink。
 */
export function loadPalette(nameOrPalette: string | Record<string, string>): Palette {
  if (typeof nameOrPalette !== 'string') {
    const ink = nameOrPalette.ink ?? PALETTE.ink;
    if (!nameOrPalette.ink) {
      console.warn(`    ⚠️ 内嵌配色缺少 ink 角色，已补渲染器兜底值`);
    }
    return { ink, ...nameOrPalette };
  }
  const p = resolve(ELEMENTS, 'palette', `${nameOrPalette}.json`);
  if (!existsSync(p)) {
    console.warn(`    ⚠️ 找不到配色 ${p}，使用代码内的兜底默认`);
    return PALETTE;
  }
  return JSON.parse(readFileSync(p, 'utf8')) as Palette;
}

/**
 * 读取排版方案（`designassets/fonts/schemes/<名>.json`）并生成 `@font-face`。
 *
 * 字体文件从 `designassets/fonts/families/<家族>/<字重>.woff2` 读入，
 * **内联成 data URL**——每个约 33KB，换来 HTML 完全自包含、换机器不变样。
 */
export function loadTypography(name: string): Typography {
  const schemePath = resolve(FONT_ROOT, 'schemes', `${name}.json`);
  if (!existsSync(schemePath)) {
    console.warn(`    ⚠️ 找不到排版方案 ${schemePath}，使用兜底默认（系统字体）`);
    return DEFAULT_TYPOGRAPHY;
  }

  const scheme = JSON.parse(readFileSync(schemePath, 'utf8')) as {
    heading: { family: string; weight: number; letterSpacing?: string };
    body: { family: string; weight: number; letterSpacing?: string };
    faces?: { family: string; weights: number[] }[];
  };

  const faces: string[] = [];
  for (const face of scheme.faces ?? []) {
    // 目录名去空格：'Roboto Slab' → 'RobotoSlab'
    const dir = resolve(FONT_ROOT, 'families', face.family.replace(/\s+/g, ''));
    for (const w of face.weights) {
      const file = resolve(dir, `${w}.woff2`);
      if (!existsSync(file)) {
        console.warn(`    ⚠️ 缺字体文件 ${file}`);
        continue;
      }
      const b64 = readFileSync(file).toString('base64');
      faces.push(
        `@font-face{font-family:'${face.family}';font-style:normal;font-weight:${w};` +
          `font-display:block;src:url(data:${MIME_WOFF2};base64,${b64}) format('woff2')}`,
      );
    }
  }

  // 兜底栈：万一字体没加载上，也落到系统衬线而不是无衬线，避免观感跳变
  const stack = (f: string) => `'${f}', Georgia, "Times New Roman", serif`;

  return {
    faceCss: faces.join('\n  '),
    schemeName: name,
    headingFamily: stack(scheme.heading.family),
    headingWeight: scheme.heading.weight,
    headingLetterSpacing: scheme.heading.letterSpacing ?? '.02em',
    bodyFamily: stack(scheme.body.family),
    bodyWeight: scheme.body.weight,
    bodyLetterSpacing: scheme.body.letterSpacing ?? '.02em',
  };
}

// ══════════════════════════════════════════════════════════════════════
// 渲草图（一站式）
// ══════════════════════════════════════════════════════════════════════

export interface SketchRenderResult {
  ok: boolean;
  /** 草图 PNG 的绝对路径 */
  png: string;
  /** 失败时的原因 */
  error?: string;
}

/**
 * 读一个版式目录里的**外观文件**（与 design-sketch.json 同目录）。
 *
 * 没有这个文件 = 该版式没有额外外观（颜色走配色方案的角色默认值）——完全合法。
 */
export function loadAppearance(specPath: string): DesignAppearance {
  const p = resolve(dirname(specPath), 'design-appearance.json');
  if (!existsSync(p)) return {};
  return JSON.parse(readFileSync(p, 'utf8')) as DesignAppearance;
}

/**
 * 读一份 design-sketch.json，渲出草图 PNG。
 *
 * **不开子进程**（见文件头说明），整个过程在当前进程内完成。
 * 草图不需要商品素材（它只画区域框），所以这里**不跑抠图**。
 */
export async function renderSketchFile(
  specPath: string,
  outDirOverride?: string,
): Promise<SketchRenderResult> {
  try {
    const specRaw = JSON.parse(readFileSync(specPath, 'utf8')) as DesignSketch;
    const appearance = loadAppearance(specPath);

    // 契约里没有颜色（它们在 design-appearance.json），渲染前按 id 合并进来。
    // 渲染器拿到的是「节点 + 外观」——类型上见 `shared.ts` 的 `Painted`。
    const spec: DesignSketch = {
      ...specRaw,
      layers: applyAppearance(specRaw.layers, appearance),
    };

    const palette = loadPalette(appearance.palette ?? 'warm-copper');
    const typography = loadTypography(appearance.fontScheme ?? 'legacy-system');
    const OUT = outDirOverride ?? resolve('test_product/layout', spec.name);
    mkdirSync(OUT, { recursive: true });

    // 草图不引用图片，也不需要内联字体（省 ~100KB）——
    // 它上面只有灰条与默认无衬线的区域标签。
    //
    // ⚠️ **不再落盘 sketch.html**（2026-10-09）：草图完全可由 spec + appearance
    // 编译出来，落盘只是多一份会漂移的快照；而且它是渲染输入这件事本身是怪癖
    // ——现在直接渲内存字符串（与 final.png 的做法对齐）。
    const { html } = renderDesign(spec, {
      mode: 'sketch',
      palette,
      typography: { ...typography, faceCss: '' },
    });

    return withSharedRenderer(async (r) => {
      const out = await r.render({ html }, OUT, {
        width: spec.canvas.width,
        height: spec.canvas.height,
        format: 'png',
        filename: 'sketch',
      });
      return { ok: true, png: out.imagePath };
    });
  } catch (e) {
    return { ok: false, png: '', error: (e as Error).message };
  }
}
