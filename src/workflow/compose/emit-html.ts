/**
 * HTML 产出模块 —— 把版式源文件落盘。
 *
 * 为什么必须有这一步：
 * PNG 只是**渲染结果**，HTML+CSS 才是**源文件**。
 * 之前 HTML 只作为模板字符串存在脚本内存里，喂给渲染器就丢了——
 * 后果是"想改一版版式就必须重跑整个脚本"，而脚本里含大模型调用。
 * 落盘之后，改版式 = 改 HTML 的 CSS + 重渲（3 秒），不碰模型。
 *
 * 产出两种形态，各有用途：
 *
 * | 文件 | 形态 | 用途 |
 * |---|---|---|
 * | `<name>.html` | **自包含**，图片以 data URL 内联 | 就是渲染出 PNG 的那份，可单独打开/转发，结果绝对一致 |
 * | `<name>.linked.html` | 图片走**相对路径** | 体积小、可读可编辑，适合改 CSS 迭代 |
 *
 * 实现上用占位符替换而不是拼两遍字符串：
 * 页面模板里写 `{{SCENE}}`，自包含版替换成 data URL，链接版替换成文件名。
 * 这样两条路径共用同一份模板，不会出现「改了一处忘了另一处」。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  /** 输出目录 */
  outDir: string;
  /** 输出名，不含扩展名，如 'final' */
  name: string;
  /** 溯源信息，会写成 HTML 注释放在文件头 */
  meta: Record<string, string>;
}

export interface EmitHtmlResult {
  /** 自包含版（图片内联）的路径 */
  selfContained: string;
  /** 相对路径版的路径 */
  linked: string;
  /** 自包含版的完整 HTML —— **渲染必须用这个**，不能拿含占位符的模板去渲染，
   *  否则图片是断的（这个坑踩过一次：PNG 从 3.9MB 掉到 122KB） */
  selfContainedHtml: string;
  /** 相对路径版的完整 HTML */
  linkedHtml: string;
  /** 自包含版的字节数 */
  selfContainedBytes: number;
  linkedBytes: number;
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

export function emitHtml(opts: EmitHtmlOptions): EmitHtmlResult {
  const { template, assets, assetRoots, outDir, name, meta } = opts;
  mkdirSync(outDir, { recursive: true });

  // 自包含版：图片内联为 data URL
  const inlineMap: Record<string, string> = {};
  for (const [key, filename] of Object.entries(assets)) {
    inlineMap[key] = readAsDataUrl(assetRoots, filename);
  }
  const selfContainedHtml = provenance(meta) + '\n' + substitute(template, inlineMap);

  // 相对路径版：图片名直接用
  const linkedHtml = provenance(meta) + '\n' + substitute(template, assets);

  const selfContained = resolve(outDir, `${name}.html`);
  const linked = resolve(outDir, `${name}.linked.html`);

  writeFileSync(selfContained, selfContainedHtml, 'utf8');
  writeFileSync(linked, linkedHtml, 'utf8');

  return {
    selfContained,
    linked,
    selfContainedHtml,
    linkedHtml,
    selfContainedBytes: Buffer.byteLength(selfContainedHtml, 'utf8'),
    linkedBytes: Buffer.byteLength(linkedHtml, 'utf8'),
  };
}
