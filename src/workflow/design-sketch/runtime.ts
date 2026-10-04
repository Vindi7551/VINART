/**
 * ═══════════════════════════════════════════════════════════════════════
 * spec 运行时 —— 把一份 design-sketch.json 变成草图 PNG
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 这段逻辑原本长在 `step-layout.ts` 里，是驱动的私产。抽出来的原因很实际：
 * **编译器（step-05）也要渲草图做校验**——但不能起子进程
 * （实测：某些环境里进程内 spawn 会 `EBUSY`，连 cmd.exe 都不用就走了 node 也不行）。
 *
 * 于是"读 spec → 读配色/字体 → 渲染 → 落盘"必须能**在当前进程内**调用。
 *
 * ⚠️ `wrap()` 那条规则在这里同样成立：渲染器**不依赖文件系统**，
 * 所有读文件的事都在这一层做完（字体内联成 data URL）。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { renderDesign } from './render';
import { applyAppearance, type DesignAppearance } from './design-appearance';
import {
  DEFAULT_TYPOGRAPHY,
  PALETTE,
  type Palette,
  type Typography,
} from './render-style';
import type { DesignSketch } from './design-sketch';

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
  /** 草图 HTML 的绝对路径 */
  html: string;
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
    const { html } = renderDesign(spec, {
      mode: 'sketch',
      palette,
      typography: { ...typography, faceCss: '' },
    });
    const htmlPath = resolve(OUT, 'sketch.html');
    writeFileSync(htmlPath, html, 'utf8');

    const { createBlinkRenderer } = await import('../../render/blink-renderer');
    const r = createBlinkRenderer();
    try {
      const out = await r.render({ html: htmlPath, isFilePath: true }, OUT, {
        width: spec.canvas.width,
        height: spec.canvas.height,
        deviceScaleFactor: 1,
        format: 'png',
        filename: 'sketch',
      });
      return { ok: true, png: out.imagePath, html: htmlPath };
    } finally {
      await r.dispose();
    }
  } catch (e) {
    return { ok: false, png: '', html: '', error: (e as Error).message };
  }
}
