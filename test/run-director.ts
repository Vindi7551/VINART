/**
 * 端到端测试：Design Director → Worker Subagent 委派流程
 *
 * 用法：npx tsx test/run-director.ts
 *
 * 流程：
 *   用户输入需求 → Design Director 自主委派 Subagent
 *   → 创意总监 → 美术指导 → 文案 → 设计师 → 素材师 → 制作
 *   → 最终成品图
 *
 * 所有中间产物保存到 test/output/ 目录。
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { getChatGateway, getImageGateway } from '../src/config';
import { createChatContext } from '../src/context/index';
import { createBlinkRenderer } from '../src/render/blink-renderer';
import {
  createDesignDirector,
  createWriteBrief,
  createDefineVisual,
  createWriteCopy,
  createGenerateLayout,
  createGenerateImage,
  createAssemble,
} from '../src/agent/index';
import type { RunnerEvent } from '../src/agent/index';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, 'output');
fs.mkdirSync(OUT, { recursive: true });

// ══════════════════════════════════════════
// 用户输入
// ══════════════════════════════════════════

const USER_MESSAGE = [
  '做一张护肤精华液电商促销海报。',
  '产品：焕亮精华液——温和焕亮配方，7天改善暗沉，适合敏感肌。',
  '目标受众：25-35岁都市女性，注重护肤品质感。',
  '风格：简约奢华、温暖高级。',
  '尺寸：800×1200。',
].join('\n');

// ══════════════════════════════════════════
// 主流程
// ══════════════════════════════════════════

async function main() {
  console.log('═══════════════════════════════════════');
  console.log('  Vinart 端到端测试');
  console.log('  Design Director → Worker Subagent');
  console.log('═══════════════════════════════════════\n');

  // ── 组装 Subagent ──
  const chatGateway = getChatGateway();
  const imageGateway = getImageGateway();
  const chatContext = createChatContext();
  const renderer = createBlinkRenderer();

  const subagents = {
    write_brief: createWriteBrief({ gateway: chatGateway, context: chatContext }),
    define_visual: createDefineVisual({ gateway: chatGateway, context: chatContext }),
    write_copy: createWriteCopy({ gateway: chatGateway, context: chatContext }),
    generate_layout: createGenerateLayout({
      gateway: chatGateway,
      context: chatContext,
      outputDir: OUT,
    }),
    generate_image: createGenerateImage({
      imageGateway,
      outputDir: OUT,
      format: 'png',
    }),
    assemble: createAssemble({ outputDir: OUT, renderer }),
  };

  // ── 创建 Design Director ──
  const director = createDesignDirector({
    gateway: chatGateway,
    context: chatContext,
    subagents,
  });

  console.log('📤 用户需求:');
  console.log(USER_MESSAGE);
  console.log('\n⏳ Design Director 工作中...\n');

  // ── 运行 ──
  const startTime = Date.now();
  let turnCount = 0;
  let delegateCount = 0;

  for await (const event of director.run(USER_MESSAGE)) {
    switch (event.type) {
      case 'text':
        process.stdout.write(event.content);
        break;

      case 'delegate':
        delegateCount++;
        console.log(`\n\n📋 委派 → @${event.agent}`);
        console.log(`   任务: ${event.task.slice(0, 100)}${event.task.length > 100 ? '...' : ''}`);
        console.log('   ⏳ 执行中...');
        break;

      case 'result':
        console.log(`   ✅ @${event.agent} 完成 (${event.content.length} 字符)`);
        // 只在内容较短时打印
        if (event.content.length <= 300) {
          console.log(`   ── 结果 ──\n${event.content}\n   ────────`);
        }
        break;

      case 'done':
        turnCount++;
        console.log('\n\n✅ 设计主管完成本轮决策');
        break;
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n\n⏱ 总耗时: ${elapsed}s`);
  console.log(`📊 委派次数: ${delegateCount}`);

  // ── 列出产出文件 ──
  console.log('\n📁 输出目录:', OUT);
  try {
    const files = fs.readdirSync(OUT);
    for (const f of files) {
      const stat = fs.statSync(path.join(OUT, f));
      const sizeKB = (stat.size / 1024).toFixed(1);
      console.log(`   ${f} (${sizeKB} KB)`);
    }
  } catch {
    console.log('   (无法读取)');
  }

  // ── 清理 ──
  await renderer.dispose();
  console.log('\n✅ 测试完成');
}

main().catch((err) => {
  console.error('❌ 测试失败:', err);
  process.exit(1);
});
