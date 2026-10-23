/**
 * 出图任务参数 —— **前端与服务端共用的唯一一份**。
 *
 * 为什么不放进 `blink-renderer.ts`：那是 Node 模块（import 了 `node:path` /
 * `playwright`），前端不能碰。这里只放**纯类型**，两边都能 import。
 *
 * ⚠️ 服务端仍要对所有值做 clamp / 白名单：前端传什么都不可信，
 *    尤其是 `filename`（会拼进落盘路径）。
 */
export type RenderFormat = 'png' | 'jpeg';

/** 前端 → `POST /api/layout/<name>/render` 的 body */
export interface RenderJobOptions {
  /** 输出倍率（CSS px → 设备 px）。1–4，默认 2 */
  deviceScaleFactor?: number;
  /** 导出副本格式；工作区始终另有 `final.png`。默认 png */
  format?: RenderFormat;
  /** JPEG 质量 1–100；PNG 忽略。默认 95 */
  quality?: number;
  /** 导出副本目录（绝对路径）。空 = 版式目录 */
  outputDir?: string;
  /** 导出副本文件名（不含扩展名）。默认 final */
  filename?: string;
}

/** 服务端 → 前端的结果（失败时 `ok:false` + `log`） */
export interface RenderJobResult {
  ok: boolean;
  /** 工作区 canonical `final.png` 的绝对路径 */
  png?: string;
  /** 实际导出副本的绝对路径（可能与 `png` 相同） */
  savedTo?: string;
  width?: number;
  height?: number;
  size?: number;
  log?: string;
}

/**
 * **文件名安全化** —— 服务端落盘与前端「导出到：…」提示**共用这一份**，
 * 否则界面显示 `海报 01.png`、磁盘上却是 `海报_01.png`，用户会以为没保存对。
 *
 * - 只取最后一段（防 `../` / 绝对路径）；
 * - 去扩展名（扩展名由服务端按格式补）；
 * - 保留 Unicode 字母/数字、`.` `_` `-`；空格和别的字符换成 `_`；
 * - 去掉开头的点（防隐藏文件 / `..`）；
 * - 空 ⇒ `final`。
 */
export function sanitizeRenderFilename(raw: string): string {
  const base = (raw.split(/[\\/]/).pop() ?? raw)
    .replace(/\.(png|jpe?g)$/i, '')
    .replace(/[^\p{L}\p{N}._-]+/gu, '_')
    .replace(/^\.+/, '');
  return base || 'final';
}
