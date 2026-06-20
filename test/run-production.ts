/**
 * 单独测试制作 Agent。
 * 用法：npx tsx test/run-production.ts
 *
 * 自动读取上一步产出：
 * - output/output.html（设计师的 HTML）
 * - output/slots.json（槽位清单）
 * - output/illustrator-*.json（素材师产出）
 * - output/copy-deck.json（文案集）
 *
 * 如果文件不存在，使用 mock 数据降级。
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { createProductionAgent } from '../src/agent/index';
import type { ProductionInput } from '../src/agent/index';
import type { ImageAsset, CopyDeck, SlotSpec } from '../src/schema/index';
import { mockProductionInput } from './fixtures/index';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, 'output');
fs.mkdirSync(OUT, { recursive: true });

const HTML_PATH = path.join(OUT, 'output.html');
const SLOTS_PATH = path.join(OUT, 'slots.json');
const CD_PATH = path.join(OUT, 'copy-deck.json');

function loadHtml(): string {
  if (fs.existsSync(HTML_PATH)) {
    console.log('📂 读取:', HTML_PATH);
    return fs.readFileSync(HTML_PATH, 'utf-8');
  }
  console.log('⚠️  未找到 output.html，使用 mock');
  return mockProductionInput.htmlCode;
}

function loadCopyDeck(): CopyDeck {
  if (fs.existsSync(CD_PATH)) {
    return JSON.parse(fs.readFileSync(CD_PATH, 'utf-8'));
  }
  return mockProductionInput.copyDeck;
}

function loadAssets(): ImageAsset[] {
  // 查找所有 illustrator-*.json
  const files = fs.readdirSync(OUT).filter((f) => f.startsWith('illustrator-') && f.endsWith('.json'));
  if (files.length > 0) {
    console.log(`📂 读取 ${files.length} 个素材产出:`);
    const assets: ImageAsset[] = [];
    for (const f of files) {
      console.log(`   ${f}`);
      assets.push(JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf-8')));
    }
    return assets;
  }

  // 没有 illustrator 产出，尝试用 slots.json 构造占位 asset
  if (fs.existsSync(SLOTS_PATH)) {
    console.log('⚠️  无 illustrator 产出，用 slots.json 构造占位');
    const manifest = JSON.parse(fs.readFileSync(SLOTS_PATH, 'utf-8'));
    return (manifest.slots || []).map((s: SlotSpec) => ({
      slotId: s.id,
      slotType: s.slotType,
      targetSize: { width: s.width, height: s.height },
      status: 'completed' as const,
      localPath: `placeholder-${s.id}.png`,
    }));
  }

  console.log('⚠️  无素材数据，使用 mock');
  return mockProductionInput.assetBatch.assets;
}

async function main() {
  console.log('🎬 测试制作 Agent\n');

  const html = loadHtml();
  const copyDeck = loadCopyDeck();
  const assets = loadAssets();

  const completedCount = assets.filter((a) => a.status === 'completed').length;
  const assetBatch = {
    assets,
    completedCount,
    failedCount: assets.length - completedCount,
    allCompleted: completedCount === assets.length,
  };

  const input: ProductionInput = { htmlCode: html, copyDeck, assetBatch };
  console.log('\n📤 素材数:', assets.length, '成功:', completedCount);

  const production = createProductionAgent({ outputDir: OUT });
  console.log('⏳ 组装中...\n');

  const output = production.assemble(input);

  if (output.success) {
    console.log('✅ 组装成功');
    console.log('   HTML 长度:', output.assembledHtml.length, '字符');

    fs.writeFileSync(path.join(OUT, 'assembled.html'), output.assembledHtml, 'utf-8');

    const imgCount = (output.assembledHtml.match(/<img /g) || []).length;
    const slotRemain = (output.assembledHtml.match(/data-image-slot=/g) || []).length;
    console.log('   <img> 标签:', imgCount);
    console.log('   残留 data-image-slot:', slotRemain);
  } else {
    console.log('❌ 组装失败:', output.error);
  }

  console.log('\n📁 输出目录:', OUT);
}

main().catch(console.error);
