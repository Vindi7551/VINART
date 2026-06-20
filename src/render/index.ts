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

// ── Blink 导出（待实现）──
// export { createBlinkRenderer } from './blink-renderer';
// export type { BlinkRenderer, RenderConfig, RenderInput, RenderOutput } from './blink-renderer';
