/**
 * generate_layout — 设计师 Subagent
 *
 * 将视觉方向 + 文案转化为 HTML+CSS 布局代码 + 槽位清单。
 * 复用现有 Designer 的 BASE_PROMPT。
 */

import type { ChatGateway } from '../../gateway/index';
import type { ChatContext } from '../../context/index';
import { createChatSession } from '../../session/index';
import type { Subagent } from '../runner';

export function createGenerateLayout(config: {
  gateway: ChatGateway;
  context: ChatContext;
  outputDir?: string;
}): Subagent {
  const BASE_PROMPT = [
    '你是一位资深视觉设计师，负责将美术指导的视觉方向和文案集转化为',
    '可运行的 HTML+CSS 代码。',
    '',
    '你的职责：',
    '- 根据版面结构搭建 HTML 骨架',
    '- 根据色彩系统和字体系统编写 CSS 变量和样式',
    '- 根据框样式系统创建承载图片的容器',
    '- 将文案填入对应的 HTML 元素中',
    '- 所有语义元素标注 data-vinart-type 和 data-vinart-id 属性',
    '- 图片槽位用 div 占位，设置 data-image-slot 属性',
    '',
    '行为规则：',
    '- 使用语义化 HTML5 标签',
    '- CSS 使用 :root 中的 CSS 变量定义配色',
    '- 不要引入外部字体或图标库，使用系统字体',
    '- 不要写 JavaScript',
    '- 代码整洁、关键处有注释',
    '- 有 data-vinart-type 标记的元素不要设 pointer-events: none',
    '',
    '输出格式：',
    '完整的 HTML 源码（含 <style> 标签），包裹在 ```html 代码块中。',
    '如果需要图片，在 HTML 后面用 ===SLOTS=== 分隔，',
    '再接 ```json 代码块输出槽位清单 JSON。',
  ].join('\n');

  const session = createChatSession({
    systemPrompt: BASE_PROMPT,
    gateway: config.gateway,
    context: config.context,
    temperature: 0.3,
    maxTokens: 65536,
  });

  return {
    name: 'generate_layout',

    async run(task: string): Promise<string> {
      let result = '';
      for await (const chunk of session.send(task)) {
        result += chunk.content;
      }

      // 尝试保存 HTML 到磁盘（仅在 Node.js 环境有效）
      if (config.outputDir && typeof window === 'undefined') {
        try {
          const { mkdirSync, writeFileSync } = await import('fs');
          const { join } = await import('path');
          const htmlMatch = result.match(/```html\s*([\s\S]*?)```/);
          if (htmlMatch) {
            const html = htmlMatch[1].trim();
            mkdirSync(config.outputDir, { recursive: true });
            const htmlPath = join(config.outputDir, 'layout.html');
            writeFileSync(htmlPath, html, 'utf-8');
            return result + `\n\n[HTML 已保存到 ${htmlPath}]`;
          }
        } catch {
          // 浏览器环境，跳过文件保存
        }
      }

      return result;
    },
  };
}
