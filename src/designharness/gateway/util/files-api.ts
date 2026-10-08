/**
 * Files API 上传 —— 「OpenAI 兼容生态事实约定 + DeepSeek 实测」。
 *
 * 为什么单独一个文件：上传接口（multipart /files、purpose 字段）是
 * OpenAI / DeepSeek 共同的事实约定，但它不是 chat 协议的一部分——
 * 塞进 provider 等于把两种协议混在一个文件里。
 *
 * 何时用它（官方结论，见 deepseek-chat.ts 的实测限制表）：
 * - 同一张图在**多个请求**中复用（聊天场景：贴一次图，多轮对话不再重传 base64）
 * - 图片超过 32 MiB 内联限制（Files API 单图可达 64 MiB）
 *
 * ⚠️ token 成本事实（实测，勿误解）：file_id 与 base64 的 prompt_tokens
 * 完全相同——省的是请求体体积（每轮少传整个 base64），不是 token。
 * 真正省 token 的是 prompt 前缀缓存，与传输方式无关、两种方式共享同一份缓存。
 *
 * 有效期：不传 expires_after 则**永久有效**（官方文档）；
 * 配额 25 GiB / 10000 文件——聊天贴图（压缩后 ≤3MB）远期才可能触顶。
 */

import { fetchWithRetry } from '../client/retry';

/** Files API 单文件上限（不受 32 MiB 内联限制） */
export const FILES_API_MAX_BYTES = 64 * 1024 * 1024;

/** purpose 字段取值。DeepSeek 视觉场景固定 user_data（官方要求） */
const PURPOSE = 'user_data';

export interface UploadImageOptions {
  baseURL: string;
  apiKey: string;
  /** 图片二进制 */
  bytes: Buffer;
  /** 上传文件名（含扩展名；服务端按**文件内容**判断格式，名字仅供参考） */
  filename: string;
}

/**
 * 上传一张图片到 Files API，返回 file_id（形如 `file-api-...`）。
 *
 * 上传不幂等：失败重试由 fetchWithRetry 承担（429/5xx/网络错误），
 * 4xx 直接抛出（带服务端原始错误文本，便于定位——如格式不支持）。
 */
export async function uploadImageFile(opts: UploadImageOptions): Promise<string> {
  const { baseURL, apiKey, bytes, filename } = opts;

  const form = new FormData();
  form.append('purpose', PURPOSE); // 字段名固定 purpose，值固定 user_data
  // new Blob([bytes]) 显式给 Uint8Array 视图——直接传 Buffer 会被当成
  // BodyInit 的二进制分支处理，但 Blob 包装后 Content-Type 语义更明确
  form.append('file', new Blob([new Uint8Array(bytes)]), filename);

  const response = await fetchWithRetry(
    `${baseURL}/files`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      timeout: 120_000, // 大图上传慢于普通请求；官方上限 10 分钟，这里取 2 分钟
    },
    { retries: 2, timeout: 120_000 },
  );

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Files API 上传失败 HTTP ${response.status}：${text.slice(0, 300)}`);
  }

  let fileId: string | undefined;
  try {
    fileId = (JSON.parse(text) as { id?: string }).id;
  } catch {
    // JSON 解析失败 → fileId 保持 undefined，走下面的统一报错
  }
  if (!fileId) {
    throw new Error(`Files API 响应缺少 id：${text.slice(0, 300)}`);
  }
  return fileId;
}
