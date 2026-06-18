/**
 * 浏览器 Console 测试入口。
 *
 * 页面加载后自动执行，将 Gateway 实例挂到 window.__gateway，
 * 在 DevTools Console 中直接调用测试函数。
 *
 * 使用方法：
 *   await __gateway.testChat('自定义 prompt')
 *   await __gateway.testImage('自定义 prompt')
 *   await __gateway.chat.stream([...])       // 直接调对话 Gateway
 *   await __gateway.image.generate({...})    // 直接调图片 Gateway
 */

import { getChatGateway, getImageGateway } from '../src/config';
import { createChatSession } from '../src/session';
import { createChatContext } from '../src/context';

const chatGateway = getChatGateway();
const imageGateway = getImageGateway();

(window as unknown as Record<string, unknown>).__gateway = {
  /** 对话 Gateway 实例，可直接调 stream() */
  chat: chatGateway,
  /** 图片 Gateway 实例，可直接调 generate() */
  image: imageGateway,

  /**
   * 快捷对话测试：
   * 创建临时 Session → 发送消息 → 流式打印回复 → 返回完整历史
   */
  async testChat(prompt = '用 HTML+CSS 写一个居中显示的登录卡片') {
    const session = createChatSession({
      systemPrompt: '你是一个资深前端工程师。只输出代码，不要解释。',
      gateway: chatGateway,
      context: createChatContext(),
    });

    console.log('── stream start ──');
    for await (const chunk of session.send(prompt)) {
      console.log(chunk.content);
    }
    console.log('── stream end ──');
    console.log('历史消息数:', session.messages.length);
    return session.messages;
  },

  /**
   * 快捷生图测试：
   * 发送生图请求 → 自动在新标签页打开图片 → 返回结果
   */
  async testImage(prompt = '一只柴犬在草地上奔跑，蓝天白云，温暖阳光') {
    console.log('⏳ generating...');
    const result = await imageGateway.generate({
      prompt,
      size: '2K',
      format: 'png',
    });
    for (const img of result.images) {
      console.log(`🖼️ ${img.size} → %cclick to open%c`, 'color: #6c5ce7; font-weight: bold', '', img.url);
      window.open(img.url, '_blank');
    }
    console.log('usage:', result.usage);
    return result;
  },
};

console.log('✅ Gateway ready');
console.log('  await __gateway.testChat()       — test chat');
console.log('  await __gateway.testImage()      — test image');
