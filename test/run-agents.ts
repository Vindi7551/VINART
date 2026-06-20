/**
 * 逐个 Agent 真实调用测试脚本。
 *
 * 用法：
 *   npx tsx test/run-agents.ts
 *
 * 每个 Agent 跑完后暂停，让你看输出。按 Enter 继续下一个。
 * 所有中间产物保存到 test/output/ 目录。
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { getChatGateway, getImageGateway } from '../src/config';
import { createChatContext } from '../src/context/index';
import {
  createCreativeDirectorFromInput,
  createConceptingPair,
  createDesignerFromInput,
  createIllustrator,
  createProductionAgent,
} from '../src/agent/index';
import type { CreativeDirectorInput, DesignerInput } from '../src/agent/index';
import type { IllustratorInput } from '../src/agent/index';
import type { CreativeBrief, VisualDirection, CopyDeck, SlotSpec } from '../src/schema/index';

// ── 工具 ──

const OUTPUT_DIR = path.resolve(__dirname, 'output');
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

function save(filename: string, content: string) {
  const filepath = path.join(OUTPUT_DIR, filename);
  fs.writeFileSync(filepath, content, 'utf-8');
  console.log(`  📄 已保存: ${filepath}`);
}

function saveJson(filename: string, obj: unknown) {
  save(filename, JSON.stringify(obj, null, 2));
}

function waitForEnter(prompt: string): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`\n⏸  ${prompt}`, () => { rl.close(); resolve(); });
  });
}

// ── 输入数据 ──

const USER_INPUT: CreativeDirectorInput = {
  description: '做一张护肤精华液电商促销海报。产品主打"7天焕亮、温和不刺激"，目标受众是25-35岁都市女性。整体感觉要简约奢华、温暖高级。',
  productName: '焕亮精华液',
  productDescription: '温和焕亮配方，7天改善暗沉，适合敏感肌。轻盈质地，深层滋养。',
  useCase: '电商促销海报',
};

// ══════════════════════════════════════════
// Agent 1: 创意总监
// ══════════════════════════════════════════

async function runCreativeDirector(): Promise<CreativeBrief> {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🎬 Agent 1: 创意总监 (Creative Director)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const chatGateway = getChatGateway();
  const chatContext = createChatContext();

  const agent = createCreativeDirectorFromInput(USER_INPUT, {
    gateway: chatGateway,
    context: chatContext,
  });

  console.log('📤 输入:', USER_INPUT.description.slice(0, 80) + '...');
  console.log('⏳ 生成创意简报中...\n');

  const result = await agent.run(USER_INPUT);
  console.log('📥 原始输出:\n');
  console.log(result.slice(0, 500));
  if (result.length > 500) console.log('...(截断)');

  save('1-brief-raw.txt', result);

  // 尝试解析 JSON
  let brief: CreativeBrief;
  try {
    // 提取 JSON
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      brief = JSON.parse(jsonMatch[0]);
      console.log('\n✅ JSON 解析成功！');
      console.log('  产品:', brief.productName);
      console.log('  调性:', brief.brandPersonality);
      console.log('  风格:', brief.visualStyle);
      console.log('  画布:', brief.canvas);
      saveJson('1-brief.json', brief);
      return brief;
    }
    throw new Error('未找到 JSON');
  } catch {
    console.log('\n⚠️  JSON 解析失败，使用手动提取');
    // 降级：手动构造
    const fallback: CreativeBrief = {
      useCase: '电商促销海报',
      productName: '焕亮精华液',
      productDescription: '温和焕亮配方，7天改善暗沉，适合敏感肌',
      targetAudience: '25-35岁都市女性',
      keyMessage: '7天亮起来，温和不刺激',
      brandPersonality: '简约奢华',
      brandVoice: '专业克制',
      toneKeywords: ['轻盈', '纯粹', '焕亮'],
      visualStyle: '极简奢华，暖调底色',
      mood: '温暖亲切，高品质感',
      colorDirection: '暖调大地色 + 金色点缀',
      canvas: { width: 800, height: 1200 },
    };
    saveJson('1-brief-fallback.json', fallback);
    return fallback;
  }
}

// ══════════════════════════════════════════
// Agent 2: 美术指导 + 文案配对
// ══════════════════════════════════════════

async function runConceptingPair(
  brief: CreativeBrief,
): Promise<{ visualDirection: VisualDirection; copyDeck: CopyDeck }> {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🎬 Agent 2: 美术指导 + 文案配对 (Concepting)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const chatGateway = getChatGateway();
  const chatContext = createChatContext();

  const pair = createConceptingPair({
    gateway: chatGateway,
    context: chatContext,
    maxRounds: 3, // 限制 3 轮，节省 token
  });

  console.log('📤 输入简报:', brief.keyMessage);
  console.log('⏳ 美术指导 + 文案协作中（最多 3 轮）...\n');

  const result = await pair.run(brief);
  console.log(`📊 用了 ${result.roundsUsed} 轮，收敛=${!result.forcedConvergence}`);

  save('2-visual-direction-raw.txt', result.visualDirectionRaw);
  save('2-copy-deck-raw.txt', result.copyDeckRaw);

  // 尝试解析
  let visualDirection: VisualDirection;
  let copyDeck: CopyDeck;

  try {
    const vdMatch = result.visualDirectionRaw.match(/\{[\s\S]*\}/);
    visualDirection = vdMatch ? JSON.parse(vdMatch[0]) : null;
    if (visualDirection) {
      console.log('✅ VisualDirection 解析成功');
      console.log('  氛围:', visualDirection.atmosphere);
      console.log('  区域数:', visualDirection.layout?.zones?.length);
      console.log('  色标数:', visualDirection.colorSystem?.tokens?.length);
      saveJson('2-visual-direction.json', visualDirection);
    }
  } catch {
    console.log('⚠️  VisualDirection 解析失败');
    visualDirection = { layout: { zones: [], visualFlow: '', focalPoint: '' }, colorSystem: { tokens: [], assignment: {}, description: '' }, typography: { styles: [], assignment: {}, description: '' }, frameSystem: { styles: [] }, spacing: { baseUnit: 8, strategy: 'moderate' }, imageTreatments: [], visualElements: {}, atmosphere: '' };
  }

  try {
    const cdMatch = result.copyDeckRaw.match(/\{[\s\S]*\}/);
    copyDeck = cdMatch ? JSON.parse(cdMatch[0]) : null;
    if (copyDeck) {
      console.log('✅ CopyDeck 解析成功');
      console.log('  文案条数:', copyDeck.items?.length);
      console.log('  主标题:', copyDeck.items?.find((i: any) => i.role === 'headline')?.primary);
      saveJson('2-copy-deck.json', copyDeck);
    }
  } catch {
    console.log('⚠️  CopyDeck 解析失败');
    copyDeck = { items: [], strategy: '', toneCalibration: '' };
  }

  return { visualDirection, copyDeck };
}

// ══════════════════════════════════════════
// Agent 3: 设计师
// ══════════════════════════════════════════

async function runDesigner(
  visualDirection: VisualDirection,
  copyDeck: CopyDeck,
  canvas: { width: number; height: number },
): Promise<{ html: string; slots: SlotSpec[] }> {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🎬 Agent 3: 设计师 (Designer)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const chatGateway = getChatGateway();
  const chatContext = createChatContext();

  const input: DesignerInput = { visualDirection, copyDeck, canvas };
  const agent = createDesignerFromInput(input, {
    gateway: chatGateway,
    context: chatContext,
    temperature: 0.3,
    maxTokens: 65536,
  });

  console.log('📤 输入: 视觉方向 + 文案集');
  console.log('⏳ 生成 HTML+CSS + 槽位清单中...\n');

  const result = await agent.run(input);
  console.log('📥 输出长度:', result.length, '字符');

  save('3-designer-raw.txt', result);

  // 分离 HTML 和 SlotManifest
  let html = '';
  let slots: SlotSpec[] = [];

  const slotSep = result.indexOf('===SLOTS===');
  if (slotSep !== -1) {
    const htmlPart = result.slice(0, slotSep);
    const slotsPart = result.slice(slotSep);

    // 提取 HTML 代码块
    const htmlMatch = htmlPart.match(/```html\s*([\s\S]*?)```/);
    html = htmlMatch ? htmlMatch[1].trim() : htmlPart.trim();

    // 提取 JSON
    const jsonMatch = slotsPart.match(/```json\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        const manifest = JSON.parse(jsonMatch[1]);
        slots = manifest.slots || [];
      } catch {}
    }
  } else {
    html = result;
  }

  console.log('✅ HTML 长度:', html.length, '字符');
  console.log('✅ 槽位数:', slots.length);
  if (slots.length > 0) {
    console.log('  槽位:', slots.map((s: any) => `${s.id} (${s.width}×${s.height})`).join(', '));
  }

  save('3-output.html', html);
  if (slots.length > 0) saveJson('3-slots.json', { slots, totalCount: slots.length });

  return { html, slots };
}

// ══════════════════════════════════════════
// Agent 4: 素材师（单个槽位）
// ══════════════════════════════════════════

async function runIllustrator(
  slot: SlotSpec,
  brief: CreativeBrief,
  visualDirection: VisualDirection,
) {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🎬 Agent 4: 素材师 (Illustrator)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const imageGateway = getImageGateway();

  const treatment = visualDirection.imageTreatments?.find(
    (t) => t.slotType === slot.slotType,
  );

  const illustrator = createIllustrator({
    imageGateway,
    outputDir: OUTPUT_DIR,
    format: 'png',
  });

  const input: IllustratorInput = { slot, brief, treatment };
  console.log('📤 槽位:', slot.id, `(${slot.width}×${slot.height})`);
  console.log('   内容:', slot.content.subject);
  console.log('⏳ 生成图片中...\n');

  const result = await illustrator.generate(input);

  console.log('📊 状态:', result.status);
  if (result.status === 'completed') {
    console.log('   本地路径:', result.localPath);
    console.log('   正向 prompt:', result.generationMeta?.positivePrompt?.slice(0, 200));
  } else {
    console.log('   失败原因:', result.failureReason);
  }

  saveJson(`4-illustrator-${slot.id}.json`, result);
  return result;
}

// ══════════════════════════════════════════
// Agent 5: 制作
// ══════════════════════════════════════════

async function runProduction(html: string, copyDeck: CopyDeck, assets: any[]) {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🎬 Agent 5: 制作 (Production)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const production = createProductionAgent({ outputDir: OUTPUT_DIR });

  const assetBatch = {
    assets,
    completedCount: assets.filter((a) => a.status === 'completed').length,
    failedCount: assets.filter((a) => a.status !== 'completed').length,
    allCompleted: assets.every((a) => a.status === 'completed'),
  };

  const output = production.assemble({ htmlCode: html, copyDeck, assetBatch });

  if (output.success) {
    console.log('✅ 组装成功');
    console.log('   HTML 长度:', output.assembledHtml.length, '字符');
    save('5-assembled.html', output.assembledHtml);
  } else {
    console.log('❌ 组装失败:', output.error);
  }

  return output;
}

// ══════════════════════════════════════════
// 主流程
// ══════════════════════════════════════════

async function main() {
  console.log('═══════════════════════════════════════');
  console.log('  Vinart Agent 逐个真实调用测试');
  console.log('═══════════════════════════════════════');

  // 1. 创意总监
  const brief = await runCreativeDirector();
  await waitForEnter('按 Enter 继续 → 美术指导+文案配对');

  // 2. 美术指导 + 文案
  const { visualDirection, copyDeck } = await runConceptingPair(brief);
  await waitForEnter('按 Enter 继续 → 设计师');

  // 3. 设计师
  const { html, slots } = await runDesigner(
    visualDirection,
    copyDeck,
    brief.canvas,
  );
  await waitForEnter('按 Enter 继续 → 素材师');

  // 4. 素材师（只跑第一个槽位做测试）
  let assets: any[] = [];
  if (slots.length > 0) {
    const testSlot = slots[0];
    const asset = await runIllustrator(testSlot, brief, visualDirection);
    assets.push(asset);
  } else {
    console.log('\n⚠️  没有槽位，跳过素材师');
  }
  await waitForEnter('按 Enter 继续 → 制作');

  // 5. 制作
  await runProduction(html, copyDeck, assets);

  console.log('\n═══════════════════════════════════════');
  console.log('  ✅ 全部 Agent 测试完成！');
  console.log('  📁 输出目录:', OUTPUT_DIR);
  console.log('═══════════════════════════════════════\n');
}

main().catch(console.error);
