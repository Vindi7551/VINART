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

import { createChatGateway, createImageGateway, createRegistry } from './designharness/gateway/index';
import type { ChatGateway, ImageGateway, ModelEntry, ModelType, Protocol } from './designharness/gateway/index';
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

/**
 * OpenAI 兼容 chat 通道的连接信息（priority 最高的第一条）。
 *
 * 用途：Files API 上传等「跟 chat 同一服务、但不是 chat 协议」的旁路请求——
 * 上传必须与 chat 用同一 baseURL/apiKey，file_id 才能被后续对话引用。
 * 从注册表取而非另写配置，保证与 getChatGateway() 背后的服务天然一致。
 */
export function getOpenAICompatChatConfig(): { baseURL: string; apiKey: string } {
  const entry = buildRegistry().find((e) => e.type === 'chat' && e.protocol === 'openai');
  if (!entry) throw new Error('keys.json 里没有 openai 协议的 chat 模型，无法上传 Files API');
  return { baseURL: entry.baseURL, apiKey: entry.apiKey };
}

export function getImageGateway(): ImageGateway {
  if (!_imageGateway) {
    const registry = getOrCreateRegistry();
    _imageGateway = createImageGateway(registry.toImageProviders());
  }
  return _imageGateway;
}

/**
 * 已注册的 **chat** 模型名（按 priority 升序）。
 *
 * 用途：UI 工具条上显示「当前在用的模型」。从注册表取而非前端硬编码——
 * 换 keys.json 时界面自动跟着变，不会留一个会漂的字符串。
 */
export function getChatModelNames(): string[] {
  return buildRegistry()
    .filter((e) => e.type === 'chat')
    .sort((a, b) => a.priority - b.priority)
    .map((e) => e.model);
}
