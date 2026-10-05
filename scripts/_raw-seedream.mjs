/**
 * 最裸的调用：直接 POST 火山方舟 images/generations，
 * 不经过项目里的任何网关/管线封装 —— 只有 fetch + 产品图 + 用户的完整提示词。
 *
 * 模型：doubao-seedream-5-0-flash-260915（用户说的 seedream-5.0 flash）
 * 参考图：产品照**原样整张**传入（不缩放、不抠图、不预处理）
 * 提示词：**原样**传入，一字不改
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// 用法：node _raw-seedream.mjs --prompt <文件> --product <图片> --out <名称> [--size WxH]
const argv = process.argv.slice(2);
const argVal = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
};
const PRODUCT = resolve(
  argVal('--product') ??
    'C:/Users/1023/.workbuddy/clipboard-images/clipboard-2026-09-28T08-25-18-574Z-ec35b9db.jpg',
);
const OUT = resolve('test_product/raw-test');
const SIZE = argVal('--size') ?? '2000x2000';
const OUT_NAME = argVal('--out') ?? 'raw-direct';
const PROMPT_FILE = argVal('--prompt');

const PROMPT = `用例：广告营销。制作一个完成的商业创意广告，不是设计稿或联系稿。输入图片 1 是产品身份的唯一权威。必须精确保留：白色僵硬的天鹅雕像，带有光泽的黑眼睛、黄色喙和黄色脚，放置在绿色纹理的椭圆底座上；穿着棕色天鹅绒外观服装的颈部和身体，圆润的金黄色腹部面板，凸起的垫状棕色翅膀；由层次分明的波浪形橙色/赭石色/深棕色/鼠尾草色尾羽作为来源；喙上覆盖红色织物环/垂肉；戴着带有黄色/橙色枫叶和细白色下巴弹性带的棕冠黑边帽。天鹅雕像、服装和帽子都包含在内，各一个。保留比例。仅展示源可见的前面/侧面结构的新相机视图；永远不要虚构隐藏的后部闭合。这是一个僵硬的雕像，不是活的天鹅。不能行走、弯曲脖子或动画翅膀。所有完整产品视图必须包含完整的叶子、帽子、脚和绿色底座，并留有 5%的间隙。不要虚构包装、标志、丝带、尺寸、评级、声明、额外部件或其他产品。
 艺术指导：完成了一个视觉工艺级的艺术指导节日礼品广告的优质季节性电商广告。统一了丰富的焦褐色#9B3E22、奶油色#F5ECDC、森林绿#263F31 和柔和的仿古金色。自信的紧凑型编辑衬线标题，精致洁净的小标签，自然温暖的照片光线。精细的边界/雕刻枫叶装饰保持克制，没有圣诞松树/雪花。产品纹理、构图、叙事和图形层级都必须设计。文字足够大，以便在 25%预览时阅读，标题永远不会覆盖产品，不仅仅是带标题的抠图。所有文本原生生成于图像。

 创意 G02 — 设计一个秋季角色档案/清单海报，而不是简单的产品加标题。温暖的奶油色微妙纸张，薄的仿古金色双边框，克制的枫叶角雕刻。上方 20%强的焦褐色紧凑型编辑衬线标题。完整组装的鹅直视左侧 58%在标题下方，很大。 右侧 35%处有三个交错排列的优雅边框标本卡，展示了同一款磨损产品的近距离裁剪细节：白色鹅脸/棕色服装腹部和翅膀/带有叶子的帽子，每个都有其精确对应的标签。精细的金色连接线连接到源特征；没有拆卸部件、额外的动物或虚构的裸露雕像。页脚包含简短的安心说明。文本顺序：标题；三张卡片标签；页脚。

 精确的买家副本，拼写和大小写逐字复制，无其他可见文本："整只火鸡的外观" | "鹅雕像" | "火鸡服装" | "枫叶帽" | "全部包含"
 要求的原生分辨率 2000x2000 平方。如果可能的话，以此原生尺寸渲染，切勿 letterbox。最高可用保真度。`;

function loadPrompt() {
  if (!PROMPT_FILE) return PROMPT;
  const p = resolve(PROMPT_FILE);
  if (!existsSync(p)) {
    console.error(`✗ 找不到提示词文件：${p}`);
    process.exit(1);
  }
  return readFileSync(p, 'utf8');
}

async function main() {
  const PROMPT = loadPrompt();
  console.log('\n' + '═'.repeat(70));
  console.log('裸调用 seedream-5.0-flash（无任何项目封装）');
  console.log('═'.repeat(70));

  if (!existsSync(PRODUCT)) {
    console.error(`\n✗ 找不到产品图：${PRODUCT}`);
    process.exit(1);
  }
  mkdirSync(OUT, { recursive: true });

  // 只读两样东西：API key 和模型名
  const keys = JSON.parse(readFileSync(resolve('keys.json'), 'utf8'));
  const ark = keys.providers.find((p) => p.name === 'volcano-ark');
  const endpoint = `${ark.baseURL}/images/generations`;

  // 产品照**原样**整张 base64（不缩放、不抠图）
  const imgB64 = readFileSync(PRODUCT).toString('base64');

  const body = {
    model: ark.models[0].model,
    prompt: PROMPT,
    image: [`data:image/jpeg;base64,${imgB64}`],
    size: SIZE,
    response_format: 'url',
    watermark: false,
  };

  console.log(`\n  端点     ${endpoint}`);
  console.log(`  模型     ${body.model}`);
  console.log(`  参考图   1 张（产品照原样 ${(imgB64.length / 1024 / 1024).toFixed(2)} MB base64）`);
  console.log(`  提示词   ${PROMPT.length} 字符（原样）`);
  console.log(`  尺寸     ${SIZE}`);
  console.log(`  请求中…`);

  const t0 = Date.now();
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ark.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text();
    console.error(`\n✗ HTTP ${res.status}\n${txt.slice(0, 600)}`);
    process.exit(1);
  }

  const j = await res.json();
  const item = j.data?.[0];
  if (!item) {
    console.error(`\n✗ 响应里没有图片：${JSON.stringify(j).slice(0, 400)}`);
    process.exit(1);
  }

  let buf;
  if (item.b64_json) {
    buf = Buffer.from(item.b64_json, 'base64');
  } else if (item.url) {
    const ir = await fetch(item.url);
    if (!ir.ok) {
      console.error(`\n✗ 下载失败 HTTP ${ir.status}`);
      process.exit(1);
    }
    buf = Buffer.from(await ir.arrayBuffer());
  } else {
    console.error('\n✗ 响应里既没有 url 也没有 b64_json');
    process.exit(1);
  }

  const out = resolve(OUT, `${OUT_NAME}.png`);
  writeFileSync(out, buf);
  console.log(
    `\n  ✓ ${out}\n` +
      `    ${buf.readUInt32BE(16)}×${buf.readUInt32BE(20)}  ${(buf.length / 1024).toFixed(0)} KB  ` +
      `${((Date.now() - t0) / 1000).toFixed(0)}s`,
  );
  console.log();
}

main().catch((e) => {
  console.error('✗', e);
  process.exit(1);
});
