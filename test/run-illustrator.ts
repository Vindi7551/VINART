/**
 * 单独测试素材师 Agent。
 * 用法：npx tsx test/run-illustrator.ts
 *
 * 自动读取上一步 output/slots.json + brief.json + visual-direction.json。
 * 默认跑第一个槽位。如果文件不存在，使用 mock 数据降级。
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { getImageGateway } from '../src/config';
import { createIllustrator } from '../src/agent/index';
import type { IllustratorInput } from '../src/agent/index';
import type { SlotSpec, CreativeBrief, VisualDirection } from '../src/schema/index';
import { mockSlot, mockBrief, mockVisualDirection } from './fixtures/index';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, 'output');
fs.mkdirSync(OUT, { recursive: true });

const SLOTS_PATH = path.join(OUT, 'slots.json');
const BRIEF_PATH = path.join(OUT, 'brief.json');
const VD_PATH = path.join(OUT, 'visual-direction.json');

function loadSlot(): SlotSpec {
  if (fs.existsSync(SLOTS_PATH)) {
    console.log('📂 读取:', SLOTS_PATH);
    const manifest = JSON.parse(fs.readFileSync(SLOTS_PATH, 'utf-8'));
    if (manifest.slots?.length > 0) {
      const s = manifest.slots[0];
      console.log('   使用第 1 个槽位:', s.id);
      return s;
    }
  }
  console.log('⚠️  未找到 slots.json，使用 mock');
  return mockSlot;
}

function loadBrief(): CreativeBrief {
  if (fs.existsSync(BRIEF_PATH)) {
    console.log('📂 读取:', BRIEF_PATH);
    return JSON.parse(fs.readFileSync(BRIEF_PATH, 'utf-8'));
  }
  console.log('⚠️  未找到 brief.json，使用 mock');
  return mockBrief;
}

function loadVisualDirection(): VisualDirection {
  if (fs.existsSync(VD_PATH)) {
    return JSON.parse(fs.readFileSync(VD_PATH, 'utf-8'));
  }
  return mockVisualDirection;
}

async function main() {
  console.log('🎬 测试素材师 Agent\n');

  const slot = loadSlot();
  const brief = loadBrief();
  const visualDirection = loadVisualDirection();

  const treatment = visualDirection.imageTreatments?.find(
    (t) => t.slotType === slot.slotType,
  );

  console.log('📤 槽位:', slot.id, `(${slot.width}×${slot.height})`);
  console.log('   类型:', slot.slotType);
  console.log('   内容:', slot.content.subject);

  const illustrator = createIllustrator({
    imageGateway: getImageGateway(),
    outputDir: OUT,
    format: 'png',
  });

  const input: IllustratorInput = { slot, brief, treatment };
  console.log('⏳ 生成中...\n');

  const result = await illustrator.generate(input);

  console.log('📊 结果:');
  console.log('   状态:', result.status);
  if (result.status === 'completed') {
    console.log('   正向 prompt:', result.generationMeta?.positivePrompt?.slice(0, 300));
    console.log('   负向 prompt:', result.generationMeta?.negativePrompt?.slice(0, 200));
    console.log('   耗时:', result.generationMeta?.durationMs, 'ms');
  } else {
    console.log('   失败原因:', result.failureReason);
  }

  fs.writeFileSync(
    path.join(OUT, `illustrator-${slot.id}.json`),
    JSON.stringify(result, null, 2),
    'utf-8',
  );

  console.log('\n📁 输出目录:', OUT);
}

main().catch(console.error);
