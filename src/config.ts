/**
 * 应用配置模块。
 *
 * 启动时读取 keys.json，通过 Registry 注册所有可用模型。
 * 上层通过 getChatGateway() / getImageGateway() 获取预配置好的 Gateway 单例。
 *
 * 密钥管理：
 * - keys.json（不提交）→ 存放真实 Key
 * - keys.example.json（提交）→ 模板，复制后填 Key
 *
 * 添加新模型：
 *   在 keys.json 的 providers 数组里加一条，写明 type、protocol、model、priority。
 *   无需改动 config.ts，无需改动 gateway 内部任何代码。
 */

import { createChatGateway, createImageGateway, createRegistry } from './gateway/index';
import type { ChatGateway, ImageGateway, ModelEntry, ModelType, Protocol } from './gateway/index';
import keys from '../keys.json';

// ── 模型注册表（纯数据转换，不硬编码 type / protocol） ──

function buildRegistry(): ModelEntry[] {
  const entries: ModelEntry[] = [];

  for (const provider of keys.providers ?? []) {
    const { apiKey, baseURL, type, protocol } = provider;

    for (const entry of provider.models ?? []) {
      const { model, priority } = entry;
      const contextWindow = 'contextWindow' in entry ? (entry as { contextWindow: number }).contextWindow : undefined;
      if (!model) continue;

      entries.push({
        name: model,
        type: type as ModelType,
        protocol: protocol as Protocol,
        baseURL,
        model,
        apiKey,
        priority,
        contextWindow,
      });
    }
  }

  return entries;
}

// ── Gateway 单例（懒初始化） ──

let _chatGateway: ChatGateway | null = null;
let _imageGateway: ImageGateway | null = null;

function getOrCreateRegistry() {
  return createRegistry(buildRegistry());
}

export function getChatGateway(): ChatGateway {
  if (!_chatGateway) {
    const registry = getOrCreateRegistry();
    _chatGateway = createChatGateway(registry.toChatProviders());
  }
  return _chatGateway;
}

export function getImageGateway(): ImageGateway {
  if (!_imageGateway) {
    const registry = getOrCreateRegistry();
    _imageGateway = createImageGateway(registry.toImageProviders());
  }
  return _imageGateway;
}
