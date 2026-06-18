import type { ModelEntry, ModelType } from './types';
import type { ChatProvider, ImageProvider } from '../provider/interface';
import { createOpenAI } from '../provider/openai';
import { createVolcanoArk } from '../provider/volcano-ark';
import { createAnthropic } from '../provider/anthropic';

/**
 * 模型注册器。
 *
 * 启动时从配置中读取所有模型条目，按 type 和 priority 组织。
 * 提供 toChatProviders() / toImageProviders() 将条目转为可用的 Provider 实例。
 */
export interface ModelRegistry {
  /** 注册一条模型 */
  register(entry: ModelEntry): void;
  /** 获取所有 chat 模型（按 priority 升序） */
  getChatModels(): ModelEntry[];
  /** 获取所有 image 模型（按 priority 升序） */
  getImageModels(): ModelEntry[];
  /** 将 chat 模型转为 ChatProvider 列表（按 priority 排序，可直接喂给 fallback） */
  toChatProviders(): ChatProvider[];
  /** 将 image 模型转为 ImageProvider 列表 */
  toImageProviders(): ImageProvider[];
}

export function createRegistry(initialEntries?: ModelEntry[]): ModelRegistry {
  const models: ModelEntry[] = [];

  for (const entry of initialEntries ?? []) {
    models.push(entry);
  }

  function getByType(type: ModelType): ModelEntry[] {
    return models
      .filter((m) => m.type === type)
      .sort((a, b) => a.priority - b.priority);
  }

  function toChatProviders(): ChatProvider[] {
    return getByType('chat').map(createProviderFromEntry) as ChatProvider[];
  }

  function toImageProviders(): ImageProvider[] {
    return getByType('image').map(createProviderFromEntry) as ImageProvider[];
  }

  return {
    register(entry: ModelEntry) {
      models.push(entry);
    },
    getChatModels() {
      return getByType('chat');
    },
    getImageModels() {
      return getByType('image');
    },
    toChatProviders,
    toImageProviders,
  };
}

/**
 * 根据 entry.protocol 分发到对应的 provider 工厂。
 *
 * 这是 registry → provider 的唯一桥接点。
 * 新增协议时只需在这里加一个 case。
 */
function createProviderFromEntry(entry: ModelEntry): ChatProvider | ImageProvider {
  const config = {
    baseURL: entry.baseURL,
    model: entry.model,
    apiKey: entry.apiKey,
  };

  switch (entry.protocol) {
    case 'openai':
      return createOpenAI(config);
    case 'volcano-ark':
      return createVolcanoArk(config);
    case 'anthropic':
      return createAnthropic(config);
  }
}
