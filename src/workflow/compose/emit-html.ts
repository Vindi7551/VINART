/**
 * HTML 产出模块 —— 把版式渲染结果组装成**可直接喂渲染器的自包含 HTML**。
 *
 * ## 历史：这个模块曾经落盘两份文件
 *
 * 以前它写 `<name>.html`（自包含）与 `<name>.linked.html`（素材走相对路径），
 * 定位是"人手改 CSS 再重渲"。**2026-10-09 全部删除**，理由：
 *   1. PNG 渲染一直用的是**内存里的字符串**（`selfContainedHtml`），从不读文件；
 *   2. 网页可编辑视图的 HTML 由服务端**现场渲染**，也不读文件；
 *   3. 全仓库零消费方；而"手改 CSS"那条回路本就自相矛盾——CSS 是渲染器从
 *      spec 生成的，手改必被下一次 final 覆盖。
 *
 * 要单文件分享版时，从这里把组装结果写出去即可（本模块已产出完整字符串）。
 *
 * 实现上用**占位符替换**而不是拼字符串：模板里写 `{{SCENE}}`，替换成 data URL。
 * 这样"量文字宽度"和"正式渲染"两条路径共用同一份模板，不会改了一处忘了另一处。
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** 模板占位符 → 资源文件名的映射 */
export interface HtmlAssets {
  /** key 是占位符名（不含花括号），value 是相对文件名 */
  [placeholder: string]: string;
}

export interface EmitHtmlOptions {
  /** 含 `{{PLACEHOLDER}}` 的页面模板 */
  template: string;
  /** 占位符 → 相对文件名（如 { SCENE: 'scene.png' }） */
  assets: HtmlAssets;
  /** 资源搜索根（按序找第一个存在；首个=版式目录，其后为回退根如工作目录） */
  assetRoots: string[];
  /** 溯源信息，会写成 HTML 注释放在返回的 HTML 头部 */
  meta: Record<string, string>;
}

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

/**
 * 多根素材解析：按序找第一个存在的文件。
 * 版式目录优先；找不到再试调用方给的回退根（如工作目录）——
 * 贴图等素材可能以工作目录相对路径被 spec 引用（如 uploads/chat-x.jpg）。
 */
function resolveAssetFile(dirs: string[], filename: string): string {
  for (const dir of dirs) {
    const p = resolve(dir, filename);
    if (existsSync(p)) return p;
  }
  return resolve(dirs[0]!, filename); // 都不存在：回退首根，让上层报错带上首根路径
}

function readAsDataUrl(dirs: string[], filename: string): string {
  const ext = (filename.split('.').pop() ?? '').toLowerCase();
  const mime = MIME[ext];
  if (!mime) throw new Error(`不支持的图片类型：${filename}`);
  return `data:${mime};base64,${readFileSync(resolveAssetFile(dirs, filename)).toString('base64')}`;
}

/** 按 `{{KEY}}` 替换模板 */
function substitute(template: string, map: Record<string, string>): string {
  let out = template;
  for (const [key, value] of Object.entries(map)) {
    out = out.split(`{{${key}}}`).join(value);
  }
  return out;
}

/**
 * 只把占位符替换成内联 data URL，不落盘。
 *
 * 用途：驱动脚本需要先拿一份**可渲染的完整 HTML**去浏览器里实测文字宽度
 * （做字号自适应），量完再回填系数重新生成。落盘交给 emitHtml。
 */
export function inlineAssets(
  template: string,
  assets: HtmlAssets,
  assetRoots: string[],
): string {
  const inlineMap: Record<string, string> = {};
  for (const [key, filename] of Object.entries(assets)) {
    inlineMap[key] = readAsDataUrl(assetRoots, filename);
  }
  return substitute(template, inlineMap);
}

/** 生成溯源注释块 */
function provenance(meta: Record<string, string>): string {
  const lines = Object.entries(meta).map(([k, v]) => `  ${k}: ${v}`);
  return [
    '<!--',
    '  Vinart 生成产物 — 版式源文件（HTML+CSS）',
    ...lines,
    '',
    '  这份文件是 PNG 的**源文件**，不是从 PNG 反推的。',
    '  要改版式，直接改下面的 <style> 里的 CSS，然后用 Blink 渲染器重渲即可——',
    '  不需要重新调用任何大模型。',
    '-->',
  ].join('\n');
}

/**
 * 组装出**可直接渲染**的完整 HTML（图片已内联为 data URL）。
 *
 * ⚠️ 渲染必须用这个返回值，不能拿含 `{{占位符}}` 的模板去渲染——
 * 否则图片是断的（踩过一次：PNG 从 3.9MB 掉到 122KB）。
 */
export function emitHtml(opts: EmitHtmlOptions): string {
  const { template, assets, assetRoots, meta } = opts;

  // 图片内联为 data URL
  const inlineMap: Record<string, string> = {};
  for (const [key, filename] of Object.entries(assets)) {
    inlineMap[key] = readAsDataUrl(assetRoots, filename);
  }
  return provenance(meta) + '\n' + substitute(template, inlineMap);
}
