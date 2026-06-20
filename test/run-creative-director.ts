/**
 * 单独测试创意总监 Agent。
 * 用法：npx tsx test/run-creative-director.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { getChatGateway } from '../src/config';
import { createChatContext } from '../src/context/index';
import { createCreativeDirectorFromInput } from '../src/agent/index';
import type { CreativeDirectorInput } from '../src/agent/index';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, 'output');
fs.mkdirSync(OUT, { recursive: true });

const INPUT: CreativeDirectorInput = {
  description: '做一张护肤精华液电商促销海报。产品主打"7天焕亮、温和不刺激"，目标受众是25-35岁都市女性。整体感觉要简约奢华、温暖高级。',
  productName: '焕亮精华液',
  productDescription: '温和焕亮配方，7天改善暗沉，适合敏感肌。轻盈质地，深层滋养。',
  useCase: '电商促销海报',
};

async function main() {
  console.log('🎬 测试创意总监 Agent\n');

  const agent = createCreativeDirectorFromInput(INPUT, {
    gateway: getChatGateway(),
    context: createChatContext(),
  });

  console.log('⏳ 生成中...\n');
  const result = await agent.run(INPUT);

  console.log('📥 输出:\n');
  console.log(result);

  fs.writeFileSync(path.join(OUT, 'brief-raw.txt'), result, 'utf-8');

  // 尝试解析 JSON
  const jsonMatch = result.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const brief = JSON.parse(jsonMatch[0]);
      console.log('\n✅ JSON 解析成功');
      console.log('  产品:', brief.productName);
      console.log('  调性:', brief.brandPersonality);
      console.log('  风格:', brief.visualStyle);
      console.log('  画布:', brief.canvas);
      fs.writeFileSync(path.join(OUT, 'brief.json'), JSON.stringify(brief, null, 2), 'utf-8');
    } catch {
      console.log('⚠️ JSON 解析失败');
    }
  }

  console.log('\n📁 输出目录:', OUT);
}

main().catch(console.error);
