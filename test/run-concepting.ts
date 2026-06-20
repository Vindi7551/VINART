/**
 * 单独测试美术指导 + 文案配对。
 * 用法：npx tsx test/run-concepting.ts
 *
 * 自动读取上一步 output/brief.json（创意总监产出）。
 * 如果文件不存在，使用 mock 数据降级。
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { getChatGateway } from '../src/config';
import { createChatContext } from '../src/context/index';
import { createConceptingPair } from '../src/agent/index';
import type { CreativeBrief } from '../src/schema/index';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, 'output');
fs.mkdirSync(OUT, { recursive: true });

// ══ 数据源：优先读上一步产出 ══
const BRIEF_PATH = path.join(OUT, 'brief.json');

function loadBrief(): CreativeBrief {
  if (fs.existsSync(BRIEF_PATH)) {
    console.log('📂 读取上一步产出:', BRIEF_PATH);
    return JSON.parse(fs.readFileSync(BRIEF_PATH, 'utf-8'));
  }
  console.log('⚠️  未找到 brief.json，使用 mock 数据');
  return {
    useCase: '电商促销海报',
    productName: '焕亮精华液',
    productDescription: '温和焕亮配方，7天改善暗沉，适合敏感肌。轻盈质地，深层滋养。',
    targetAudience: '25-35岁都市女性，注重护肤品质感与温和性',
    keyMessage: '7天焕亮，温和不刺激',
    brandPersonality: '简约奢华',
    brandVoice: '专业克制',
    toneKeywords: ['轻盈', '纯粹', '焕亮', '温和'],
    visualStyle: '极简奢华，暖调底色，突出产品质感',
    mood: '温暖亲切，高品质感',
    colorDirection: '暖调大地色 + 金色点缀',
    canvas: { width: 800, height: 1200 },
    mustInclude: ['产品瓶身', '品牌logo', 'CTA按钮'],
    mustAvoid: ['过度装饰', '荧光色', '复杂背景'],
  };
}

async function main() {
  console.log('🎬 测试美术指导 + 文案配对\n');

  const brief = loadBrief();
  console.log('📤 简报:', brief.keyMessage);

  const pair = createConceptingPair({
    gateway: getChatGateway(),
    context: createChatContext(),
    maxRounds: 3,
  });

  console.log('⏳ 协作中（最多 3 轮）...\n');
  const result = await pair.run(brief);

  console.log(`📊 用了 ${result.roundsUsed} 轮，强制收敛=${result.forcedConvergence}\n`);

  console.log('─── 美术指导产出 ───');
  console.log(result.visualDirectionRaw.slice(0, 600));
  if (result.visualDirectionRaw.length > 600) console.log('...(截断)');

  console.log('\n─── 文案产出 ───');
  console.log(result.copyDeckRaw.slice(0, 400));
  if (result.copyDeckRaw.length > 400) console.log('...(截断)');

  fs.writeFileSync(path.join(OUT, 'visual-direction-raw.txt'), result.visualDirectionRaw, 'utf-8');
  fs.writeFileSync(path.join(OUT, 'copy-deck-raw.txt'), result.copyDeckRaw, 'utf-8');

  // 解析并保存 JSON
  for (const [label, raw, filename] of [
    ['VisualDirection', result.visualDirectionRaw, 'visual-direction.json'],
    ['CopyDeck', result.copyDeckRaw, 'copy-deck.json'],
  ] as const) {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        console.log(`✅ ${label} JSON 解析成功`);
        fs.writeFileSync(path.join(OUT, filename), JSON.stringify(parsed, null, 2), 'utf-8');
      } catch {
        console.log(`⚠️  ${label} JSON 解析失败`);
      }
    }
  }

  console.log('\n📁 输出目录:', OUT);
}

main().catch(console.error);
