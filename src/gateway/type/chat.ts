/**
 * 对话相关类型 —— **协议中立层**。
 *
 * 本文件只放「OpenAI 兼容生态的事实约定」：换 Qwen / GLM / Kimi / DeepSeek
 * 都成立的东西。供应商专有内容一律不放这里，见各自的供应商类型文件：
 *   - ./deepseek-chat.ts   DeepSeek 的图像档位、Files API 块、实测限制与成本
 *
 * 判断标准：写进本文件前先问——「换一家模型，这段还成立吗？」
 * 不成立 → 它属于供应商文件。
 */

// ── 多模态内容块 ──

/** 文本内容块 */
export interface TextPart {
  type: 'text';
  text: string;
}

/**
 * 图片内容块。形状是 OpenAI 兼容通用约定。
 *
 * url 支持两种形式：
 * - base64 data URL：`data:image/png;base64,<B64>`（本地文件走这条，见 ../util/data-url.ts）
 * - 公网 http(s) URL：模型自行下载
 *
 * detail 刻意放宽为 string 而不锁枚举——各家的取值集合不同
 * （OpenAI 用 low/high/auto，DeepSeek 另有 original），
 * 把某一家枚举硬编码进通用层就是伪标准。具体取值见供应商类型文件。
 */
export interface ImagePart {
  type: 'image_url';
  image_url: {
    url: string;
    detail?: string;
  };
}

/**
 * 供应商扩展内容块（如 DeepSeek Files API 的 `file` 块）。
 *
 * 本文件不假设其结构——各家扩展形状不同，假装知道就是撒谎。
 * 具体形状在对应的供应商类型文件里定义（如 DeepSeekFilePart）。
 */
export interface VendorPart {
  type: string;
}

/** 多模态内容块 */
export type ContentPart = TextPart | ImagePart | VendorPart;

// ── 消息 ──

/** 消息角色。system / user / assistant 是三家以上共有的最小集 */
export type ChatRole = 'system' | 'user' | 'assistant';

/** 单条对话消息，兼容 OpenAI Chat Completion 格式 */
export interface ChatMessage {
  role: ChatRole;
  /** 纯文本；带图时必须用内容块数组 */
  content: string | ContentPart[];
}

// ── 流式响应 ──

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
}

/** 流式对话中每次 yield 的数据块 */
export interface ChatChunk {
  /** 增量文本内容（最终回答） */
  content: string;
  /**
   * 思维链 / 推理过程。
   *
   * 非 OpenAI 官方字段，但已是 DeepSeek / Kimi / GLM / Qwen 等
   * OpenAI 兼容实现的**事实约定**，故保留在通用层。
   * 不用思考链的模型此字段恒为 undefined。
   */
  reasoningContent?: string;
  /** 流结束时的终止原因，仅在最后一个 chunk 出现 */
  finishReason?: 'stop' | 'length' | 'error';
  /** Token 用量统计，仅在最后一个 chunk 出现（需 stream_options.include_usage） */
  usage?: TokenUsage;
}

// ── 通用选项 ──

export interface ChatOptions {
  /** 采样温度 */
  temperature?: number;
  /** 最大输出 token 数 */
  maxTokens?: number;
}

// ── 附件 ──

/**
 * 用户上传的素材文件。
 *
 * 注意：这不是任何 API 的原生类型，是本项目自己的输入结构，
 * 由 context 层组装成 ContentPart 后发给模型。
 */
export interface Attachment {
  name: string;
  /**
   * 图片地址。两种形式：
   * - base64 data URL（本地文件先用 ../util/data-url.ts 的 fileToDataUrl 转好）
   * - 公网 http(s) URL
   */
  url: string;
  /** 图像处理档位。取值由供应商决定，默认值见 context 配置 */
  detail?: string;
}
