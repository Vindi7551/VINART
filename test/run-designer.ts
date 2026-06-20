/**
 * 单独测试设计师 Agent。
 * 用法：npx tsx test/run-designer.ts
 *
 * 自动读取上一步 output/visual-direction.json + copy-deck.json。
 * 如果文件不存在，使用 mock 数据降级。
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { getChatGateway } from '../src/config';
import { createChatContext } from '../src/context/index';
import { createDesignerFromInput } from '../src/agent/index';
import type { DesignerInput } from '../src/agent/index';
import type { VisualDirection, CopyDeck } from '../src/schema/index';
import { mockVisualDirection, mockCopyDeck } from './fixtures/index';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, 'output');
fs.mkdirSync(OUT, { recursive: true });

const VD_PATH = path.join(OUT, 'visual-direction.json');
const CD_PATH = path.join(OUT, 'copy-deck.json');

function loadVisualDirection(): VisualDirection {
  if (fs.existsSync(VD_PATH)) {
    console.log('📂 读取:', VD_PATH);
    return JSON.parse(fs.readFileSync(VD_PATH, 'utf-8'));
  }
  console.log('⚠️  未找到 visual-direction.json，使用 mock');
  return mockVisualDirection;
}

function loadCopyDeck(): CopyDeck {
  if (fs.existsSync(CD_PATH)) {
    console.log('📂 读取:', CD_PATH);
    return JSON.parse(fs.readFileSync(CD_PATH, 'utf-8'));
  }
  console.log('⚠️  未找到 copy-deck.json，使用 mock');
  return mockCopyDeck;
}

async function main() {
  console.log('🎬 测试设计师 Agent\n');

  const visualDirection = loadVisualDirection();
  const copyDeck = loadCopyDeck();

  const input: DesignerInput = {
    visualDirection,
    copyDeck,
    canvas: { width: 800, height: 1200 },
  };

  const agent = createDesignerFromInput(input, {
    gateway: getChatGateway(),
    context: createChatContext(),
    temperature: 0.3,
    maxTokens: 65536,
  });

  console.log('⏳ 生成 HTML+CSS + 槽位清单中...\n');
  const result = await agent.run(input);

  console.log('📥 输出长度:', result.length, '字符\n');

  fs.writeFileSync(path.join(OUT, 'designer-raw.txt'), result, 'utf-8');

  // 分离 HTML 和 SlotManifest
  const slotSep = result.indexOf('===SLOTS===');
  if (slotSep !== -1) {
    const htmlPart = result.slice(0, slotSep);
    const slotsPart = result.slice(slotSep);

    const htmlMatch = htmlPart.match(/```html\s*([\s\S]*?)```/);
    const html = htmlMatch ? htmlMatch[1].trim() : htmlPart.trim();

    fs.writeFileSync(path.join(OUT, 'output.html'), html, 'utf-8');
    console.log('✅ HTML 已保存, 长度:', html.length, '字符');

    const jsonMatch = slotsPart.match(/```json\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        const manifest = JSON.parse(jsonMatch[1]);
        console.log('✅ 槽位数:', manifest.totalCount);
        for (const s of manifest.slots) {
          console.log(`   ${s.id}: ${s.width}×${s.height} — ${s.content.subject}`);
        }
        fs.writeFileSync(path.join(OUT, 'slots.json'), JSON.stringify(manifest, null, 2), 'utf-8');
      } catch {
        console.log('⚠️ 槽位 JSON 解析失败');
      }
    }
  } else {
    const htmlMatch = result.match(/```html\s*([\s\S]*?)```/);
    const html = htmlMatch ? htmlMatch[1].trim() : result;
    fs.writeFileSync(path.join(OUT, 'output.html'), html, 'utf-8');
    console.log('✅ HTML 已保存（无槽位清单）');
  }

  console.log('\n📁 输出目录:', OUT);
}

main().catch(console.error);
