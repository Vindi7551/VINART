/**
 * 渲染层（Render Layer）
 *
 * 负责将 HTML+CSS 转化为可视产物：
 * - 图片嵌入：将本地图片转为 base64 data URI，生成自包含 HTML
 * - Blink 导出：通过 headless Chromium 渲染高分辨率成品图
 *
 * 预览层的实时渲染（iframe srcdoc）由浏览器原生 Blink 完成，
 * 不走本层。
 */

// ── 图片嵌入 ──
export { embedImagesInHtml, getCompletedImageRefs } from './embed-images';
export type { ImageRef } from './embed-images';

// ── Blink 导出（仅 Node.js，浏览器不应 import）──
// 不要在此 barrel 中 export createBlinkRenderer —— 它依赖 playwright
// （Node.js 专有）。浏览器走 iframe preview，不需要 Blink 渲染。
export type {
  BlinkRenderer,
  RenderConfig,
  RenderInput,
  RenderOutput,
} from './blink-renderer';
