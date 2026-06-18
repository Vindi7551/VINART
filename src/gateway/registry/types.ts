/** 支持的协议类型 */
export type Protocol = 'openai' | 'volcano-ark' | 'anthropic';

/** 模型类型 */
export type ModelType = 'chat' | 'image';

/**
 * 一条模型注册条目。
 *
 * 包含该模型的完整连接信息：往哪发（baseURL）、怎么鉴权（apiKey）、
 * 用哪个模型（model）、走什么协议（protocol）、优先级多少（priority）。
 *
 * 这是"纯数据"——不含任何协议逻辑，协议逻辑在 provider/ 层。
 */
export interface ModelEntry {
  /** 唯一标识，用于日志和面板显示，如 "deepseek-v4-flash" */
  name: string;
  /** chat 或 image */
  type: ModelType;
  /** 该模型使用什么 API 协议 */
  protocol: Protocol;
  /** API 基础地址 */
  baseURL: string;
  /** 模型名（传给 API 的 model 字段） */
  model: string;
  /** API Key */
  apiKey: string;
  /** 优先级，数字越小越优先（1 = 主模型，2 = 降级，以此类推） */
  priority: number;
}
