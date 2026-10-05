/**
 * 基线测试：**绕过整套管线**，直接拿用户给的完整提示词 + 产品图
 * 去请求项目里的生图模型（doubao-seedream），看裸模型一次能出什么。
 *
 * 目的：建立"裸模型"基线，与「草图 + 组装」管线的产出做对照——
 * 差距有多大，管线的价值就在哪里。
 *
 * 提示词**原样传入，一字不改**——这是用户要测的东西，不是我来优化的。
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PRODUCT = resolve('C:/Users/1023/.workbuddy/clipboard-images/clipboard-2026-09-28T08-25-18-574Z-ec35b9db.jpg');
const OUT = resolve('test_product/raw-test');

const PROMPT = `用例：广告营销。制作一个完成的商业创意广告，不是设计稿或联系稿。输入图片 1 是产品身份的唯一权威。必须精确保留：白色僵硬的天鹅雕像，带有光泽的黑眼睛、黄色喙和黄色脚，放置在绿色纹理的椭圆底座上；穿着棕色天鹅绒外观服装的颈部和身体，圆润的金黄色腹部面板，凸起的垫状棕色翅膀；由层次分明的波浪形橙色/赭石色/深棕色/鼠尾草色尾羽作为来源；喙上覆盖红色织物环/垂肉；戴着带有黄色/橙色枫叶和细白色下巴弹性带的棕冠黑边帽。天鹅雕像、服装和帽子都包含在内，各一个。保留比例。仅展示源可见的前面/侧面结构的新相机视图；永远不要虚构隐藏的后部闭合。这是一个僵硬的雕像，不是活的天鹅。不能行走、弯曲脖子或动画翅膀。所有完整产品视图必须包含完整的叶子、帽子、脚和绿色底座，并留有 5%的间隙。不要虚构包装、标志、丝带、尺寸、评级、声明、额外部件或其他产品。
 艺术指导：完成了一个视觉工艺级的艺术指导节日礼品广告的优质季节性电商广告。统一了丰富的焦褐色#9B3E22、奶油色#F5ECDC、森林绿#263F31 和柔和的仿古金色。自信的紧凑型编辑衬线标题，精致洁净的小标签，自然温暖的照片光线。精细的边界/雕刻枫叶装饰保持克制，没有圣诞松树/雪花。产品纹理、构图、叙事和图形层级都必须设计。文字足够大，以便在 25%预览时阅读，标题永远不会覆盖产品，不仅仅是带标题的抠图。所有文本原生生成于图像。

 创意 G02 — 设计一个秋季角色档案/清单海报，而不是简单的产品加标题。温暖的奶油色微妙纸张，薄的仿古金色双边框，克制的枫叶角雕刻。上方 20%强的焦褐色紧凑型编辑衬线标题。完整组装的鹅直视左侧 58%在标题下方，很大。 右侧 35%处有三个交错排列的优雅边框标本卡，展示了同一款磨损产品的近距离裁剪细节：白色鹅脸/棕色服装腹部和翅膀/带有叶子的帽子，每个都有其精确对应的标签。精细的金色连接线连接到源特征；没有拆卸部件、额外的动物或虚构的裸露雕像。页脚包含简短的安心说明。文本顺序：标题；三张卡片标签；页脚。

 精确的买家副本，拼写和大小写逐字复制，无其他可见文本："整只火鸡的外观" | "鹅雕像" | "火鸡服装" | "枫叶帽" | "全部包含"
 要求的原生分辨率 2000x2000 平方。如果可能的话，以此原生尺寸渲染，切勿 letterbox。最高可用保真度。`;

async function main() {
  console.log('\n' + '═'.repeat(70));
  console.log('基线测试：裸模型直出（无草图 / 无组装）');
  console.log('═'.repeat(70));

  if (!existsSync(PRODUCT)) {
    console.error(`\n✗ 找不到产品图：${PRODUCT}`);
    process.exit(1);
  }
  mkdirSync(OUT, { recursive: true });

  const { getImageGateway } = await import('../src/config');
  const { downscaleToRef } = await import('../src/workflow/assetsgen/cutout');
  const { chromium } = await import('playwright');

  let browser: Awaited<ReturnType<typeof chromium.launch>>;
  try {
    browser = await chromium.launch({ headless: true });
  } catch {
    browser = await chromium.launch({ headless: true, channel: 'chromium' });
  }

  try {
    // 参考图：产品照压到 1024（与管线同口径）
    const pg = await browser.newPage();
    const ref = await downscaleToRef(
      pg as unknown as { evaluate: <T>(fn: (a: unknown) => T, a: unknown) => Promise<T> },
      PRODUCT,
      1024,
    );
    await pg.close();
    console.log(`\n  产品图  → 参考图（1024）`);
    console.log(`  提示词  → ${PROMPT.length} 字符（原样传入，未做任何修改）`);
    console.log(`  尺寸    → 2000x2000（用户要求的原生分辨率）`);

    const gateway = getImageGateway();

    // 内容审核是概率性的，与管线同口径重试 3 次
    const MAX_ATTEMPTS = 3;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const t0 = Date.now();
      try {
        const r = await gateway.generate({
          prompt: PROMPT,
          referenceImages: [ref],
          size: '2000x2000',
          count: 1,
          format: 'png',
        });
        const img = r.images[0];
        if (!img) throw new Error('未返回图片');

        const res = await fetch(img.url);
        if (!res.ok) throw new Error(`下载 HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());

        const out = resolve(OUT, `raw-g02.png`);
        writeFileSync(out, buf);
        console.log(
          `\n  ✓ ${out}\n` +
            `    ${buf.readUInt32BE(16)}×${buf.readUInt32BE(20)}  ${(buf.length / 1024).toFixed(0)} KB  ` +
            `${((Date.now() - t0) / 1000).toFixed(0)}s` +
            (attempt > 1 ? `（第 ${attempt} 次尝试）` : ''),
        );
        break;
      } catch (e) {
        const msg = (e as Error).message;
        const short = msg.split('\n').filter(Boolean).slice(-1)[0] ?? msg;
        if (attempt < MAX_ATTEMPTS) {
          console.log(`  ↻ 第 ${attempt} 次失败：${short.slice(0, 200)}`);
          console.log(`    重试…`);
          await new Promise((r) => setTimeout(r, 1500 * attempt));
        } else {
          console.log(`  ✗ 连续 ${MAX_ATTEMPTS} 次失败：${short.slice(0, 400)}`);
          process.exit(1);
        }
      }
    }
  } finally {
    await browser.close();
  }
  console.log();
}

main().catch((e) => {
  console.error('✗', e);
  process.exit(1);
});
