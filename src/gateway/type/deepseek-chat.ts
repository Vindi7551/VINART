/**
 * DeepSeek 专有类型与实测常量。
 *
 * 为什么单独一个文件：
 * `type/chat.ts` 是**协议中立**层——`ChatMessage{role, content}`、`TokenUsage`、
 * `ContentPart` 的 text / image_url 块都是 OpenAI 兼容的行业事实约定，
 * 换 Qwen / GLM / Kimi 一样成立。
 * 而下面这些东西**只有 DeepSeek 有**（或在本项目中只对 DeepSeek 实测过），
 * 混在通用文件里等于把供应商细节伪装成标准，所以拆出来。
 *
 * 凡是本文件里的数值，都是**实测或官方文档结论**，不是推测。
 * 文档：https://api-docs.deepseek.com/guides/vision  ·  /guides/files_api
 */

import type { ContentPart, ChatMessage } from './chat';

// ══════════════════════════════════════════════════════════
// 一、模型
// ══════════════════════════════════════════════════════════

/**
 * 当前视觉模型名。
 * 视觉能力挂在 Flash 系列上：旧名 `deepseek-v4-flash-vision-exp` 已退役，
 * 但请求仍会被路由到最新 Flash 模型（实测 `deepseek-v4-flash` 也能看图）。
 */
export const DEEPSEEK_VISION_MODEL = 'deepseek-flash';

/** 历史模型名，实测仍可用 */
export const DEEPSEEK_LEGACY_VISION_MODEL = 'deepseek-v4-flash';

// ══════════════════════════════════════════════════════════
// 二、图像处理档位
// ══════════════════════════════════════════════════════════

/**
 * 图像处理档位。
 *
 * OpenAI 官方只有 low / high / auto；**`original` 是 DeepSeek 的扩展**。
 *
 * 实测（1024×1024 产品图，同一提示词）：
 * - `low`      降采样到 512×512 → prompt ≈ 230 token，但**会漏字**
 *               （6 个关键德文词只中 5 个，漏掉最小的 RUHEPAUSEN）
 * - `original` 保留原图          → prompt ≈ 978 token，**6/6 全对**
 *
 * → 识别商品图上的雕刻 / 小号文字**必须用 `original`**；
 *   省下的 76% token 会以丢字为代价，得不偿失。
 */
export type DeepSeekImageDetail = 'low' | 'high' | 'original' | 'auto';

/** 本项目的默认档位：看雕刻细节，必须 original */
export const DEEPSEEK_DEFAULT_IMAGE_DETAIL: DeepSeekImageDetail = 'original';

// ══════════════════════════════════════════════════════════
// 三、Files API 内容块
// ══════════════════════════════════════════════════════════

/**
 * 引用已上传文件（`POST /files` 返回的 `file-api-...`）。
 *
 * 用途：同一张图在**多个请求**间反复引用，免去每次重传 base64。
 *
 * ⚠️ 关键成本事实（实测，勿误解）：
 * - **不省 token**。file_id 与 base64 的 prompt_tokens 完全相同（同为 972）。
 *   图片 token 由「图像内容 + detail 档位」决定，与传输方式无关。
 * - 省的是**请求体体积**：base64 把 2.05 MB 文件膨胀到 2.74 MB（+33%），
 *   file_id 只是一个约 40 字符的字符串 → 每请求省约 2.7 MB 传输。
 * - 真正省 token 的是 **prompt 前缀缓存**（同图复用实测命中约 79%），
 *   且缓存与传输方式无关——两种方式解析出的 token 序列相同，共享同一份缓存。
 */
export interface DeepSeekFileRefPart {
  type: 'file';
  file_id: string;
}

/** 内联 base64 的 file 块（与 file_id 互斥） */
export interface DeepSeekFileDataPart {
  type: 'file';
  file_data: string;
  filename?: string;
}

export type DeepSeekFilePart = DeepSeekFileRefPart | DeepSeekFileDataPart;

/** DeepSeek 消息可容纳的内容块：通用块 + file 块 */
export type DeepSeekContentPart = ContentPart | DeepSeekFilePart;

/** 可携带 file 块的 DeepSeek 消息 */
export interface DeepSeekMessage extends Omit<ChatMessage, 'content'> {
  content: string | DeepSeekContentPart[];
}

// ══════════════════════════════════════════════════════════
// 四、实测限制（官方文档 + 实证）
// ══════════════════════════════════════════════════════════

export const DEEPSEEK_LIMITS = {
  /** 支持格式。**按文件字节判断，不看扩展名或声明的 MIME** */
  supportedFormats: ['jpeg', 'png', 'gif', 'webp'],
  /** 请求体上限（base64 内联计入此项） */
  maxRequestBodyBytes: 48 * 1024 * 1024,
  /** 单图内联上限 */
  maxInlineImageBytes: 32 * 1024 * 1024,
  /** 走 Files API 时的单图上限（不受 32 MiB 限制） */
  maxFilesApiImageBytes: 64 * 1024 * 1024,
  /** 单请求最多图片数 */
  maxImagesPerRequest: 600,
  /** 外链 URL 最大字符数 */
  maxImageUrlChars: 8192,
  /** 外链下载超时 */
  maxUrlDownloadMs: 60_000,
  /** Files API 上传需在此时限内完成 */
  maxUploadMs: 10 * 60_000,
  /** detail='low' 时的降采样边长 */
  detailLowPx: 512,
} as const;

/**
 * 单张图片的 token 成本估算。
 *
 * 实测：1024×1024 产品图 @ detail='original' → 972 total，
 * 减去纯文本基线 40 → **图片本身约 932 token**。取 1000 作保守上限。
 *
 * ⚠️ 绝不可对图片内容做 `JSON.stringify(...).length / 3`：
 * 一张 2 MB 图的 base64 有 273 万字符，会算出约 **91 万 token** 的假数字，
 * 直接摧毁 token 预算与压缩触发逻辑（修复前实测正是 913,287）。
 */
export const DEEPSEEK_IMAGE_TOKEN_COST = 1000;

/**
 * ⚠️ 同一张图在**一个请求内被引用多次不会去重**，token 线性叠加。
 * 实测：引用 2 次 → 972 → 1905。
 * 要复用请靠 prompt 前缀缓存，不要在一个 prompt 里重复塞同一张图。
 */
export const DEEPSEEK_DEDUPES_REPEATED_IMAGES = false;
