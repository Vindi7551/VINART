/**
 * 验证：AI 图作背景 + HTML+CSS 文字 的混合路线（参照 G03.png 的设计语言）
 *
 * 三步：
 *   ① 渲染版式草图（wireframe）—— 给人检查版式，同时作生图模型的构图控制输入
 *   ② 生图：场景图 + 细节图（两张独立生成）
 *   ③ 合成：AI 图当底，细节图斜切嵌入左上，文字与徽章用 HTML+CSS
 *
 * 这是对「AI 背景 + HTML 文字」路线的可行性验证。
 * 参考图 G03.png 本身就是这条路线做出来的——它的文字边缘锐利、徽章是完美几何圆，
 * 不可能是生成模型画的。
 *
 * 运行：
 *   npm run step scripts/_probe-g03.ts            # 全部三步
 *   npm run step scripts/_probe-g03.ts -- sketch  # 只出版式草图
 *   npm run step scripts/_probe-g03.ts -- gen     # 只生图
 *   npm run step scripts/_probe-g03.ts -- compose # 只合成
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getImageGateway } from '../src/config';
import { emitHtml } from '../src/workflow/compose/emit-html';

const PRODUCT = resolve('test_product/af39f425-770e-472e-a21e-6964f7864974.png');
const OUT = resolve('test_product/g03');
const C = 2000;
const REF_MAX = 768;

const argv = process.argv.slice(2);
const stage = argv.find((a) => !a.startsWith('--')) ?? 'all';
const run = (s: string) => stage === 'all' || stage === s;

// ══════════════════════════════════════════════════════════
// 版式参数（对照 G03.png 量出来的）
// ══════════════════════════════════════════════════════════

const LAYOUT = {
  /** 左上细节图：斜切四边形，右边缘向内倾斜 */
  inset: { x: 0, y: 0, w: 0.44, h: 0.40, skew: 0.22 },
  /** 右上标题：两行 + 上下细横线 */
  headline: { x: 0.47, y: 0.055, w: 0.50, ruleGap: 0.012 },
  /**
   * 中央商品：0.68（原 0.62）。
   * 首次成品里商品只占画布宽约 50%，而参考图 G03 约 64%，明显偏小。
   * 草图里放大到 0.68 才能把模型往大里带。
   */
  product: { cx: 0.58, cy: 0.52, w: 0.68 },
  /** 底部信息条 */
  bar: { y: 0.85, h: 0.15 },
  /** 商品的**目标机位**——写进草图作为标注，模型的机位跟随提示词并不稳 */
  targetAngleDe: 'ZIEL-ANSICHT: 3/4 von schräg vorne, leicht von oben',
};

/** 颜色取自 G03.png */
const COLOR = {
  copper: '#B8722F',
  copperLight: '#D9A05B',
  cream: '#F2E8DA',
  dark: '#150D06',
  barBg: '#120A04',
};

// ══════════════════════════════════════════════════════════

async function launch() {
  const { chromium } = await import('playwright');
  try {
    return await chromium.launch({ headless: true });
  } catch {
    return await chromium.launch({ headless: true, channel: 'chromium' });
  }
}

/** 实测商品边界 + 抠图 + 压缩参考图 */
async function prepareProduct(browser: Awaited<ReturnType<typeof launch>>) {
  const page = await browser.newPage();
  const b64 = readFileSync(PRODUCT).toString('base64');
  const r = await page.evaluate(
    async (a: { b64: string; max: number }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${a.b64}`;
      await img.decode();

      const full = document.createElement('canvas');
      full.width = img.naturalWidth;
      full.height = img.naturalHeight;
      const fctx = full.getContext('2d')!;
      fctx.drawImage(img, 0, 0);
      const W = full.width;
      const H = full.height;
      const px = fctx.getImageData(0, 0, W, H).data;

      const TH = 225;
      let minX = W, minY = H, maxX = -1, maxY = -1;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          if (px[i] < TH || px[i + 1] < TH || px[i + 2] < TH) {
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
          }
        }
      }
      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;

      // 带 alpha 的完整抠图（含支架）
      const cut = document.createElement('canvas');
      cut.width = bw;
      cut.height = bh;
      const cctx = cut.getContext('2d')!;
      cctx.drawImage(img, minX, minY, bw, bh, 0, 0, bw, bh);
      const id = cctx.getImageData(0, 0, bw, bh);
      const d = id.data;
      const OPAQUE_AT = 225;
      const CLEAR_AT = 248;
      for (let i = 0; i < d.length; i += 4) {
        const mn = Math.min(d[i], d[i + 1], d[i + 2]);
        d[i + 3] =
          mn <= OPAQUE_AT ? 255
          : mn >= CLEAR_AT ? 0
          : Math.round(255 * (1 - (mn - OPAQUE_AT) / (CLEAR_AT - OPAQUE_AT)));
      }
      cctx.putImageData(id, 0, 0);

      // 参考图（白底 flatten）
      const s = Math.min(1, a.max / Math.max(W, H));
      const rw = Math.round(W * s);
      const rh = Math.round(H * s);
      const rc = document.createElement('canvas');
      rc.width = rw;
      rc.height = rh;
      const rctx = rc.getContext('2d')!;
      rctx.fillStyle = '#fff';
      rctx.fillRect(0, 0, rw, rh);
      rctx.drawImage(img, 0, 0, rw, rh);

      return {
        bbox: { bw, bh },
        cut: cut.toDataURL('image/png'),
        ref: rc.toDataURL('image/jpeg', 0.9),
      };
    },
    { b64, max: REF_MAX },
  );
  await page.close();
  return r;
}

// ══════════════════════════════════════════════════════════
// ① 版式草图
// ══════════════════════════════════════════════════════════

/** 模板用 `{{PRODUCT_CUTOUT}}` 占位，由 emitHtml 替换成 data URL 或文件名 */
function sketchTemplate(bbox: { bw: number; bh: number }): string {
  const pw = C * LAYOUT.product.w;
  const ph = (pw * bbox.bh) / bbox.bw;
  const pLeft = C * LAYOUT.product.cx - pw / 2;
  const pTop = C * LAYOUT.product.cy - ph / 2;

  const iw = C * LAYOUT.inset.w;
  const ih = C * LAYOUT.inset.h;

  const hx = C * LAYOUT.headline.x;
  const hy = C * LAYOUT.headline.y;
  const hw = C * LAYOUT.headline.w;

  const barY = C * LAYOUT.bar.y;
  const barH = C * LAYOUT.bar.h;

  const font = `Rockwell, "Roboto Slab", "Bookman Old Style", Georgia, serif`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:${C}px;height:${C}px;overflow:hidden}
  body{font-family:${font}}
  .canvas{position:relative;width:${C}px;height:${C}px;background:#EDEDED;overflow:hidden}
  .zone{position:absolute;border:3px dashed #9199A1}
  .lbl{position:absolute;font-family:Arial,sans-serif;font-size:28px;font-weight:700;
       color:#5F6368;background:rgba(255,255,255,.9);padding:5px 12px;letter-spacing:.05em}
  .bar{position:absolute;background:#C4C9CE;border-radius:4px}
  .prod{position:absolute;left:${pLeft}px;top:${pTop}px;width:${pw}px;height:${ph}px}
  .prod img{width:100%;height:100%;display:block}
</style></head><body><div class="canvas">

  <!-- ① 左上：斜切细节图区 -->
  <div class="zone" style="left:${0};top:${0};width:${iw}px;height:${ih}px;
       clip-path:polygon(0 0,100% 0,${100 - LAYOUT.inset.skew * 100}% 100%,0 100%)"></div>
  <div class="lbl" style="left:24px;top:24px">DETAIL-MAKRO (Holzmaserung + Gravur)</div>
  <div class="bar" style="left:180px;top:${ih * 0.45}px;width:${iw * 0.5}px;height:26px"></div>

  <!-- ② 右上：标题区，上下细横线 -->
  <div class="zone" style="left:${hx - 30}px;top:${hy - 30}px;width:${hw + 60}px;height:${C * 0.235}px"></div>
  <div class="lbl" style="left:${hx}px;top:${hy - 62}px">HEADLINE 2 ZEILEN + LINIEN</div>
  <div class="bar" style="left:${hx}px;top:${hy}px;width:${hw}px;height:${C * 0.062}px"></div>
  <div class="bar" style="left:${hx + hw * 0.18}px;top:${hy + C * 0.075}px;width:${hw * 0.82}px;height:${C * 0.062}px"></div>

  <!-- ③ 中央：商品 -->
  <div class="zone" style="left:${C * 0.20}px;top:${C * 0.22}px;width:${C * 0.78}px;height:${C * 0.62}px"></div>
  <div class="lbl" style="left:${C * 0.22}px;top:${C * 0.235}px">PRODUKT — ${LAYOUT.targetAngleDe}</div>
  <div class="prod"><img src="{{PRODUCT_CUTOUT}}" alt=""></div>

  <!-- ④ 底部信息条：两个圆形徽章 -->
  <div class="zone" style="left:0;top:${barY}px;width:${C}px;height:${barH}px"></div>
  <div class="lbl" style="left:24px;top:${barY + 16}px">FUSSLEISTE: 2 RUNDE BADGES + TEXT</div>
  <div style="position:absolute;left:${C * 0.075}px;top:${barY + barH * 0.32}px;width:${C * 0.075}px;height:${C * 0.075}px;
       border:4px dashed #9199A1;border-radius:50%"></div>
  <div class="bar" style="left:${C * 0.175}px;top:${barY + barH * 0.42}px;width:${C * 0.22}px;height:26px"></div>
  <div style="position:absolute;left:${C * 0.53}px;top:${barY + barH * 0.3}px;width:${C * 0.075}px;height:${C * 0.075}px;
       border:4px dashed #9199A1;border-radius:50%"></div>
  <div class="bar" style="left:${C * 0.63}px;top:${barY + barH * 0.42}px;width:${C * 0.22}px;height:26px"></div>

</div></body></html>`;
}

// ══════════════════════════════════════════════════════════
// ③ 成品合成
// ══════════════════════════════════════════════════════════

/** 模板用 `{{SCENE}}` / `{{DETAIL}}` 占位，由 emitHtml 替换成 data URL 或文件名 */
function finalTemplate(): string {
  const iw = C * LAYOUT.inset.w;
  const ih = C * LAYOUT.inset.h;
  const skewPct = LAYOUT.inset.skew * 100;

  const hx = C * LAYOUT.headline.x;
  const hy = C * LAYOUT.headline.y;
  const hw = C * LAYOUT.headline.w;

  const barY = C * LAYOUT.bar.y;
  const barH = C * LAYOUT.bar.h;
  const font = `Rockwell, "Roboto Slab", "Bookman Old Style", Georgia, serif`;

  // 刀刃图标：盲改两次都失败（一次像刷子，一次像叶子）。
  // 用 scripts/_probe-icons.ts 把 5 个变体放大到 240px 对比后选定变体 C（旋转 -45°）：
  // 刀身收尖 + 护手 + 握柄三段可分辨，是唯一稳定读作"刀"的方案。
  // 教训：在 94px 的徽章里猜形状是低效的，放大渲染对比是零成本的。
  const knifeIcon = `<svg viewBox="0 0 64 64" width="100%" height="100%">
    <g transform="rotate(-45 32 32)" fill="${COLOR.copperLight}">
      <rect x="10" y="27" width="14" height="11" rx="3"/>
      <rect x="24" y="26" width="3" height="13" rx="1"/>
      <path d="M27 25 L45 25 Q56 27 58 33 Q45 40 27 40 Z"/>
    </g>
  </svg>`;

  // 木纹图标：对比后选 3 道（变体 B）——缩到徽章尺寸时比 4 道更清楚
  const grainIcon = `<svg viewBox="0 0 64 64" width="100%" height="100%">
    <defs><clipPath id="grainClip"><circle cx="32" cy="32" r="28"/></clipPath></defs>
    <g clip-path="url(#grainClip)" fill="none" stroke="${COLOR.copperLight}"
       stroke-width="4" stroke-linecap="round">
      <path d="M-4 16 C12 6 26 26 40 16 C54 6 64 22 72 14"/>
      <path d="M-4 32 C12 22 26 42 40 32 C54 22 64 38 72 30"/>
      <path d="M-4 48 C12 38 26 58 40 48 C54 38 64 54 72 46"/>
    </g>
  </svg>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:${C}px;height:${C}px;overflow:hidden}
  body{font-family:${font}}
  .canvas{position:relative;width:${C}px;height:${C}px;background:${COLOR.dark};overflow:hidden}

  /* 底色：AI 生成的场景图 */
  .scene{position:absolute;inset:0}
  .scene img{width:100%;height:100%;object-fit:cover;display:block}

  /* 左上：AI 细节图，斜切嵌入 */
  .inset{position:absolute;left:0;top:0;width:${iw}px;height:${ih}px;
         clip-path:polygon(0 0,100% 0,${100 - skewPct}% 100%,0 100%);}
  .inset img{width:100%;height:100%;object-fit:cover;display:block}
  /* 斜边的铜色细线：首次用伪元素 + rotate 的方案不生效（线完全看不见），
     改由 SVG 沿斜边直接画线，位置由几何算出来，不靠变换蒙。 */
  .inset-edge{position:absolute;left:0;top:0;width:${iw}px;height:${ih}px;z-index:2}

  /* 右上标题 */
  .hl{position:absolute;left:${hx}px;top:${hy}px;width:${hw}px;text-align:right;
      color:${COLOR.copper};font-weight:700;line-height:1.02;letter-spacing:-.01em;
      font-size:132px;text-shadow:0 3px 18px rgba(0,0,0,.55)}
  .hl .l2{display:block;font-size:118px}
  .rule{position:absolute;left:${hx}px;width:${hw}px;height:3px;background:${COLOR.copper}}
  .rule-a{top:${hy - 26}px}
  .rule-b{top:${hy + 268}px}

  /* 底部信息条 */
  .bar{position:absolute;left:0;top:${barY}px;width:${C}px;height:${barH}px;
       background:linear-gradient(180deg,rgba(10,6,2,.72) 0%,rgba(6,4,1,.92) 100%)}
  .badge{position:absolute;top:${barY + barH * 0.3}px;width:${C * 0.085}px;height:${C * 0.085}px;
       border:4px solid ${COLOR.copper};border-radius:50%;padding:${C * 0.019}px}
  .btxt{position:absolute;color:${COLOR.cream};font-weight:700;font-size:56px;line-height:1.1}
  .divider{position:absolute;top:${barY + barH * 0.26}px;width:2px;height:${barH * 0.48}px;background:${COLOR.copper}80}
</style></head><body><div class="canvas">

  <div class="scene"><img src="{{SCENE}}" alt=""></div>

  <div class="inset"><img src="{{DETAIL}}" alt=""></div>
  <svg class="inset-edge" viewBox="0 0 ${iw} ${ih}" preserveAspectRatio="none">
    <line x1="${iw}" y1="0" x2="${iw * (1 - LAYOUT.inset.skew)}" y2="${ih}"
          stroke="${COLOR.copper}" stroke-width="5"/>
  </svg>

  <div class="rule rule-a"></div>
  <div class="hl">Akazienholz<span class="l2">mit Charakter</span></div>
  <div class="rule rule-b"></div>

  <div class="bar"></div>
  <div class="badge" style="left:${C * 0.07}px">${knifeIcon}</div>
  <div class="btxt" style="left:${C * 0.175}px;top:${barY + barH * 0.38}px">Messerfreundlich</div>
  <div class="divider" style="left:${C * 0.505}px"></div>
  <div class="badge" style="left:${C * 0.545}px">${grainIcon}</div>
  <div class="btxt" style="left:${C * 0.65}px;top:${barY + barH * 0.30}px">Jede Maserung<br>ein Unikat</div>

</div></body></html>`;
}

// ══════════════════════════════════════════════════════════
// 主流程
// ══════════════════════════════════════════════════════════

const SKETCH_PNG = resolve(OUT, 'sketch.png');
const SCENE_PNG = resolve(OUT, 'scene.png');
const DETAIL_PNG = resolve(OUT, 'detail.png');
/** 商品抠图存成文件，才能被 emitHtml 当作资源内联/链接 */
const CUTOUT_PNG = resolve(OUT, 'product-cutout.png');

async function main() {
  console.log('\n' + '═'.repeat(66));
  console.log('验证 — AI 图作背景 + HTML+CSS 文字（G03 设计语言）');
  console.log('═'.repeat(66));
  mkdirSync(OUT, { recursive: true });

  const browser = await launch();
  const { createBlinkRenderer } = await import('../src/render/blink-renderer');

  try {
    console.log('\n[0] 准备商品素材（实测边界 + 抠图）');
    const P = await prepareProduct(browser);
    console.log(`    主体 ${P.bbox.bw}×${P.bbox.bh}`);
    // 抠图落盘：既是可复用的素材，也是 HTML 源文件要内联的资源
    writeFileSync(CUTOUT_PNG, Buffer.from(P.cut.split(',')[1], 'base64'));
    console.log(`    抠图 → ${CUTOUT_PNG}`);

    // ── ① 版式草图 ──
    if (run('sketch') || run('gen') || run('compose')) {
      if (!existsSync(SKETCH_PNG) || run('sketch')) {
        console.log('\n[1] 渲染版式草图 + 落盘 HTML 源文件');
        const template = sketchTemplate(P.bbox);
        const emitted = emitHtml({
          template,
          assets: { PRODUCT_CUTOUT: 'product-cutout.png' },
          assetDir: OUT,
          outDir: OUT,
          name: 'sketch',
          meta: {
            产物: '版式草图（wireframe）',
            槽位: 'G03（PT08 材料质感与工艺）',
            画布: `${C}×${C} @1x`,
            用途: '给人检查版式；同时作为生图模型的构图控制输入',
            渲染器: 'src/render/blink-renderer.ts',
          },
        });
        // 渲染必须用替换后的 HTML，不能拿含 {{占位符}} 的模板去渲（图会断）
        const r = createBlinkRenderer();
        try {
          const out = await r.render({ html: emitted.selfContainedHtml }, OUT, {
            width: C, height: C, deviceScaleFactor: 1, format: 'png', filename: 'sketch',
          });
          console.log(`    PNG → ${out.imagePath}（${(out.size / 1024).toFixed(0)} KB）`);
        } finally {
          await r.dispose();
        }
        console.log(`    HTML → ${emitted.selfContained}（${(emitted.selfContainedBytes / 1024).toFixed(0)} KB 自包含）`);
        console.log(`           ${emitted.linked}（${(emitted.linkedBytes / 1024).toFixed(0)} KB 相对路径，便于改 CSS）`);
      } else {
        console.log(`\n[1] 版式草图已存在，跳过`);
      }
    }

    // ── ② 生图 ──
    const gateway = getImageGateway();

    if ((run('gen') || run('compose') || run('all')) && needed(SCENE_PNG)) {
      console.log('\n[2] 生成场景图（暗调车库 + 复古车 + 商品 3/4 视角）');
      const prompt = [
        'Fotorealistische Produktaufnahme in dunkler, stimmungsvoller Atmosphäre,',
        'wie in einer Privatgarage eines Sammlers klassischer Automobile.',
        '',
        'KAMERA UND GRÖSSE (wichtig):',
        'Deutliche 3/4-Ansicht von schräg vorne, leicht von oben.',
        'Das Brett ist der Hauptdarsteller und nimmt etwa zwei Drittel der Bildbreite ein,',
        'es steht aufrecht im schwarzen Metallständer und ist mittig leicht rechts platziert.',
        '',
        'Das Produkt aus dem Referenzbild – das Akazienholzbrett mit dem schwarzen',
        'Metallständer.',
        '',
        'GRAVUR (sehr wichtig, bitte exakt übernehmen):',
        'Auf dem Brett steht in dieser Reihenfolge und Schreibweise:',
        '«SCHONEND BEHANDELN» als oberste Zeile, darunter gross «KLASSIKER»,',
        'darunter die grosse Zahl «40», darunter in Schreibschrift',
        '«Zustand entspricht Alter und Laufleistung»,',
        'darunter drei kleine Symbole mit Text.',
        'Die Buchstaben müssen korrekt sein – kein Fantasietext, keine veränderten Wörter.',
        '',
        'Hintergrund: ein dunkelroter Oldtimer mit verchromtem Kühlergrill und',
        'rundem Scheinwerfer, stark unscharf. Auf der dunklen Steinplatte links unten',
        'liegen abgewetzte braune Lederhandschuhe. Rechts unten ein Autoschlüssel',
        'mit Lederanhänger. Warmes, gerichtetes Licht von rechts, tiefe Schatten,',
        'goldene Reflexe auf Chrom, sehr geringe Schärfentiefe, cineastisch.',
        '',
        'Keine Personen, keine lesbaren Fremdtexte, keine Logos, kein Wasserzeichen.',
        'Der obere Bereich bleibt ruhig und dunkel, ohne Objekte.',
      ].join(' ');

      const ref = await downscale(browser, PRODUCT, REF_MAX);
      const sketchRef = await downscale(browser, SKETCH_PNG, 1024);
      const r = await gateway.generate({
        prompt, referenceImages: [ref, sketchRef], size: '2048x2048', count: 1, format: 'png',
      });
      await save(r.images[0].url, SCENE_PNG, 'scene');
    } else if (run('gen') || run('compose') || run('all')) {
      console.log('\n[2] 场景图已存在，跳过');
    }

    if ((run('gen') || run('compose') || run('all')) && needed(DETAIL_PNG)) {
      console.log('\n[3] 生成细节图（木纹 + 雕刻微距）');
      // 明确指定字母 K：对应商品雕刻的 KLASSIKER，与参考图 G03 一致。
      // 首次没指定，模型自选了 A —— 虽然与标题 Akazienholz 呼应，但不符合参考图。
      const prompt = [
        'Extreme Makroaufnahme der Oberfläche eines Akazienholzes, Nahaufnahme',
        'eines großen, tief eingeschnittenen Buchstabens «K».',
        'Der Buchstabe ist in einer breiten, kräftigen Serifenschrift geschnitten,',
        'wie eine Lasergravur in Massivholz, mit deutlich sichtbarer Schnittkante und',
        'leicht dunkler verbrannten Innenflächen.',
        'Man sieht die wellige, natürliche Holzmaserung mit deutlichen hellen und',
        'dunklen Jahresringen. Warmes gerichtetes Streiflicht von rechts,',
        'dunkler Hintergrund, sehr hohe Detailauflösung, fotorealistisch.',
        'Nur Holz und die Gravur, keine Gegenstände, keine Personen, keine Texte, keine Logos.',
      ].join(' ');

      const ref = await downscale(browser, PRODUCT, REF_MAX);
      const r = await gateway.generate({
        prompt, referenceImages: [ref], size: '2048x2048', count: 1, format: 'png',
      });
      await save(r.images[0].url, DETAIL_PNG, 'detail');
    } else if (run('gen') || run('compose') || run('all')) {
      console.log('\n[3] 细节图已存在，跳过');
    }

    // ── ③ 合成 ──
    if (run('compose') || run('all')) {
      console.log('\n[4] 合成成品 + 落盘 HTML 源文件');
      if (!existsSync(SCENE_PNG) || !existsSync(DETAIL_PNG)) {
        console.error('    ✗ 缺少场景图或细节图，先跑 -- gen');
        process.exit(1);
      }
      const template = finalTemplate();
      const emitted = emitHtml({
        template,
        assets: {
          SCENE: 'scene.png',
          DETAIL: 'detail.png',
        },
        assetDir: OUT,
        outDir: OUT,
        name: 'final',
        meta: {
          产物: '成品图 — 版式源文件',
          槽位: 'G03（PT08 材料质感与工艺）',
          画布: `${C}×${C} @1x`,
          图层结构: 'AI 场景图作底 → 斜切细节图嵌入左上 → HTML+CSS 文字与徽章层',
          文字层: '全部由 HTML+CSS 渲染，不经生成模型——避免德文变音符号出错',
          渲染器: 'src/render/blink-renderer.ts',
          改版式: '改下面的 <style> 里的 CSS，重跑 compose 即可，不需调用大模型',
        },
      });

      // 渲染必须用替换后的 HTML（图会断的坑踩过一次：PNG 从 3.9MB 掉到 122KB）
      const r = createBlinkRenderer();
      try {
        const out = await r.render({ html: emitted.selfContainedHtml }, OUT, {
          width: C, height: C, deviceScaleFactor: 1, format: 'png', filename: 'final',
        });
        const buf = readFileSync(out.imagePath);
        console.log(`    PNG → ${out.imagePath}`);
        console.log(`          ${buf.readUInt32BE(16)}×${buf.readUInt32BE(20)}  ${(buf.length / 1024).toFixed(0)} KB`);
      } finally {
        await r.dispose();
      }

      console.log(`    HTML → ${emitted.selfContained}（${(emitted.selfContainedBytes / 1024 / 1024).toFixed(2)} MB 自包含）`);
      console.log(`           ${emitted.linked}（${(emitted.linkedBytes / 1024).toFixed(0)} KB 相对路径，便于改 CSS）`);
    }
    console.log();
  } finally {
    await browser.close();
  }
}

function needed(p: string) {
  return !existsSync(p);
}

/** 把本地图压成小尺寸 jpeg data URL，供参考图用 */
async function downscale(
  browser: Awaited<ReturnType<typeof launch>>,
  path: string,
  max: number,
): Promise<string> {
  const page = await browser.newPage();
  const b64 = readFileSync(path).toString('base64');
  const url = await page.evaluate(
    async (a: { b64: string; max: number }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${a.b64}`;
      await img.decode();
      const s = Math.min(1, a.max / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * s);
      const h = Math.round(img.naturalHeight * s);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      return c.toDataURL('image/jpeg', 0.9);
    },
    { b64, max },
  );
  await page.close();
  return url;
}

async function save(url: string, outPath: string, label: string) {
  const t0 = Date.now();
  const res = await fetch(url);
  if (!res.ok) {
    console.log(`    ✗ ${label} 下载 HTTP ${res.status}`);
    return;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(outPath, buf);
  console.log(`    → ${outPath}`);
  console.log(`        ${buf.readUInt32BE(16)}×${buf.readUInt32BE(20)}  ${(buf.length / 1024).toFixed(0)} KB  ${Date.now() - t0}ms`);
}

main().catch((e) => {
  console.error('\n✗ 失败:', e);
  process.exit(1);
});
