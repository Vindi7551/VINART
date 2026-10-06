/**
 * 通用版式驱动 —— 吃一份版式规格 JSON，产出草图 / 素材 / 成品
 *
 * 这是把前三张图的实验固化成管道的一步：
 * 此前每张图的 HTML 都是手写模板，从第二张起就不可维护。
 * 现在版式抽成 JSON 规格（src/workflow/design-sketch/design-sketch.ts 定义契约），
 * 这一支脚本负责跑完「草图 → 生图 → 成品」。
 *
 * 运行：
 *   npm run step scripts/step-layout.ts -- <规格.json>              # 全部
 *   npm run step scripts/step-layout.ts -- <规格.json> sketch       # 只出版式草图
 *   npm run step scripts/step-layout.ts -- <规格.json> gen          # 只生成素材
 *   npm run step scripts/step-layout.ts -- <规格.json> final        # 只出成品
 *   npm run step scripts/step-layout.ts -- <规格.json> all --force  # 强制重跑（不跳过已有素材）
 *
 * 产出目录：test_product/layout/<规格名>/
 *   sketch.png / sketch.html
 *   product-cutout.png            ← 实测边界后的带 alpha 抠图
 *   <生成的素材>.png              ← 规格里 generate 声明的
 *   final.png / final.html / final.linked.html
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { assembleFinal } from '../../workflow/compose/assemble';
import type { DesignSketch } from '../../workflow/design-sketch/design-sketch';
import type { AssetRequest } from '../../workflow/assetsgen/asset-order';
import { renderDesign } from '../../workflow/design-sketch/render';
// 读资产 + 渲草图的共用实现（编译器 step-05 也用同一份，见 lib/sketch-runtime.ts）
import { loadAppearance, loadPalette, loadTypography } from '../../workflow/design-sketch/runtime';
import type { DesignAppearance } from '../../workflow/design-sketch/design-appearance';

/** 配色名（溯源注释用）：引用方案给名字，内嵌专属配色给说明 */
function paletteLabel(appearance: DesignAppearance): string {
  if (typeof appearance.palette === 'string') return appearance.palette;
  if (appearance.palette) return '(内嵌专属配色)';
  return 'warm-copper';
}
import { applyAppearance } from '../../workflow/design-sketch/design-appearance';
import { generateAssets } from '../../workflow/assetsgen/image';

// ── 参数 ──

const argv = process.argv.slice(2);
const STAGES = ['sketch', 'gen', 'final', 'all'];
// ⚠️ 带值的选项要把**它的值**也排除掉，否则 `--font slab-bitter` 里的
// `slab-bitter` 会被当成规格路径（不以下划线开头、也不是阶段名）。
const TAKES_VALUE = new Set(['--font', '--product']);
const consumed = new Set<number>();
argv.forEach((a, i) => {
  if (TAKES_VALUE.has(a)) {
    consumed.add(i);
    consumed.add(i + 1);
  }
});
const specPath = argv.find(
  (a, i) => !a.startsWith('--') && !STAGES.includes(a) && !consumed.has(i),
);
// 允许一次传多个阶段（如 `gen final`）——早先只 find 第一个，
// 写 `gen final` 时 final 会被静默忽略。
const stages = argv.filter((a) => STAGES.includes(a));
const stageList = stages.length ? stages : ['all'];
const force = argv.includes('--force');
/** `--font <方案名>` 临时覆盖排版方案（不改规格文件），便于横向试字体 */
const fontOverride = (() => {
  const i = argv.indexOf('--font');
  return i >= 0 ? (argv[i + 1] ?? null) : null;
})();
/**
 * 是否把草图回写进版式库（designassets/layouts/<name>/）。
 * **默认开**——版式草图本来就该存在库里（用户可以反复挑用），
 * 工作目录只放该产品的产物。用 `--no-library` 可临时关掉（比如调版式时不想污染库）。
 */
const toLibrary = !argv.includes('--no-library');

if (!specPath) {
  console.error('用法: npm run step scripts/step-layout.ts -- <规格.json> [sketch|gen|final|all]... [--force] [--no-library] [--product <商品照>] [--font <方案名>]');
  process.exit(1);
}

const DEFAULT_PRODUCT = 'test_product/af39f425-770e-472e-a21e-6964f7864974.png';
/**
 * 商品照路径：`--product <路径>` 可指定；不传时退回砧板默认图。
 * gen 阶段只有**订单引用了 @product** 才会真正读它（needsProduct 条件化）——
 * 没引用就算路径不存在也无妨，所以这里只做路径解析不做存在性检查。
 */
const productIdx = argv.indexOf('--product');
const PRODUCT_PATH = productIdx >= 0 ? resolve(argv[productIdx + 1]) : resolve(DEFAULT_PRODUCT);
/** 元素库根目录 */
/** 版式库根目录 */
const LIBRARY = resolve('designassets/layouts');
/** 字体库根目录 */
/** 图标库根目录 */
/** 字体以 data URL 内联——文件很小（每个约 33KB），换来 HTML 完全自包含、可携 */

const SPEC = resolve(specPath);

// 输出目录覆盖:管线按会话工作目录传 --out(缺省落 test_product/layout/<name>)
const outIdx = argv.indexOf('--out');
const OUT_OVERRIDE = outIdx >= 0 ? resolve(argv[outIdx + 1]) : undefined;

const wants = (s: string) => stageList.includes('all') || stageList.includes(s);

/**
 * 参考图**角色** → 德语说明。
 *
 * 这段说明以前是**手写在提示词的散文里**的（"Referenzbild 1 = das Produkt.
 * Referenzbild 2 = der Layout-Entwurf."）——换用途就得重写一遍，加到三张就乱。
 * 现在由角色自动生成，且顺序与 `refs` 数组严格一致。
 */
function writeToLibrary(
  spec: DesignSketch,
  outDir: string,
  specFile: string,
  paletteName: string,
): string {
  const dir = resolve(LIBRARY, spec.name);
  mkdirSync(dir, { recursive: true });

  const items: [string, string][] = [
    [specFile, 'design-sketch.json'],
    [resolve(dirname(specFile), 'assets.json'), 'assets.json'],
    [resolve(outDir, 'sketch.png'), 'sketch.png'],
    [resolve(outDir, 'sketch.html'), 'sketch.html'],
  ];
  let copied = 0;
  for (const [src, dst] of items) {
    if (!existsSync(src)) continue;
    const target = resolve(dir, dst);
    // 规格本来就住在库里时，src 与 dst 是同一个文件——跳过，否则会自我复制报错
    if (resolve(src) === target) continue;
    copyFileSync(src, target);
    copied++;
  }

  const imgCount = spec.layers.filter((l) => l.type === 'image').length;
  const bg = imgCount ? `含 ${imgCount} 张图` : '无图（纯形状 / 文字）';
  const ovl = spec.layers
    .map((l) => {
      if (l.type === 'image') return `图（${l.asset}）`;
      if (l.type === 'text') {
        const t = Array.isArray(l.text) ? l.text.join(' ') : l.text;
        return `文字「${t}」`;
      }
      return `形状（${l.shape}）`;
    })
    .map((t) => `  - ${t}`)
    .join('\n');

  writeFileSync(
    resolve(dir, 'README.md'),
    [
      `# ${spec.name}`,
      '',
      spec.title,
      '',
      '## 版式结构',
      '',
      `- 画布：${spec.canvas.width}×${spec.canvas.height}`,
      `- 配色：\`${paletteName}\``,
      `- 背景：${bg}`,
      '- 覆盖层：',
      ovl,
      '',
      '## 文件',
      '',
      '| 文件 | 用途 |',
      '|---|---|',
      '| `design-sketch.json` | **版式契约实例**（改版式改这个） |',
      '| `assets.json` | 素材订单：生图提示词与参考图角色（没有则无需生成素材） |',
      '| `sketch.png` | 版式草图渲染，挑版式时看这个 |',
      '| `sketch.html` | 草图源文件（无图片引用，单份即用） |',
      '',
      '> 草图是**通用蓝图**：**不含任何具体商品图**。',
      '> 商品由生图阶段单独传的**商品参考图**交代——所以同一份版式可以直接套用到别的产品。',
      '',
      '## 用法',
      '',
      '```bash',
      `# 用这个版式出图（草图 → 生图 → 成品）`,
      `npm run step scripts/step-layout.ts -- designassets/layouts/${spec.name}/design-sketch.json sketch gen final`,
      '```',
      '',
    ].join('\n'),
    'utf8',
  );

  return `   库 → ${dir}（写入 ${copied} 个文件 + README）`;
}

function needed(p: string) {
  return force || !existsSync(p);
}

async function launch() {
  const { chromium } = await import('playwright');
  try {
    return await chromium.launch({ headless: true });
  } catch {
    return await chromium.launch({ headless: true, channel: 'chromium' });
  }
}

async function main() {
  console.log('\n' + '═'.repeat(68));
  console.log('通用版式驱动');
  console.log('═'.repeat(68));

  if (!existsSync(SPEC)) {
    console.error(`\n✗ 找不到规格文件：${SPEC}`);
    process.exit(1);
  }

  const specRaw = JSON.parse(readFileSync(SPEC, 'utf8')) as DesignSketch;

  // ── 外观文件（与版式同目录）──
  // 配色、描边从版式契约里搬到了这里：草图是灰阶的，它根本不碰颜色，
  // 让模型在产版式时被问配色，只会编出 cold-dusk 这种不存在的名字。
  const appearance = loadAppearance(SPEC);
  // ⚠️ 顺序：**先合并外观、再交给渲染器**（渲染器内部才展开 repeat）。
  const spec: DesignSketch = {
    ...specRaw,
    layers: applyAppearance(specRaw.layers, appearance) as typeof specRaw.layers,
  };

  // ── 素材订单（与版式分开的另一个文件）──
  // 职责分离：版式契约只描述"画面长什么样"，生图请求（提示词/参考图/尺寸）
  // 是**一次性的采购单**，生命周期完全不同，放在同目录的 assets.json。
  // 没有这个文件 = 这个版式不需要生成任何素材（如纯图解的 PT04）。
  const ORDERS_PATH = resolve(dirname(SPEC), 'assets.json');
  const orders: AssetRequest[] = existsSync(ORDERS_PATH)
    ? (JSON.parse(readFileSync(ORDERS_PATH, 'utf8')) as AssetRequest[])
    : [];
  const C = spec.canvas;

  // 输出目录按 **规格里的 name** 决定，不是按文件名。
  // 这样版式文件可以从库（designassets/layouts/<name>/design-sketch.json）里读，
  // 而产物落到 test_product/layout/<name>/——库与产物不混。
  // --out 覆盖:会话工作目录模式(产物落用户选定目录)
  const OUT = OUT_OVERRIDE ?? resolve('test_product/layout', spec.name);
  const palette = loadPalette(appearance.palette ?? 'warm-copper');
  const typography = loadTypography(fontOverride ?? appearance.fontScheme ?? 'legacy-system');

  mkdirSync(OUT, { recursive: true });

  console.log(`\n规格   : ${SPEC}`);
  console.log(`名称   : ${spec.name}`);
  console.log(`标题   : ${spec.title}`);
  console.log(`配色   : ${appearance.palette ?? 'warm-copper'}（来自 design-appearance.json）`);
  console.log(
    `排版   : ${typography.schemeName}${fontOverride ? '（--font 覆盖）' : ''}` +
      `（标题 ${typography.headingFamily.replace(/'/g, '').split(',')[0]} ${typography.headingWeight}）`,
  );
  console.log(`画布   : ${C.width}×${C.height}`);
  const imgCount = spec.layers.filter((l) => l.type === 'image').length;
  console.log(`图片   : ${imgCount} 张`);
  console.log(`图层   : ${spec.layers.length} 个 —— ${spec.layers.map((l) => l.id).join(' → ')}`);
  console.log(`素材订单: ${orders.length} 个${orders.length ? '' : '（无需生成）'}`);
  console.log(`阶段   : ${stageList.join(' + ')}${force ? '（--force 强制重跑）' : ''}`);
  console.log(`输出   : ${OUT}`);

  const browser = await launch();
  const { createBlinkRenderer } = await import('../../render/blink-renderer');

  try {
    // ── ① 版式草图 ──
    if (wants('sketch') || wants('gen')) {
      const sketchPng = resolve(OUT, 'sketch.png');
      if (needed(sketchPng)) {
        console.log('\n[1] 版式草图');
        // 草图模式不引用任何图片、也没有 {{占位符}}（只画灰条与虚线框），
        // emitHtml 的双输出（内联版 / 链接版）对它是纯冗余——两份逐字节相同。
        // 字体也不需要：草图上的标签用默认无衬线即可（省掉 ~100KB 的 woff2 内联）。
        const sketchTyp = { ...typography, faceCss: '' };
        const { html } = renderDesign(spec, { mode: 'sketch', palette, typography: sketchTyp });
        const sketchHtmlPath = resolve(OUT, 'sketch.html');
        // 溯源注释头（meta 是纯注释，插在 doctype 前不影响渲染）
        writeFileSync(
          sketchHtmlPath,
          `<!--\n${sketchMeta(spec, paletteLabel(appearance))}\n-->\n` + html,
        );
        const r = createBlinkRenderer();
        try {
          const out = await r.render({ html: sketchHtmlPath, isFilePath: true }, OUT, {
            width: C.width, height: C.height, deviceScaleFactor: 1, format: 'png', filename: 'sketch',
          });
          console.log(`    PNG  → sketch.png（${(out.size / 1024).toFixed(0)} KB）`);
        } finally {
          await r.dispose();
        }
        console.log(`    HTML → sketch.html（${(statSync(sketchHtmlPath).size / 1024).toFixed(0)} KB）`);
      } else {
        console.log('\n[1] 版式草图已存在，跳过（--force 可强制重跑）');
      }
      // ── 入库规则 ──
      // 只有**规格本身在版式库里**（designassets/layouts/）的版式才同步回库——
      // designassets 是用户认定的可沉淀资产；分析链跑出来的工作版式
      // （如 PT 系列，spec 在 test_product/）不属于资产，不该被复制进库。
      // （曾经只要跑 sketch 就往库里同步，把 8 个工作版式全塞进了资产库——语义错了。）
      const specInLibrary = SPEC.replace(/\\/g, "/").includes("designassets/layouts/");
      if (toLibrary && specInLibrary && existsSync(resolve(OUT, 'sketch.png'))) {
        console.log(writeToLibrary(spec, OUT, SPEC, paletteLabel(appearance)));
      }
    }

    // ── ② 生成素材 ──
  if (wants('gen')) {
      await generateAssets({
        orders,
        spec,
        outDir: OUT,
        productPath: existsSync(PRODUCT_PATH) ? PRODUCT_PATH : null,
        host: browser,
        force,
      });
    }

    // ── ③ 成品 ──
    if (wants('final')) {
      await assembleFinal({
        spec,
        orders,
        outDir: OUT,
        palette,
        typography,
        host: browser,
        nameOverride: fontOverride,
      });
      // 轻量编辑视图:linked.html 注入数据 + 编辑脚本(点选/拖拽/改属性 → 导出 JSON)
      const finalName = fontOverride ? `final-${fontOverride}` : 'final';
      injectEditor(resolve(OUT, `${finalName}.linked.html`), spec, appearance);
    }
    console.log();
  } finally {
    await browser.close();
  }
}

/**
 * 轻量编辑视图:往 linked.html 注入「spec + appearance 数据块」和编辑脚本。
 *
 * 与用户对齐的定位:spec/appearance 是持久层(可追溯),linked.html 是编辑视图——
 * 在成品视觉上点选/拖拽/改属性,「导出」下载完整 JSON,
 * 用户覆盖版式目录同名文件后重跑 final 确认。渲染产物本体(final.html/PNG)不注入。
 */
function injectEditor(linkedPath: string, spec: DesignSketch, appearance: DesignAppearance): void {
  if (!existsSync(linkedPath)) return;
  const editorJs = readFileSync(resolve('scripts/editor.inject.js'), 'utf8');
  // </script> 出现在 JSON 字符串里会提前终结标签,转义掉
  const data = JSON.stringify({ spec, appearance }).replace(/<\/script/gi, '<\\/script');
  let html = readFileSync(linkedPath, 'utf8');
  // 先剥掉上一次的注入块——编辑器脚本更新后,重跑 final 即升级到新版
  // (否则防重复逻辑会让旧版脚本永远留在文件里,新修复进不去。实测踩过)
  const START = '<!--vinart-editor-start-->';
  const END = '<!--vinart-editor-end-->';
  const oldStart = html.indexOf(START);
  if (oldStart >= 0) {
    const oldEnd = html.indexOf(END, oldStart);
    if (oldEnd >= 0) html = html.slice(0, oldStart) + html.slice(oldEnd + END.length);
  }
  // 兼容清理:最早的注入没有标记包裹——按 data 块特征剥除(残留的编辑器脚本
  // 找不到 data 元素会空转退出,无害)
  html = html.replace(
    /<script type="application\/json" id="__vinart-data">[\s\S]*?<\/script>\s*/g,
    '',
  );
  const inject =
    START + '\n' +
    `<script type="application/json" id="__vinart-data">${data}</script>\n` +
    `<script>${editorJs}</script>\n` +
    END + '\n';
  html = html.replace('</body>', inject + '</body>');
  writeFileSync(linkedPath, html, 'utf8');
  console.log(
    `    编辑器已注入 → ${basename(linkedPath)}(浏览器打开:点选/拖拽微调 → 导出 JSON 覆盖同名文件 → 重跑 final)`,
  );
}

function sketchMeta(spec: DesignSketch, paletteName: string): Record<string, string> {  return {
    产物: '版式草图（wireframe）',
    标题: spec.title ?? spec.name,
    画布: `${spec.canvas.width}×${spec.canvas.height} @1x`,
        配色: paletteName,
      用途: '给人检查版式；同时作为生图模型的构图控制输入',
    注意: '草图上只放灰条与虚线框，不放真实文案——否则生成模型会把文案画进成品且必出错字',
    渲染器: 'src/render/blink-renderer.ts',
    规格: 'src/workflow/design-sketch/design-sketch.ts（版式契约）· src/workflow/assetsgen/asset-order.ts（素材订单）',
  };
}

main().catch((e) => {
  console.error('\n✗ 失败:', e);
  process.exit(1);
});
