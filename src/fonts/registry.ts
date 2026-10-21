/**
 * 字体库（服务端）—— 读 `designassets/fonts/families/<dir>/family.json`，
 * 生成 `@font-face` CSS（URL 版），并算出这份 doc 真正用到的 family / weight。
 *
 * ⚠️ 只在 Node 侧用（读盘）。`emit.ts` 仍然是纯函数：字体 CSS 由调用方以
 *    `faceCss` 值注入，本文件不参与浏览器 bundle。
 *
 * 设计决定（2026-10-20）：
 * - **完整字体，不做子集**：编辑要能打任意字；出图只出 PNG，不需要自包含 HTML。
 * - 预览用相对地址、出图用绝对地址；渲染器截图前用 `fontChecks` 断言字体真的加载了。
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { iterElements, type DesignDocument } from '../document/vocabulary';

export interface FontFamily {
  /** CSS 里的 family 名（如 `Noto Serif SC`） */
  family: string;
  /** 目录名（URL 里用，如 `NotoSerifSC`） */
  dir: string;
  weights: number[];
  /** weight → 文件名（如 `"400": "400.woff2"`） */
  files: Record<string, string>;
  license?: string;
  source?: string;
  subset?: string;
  /** 覆盖哪些文字系统：`hans`（中文）/ `latin`（英文）。旧库没写 ⇒ 默认 latin。 */
  scripts?: string[];
  character?: string;
  bestFor?: string;
}

const ROOT = resolve('designassets/fonts/families');

let cache: FontFamily[] | null = null;

/** 扫描字体库；family.json 不合法 / 缺文件的直接跳过（开发期看 console.warn） */
export function listFontFamilies(): FontFamily[] {
  if (cache) return cache;
  if (!existsSync(ROOT)) {
    cache = [];
    return cache;
  }

  const out: FontFamily[] = [];
  for (const d of readdirSync(ROOT, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const p = join(ROOT, d.name, 'family.json');
    if (!existsSync(p)) continue;
    try {
      const raw = JSON.parse(readFileSync(p, 'utf8')) as Partial<FontFamily>;
      const family = typeof raw.family === 'string' ? raw.family.trim() : '';
      const dir = typeof raw.dir === 'string' && raw.dir.trim() ? raw.dir.trim() : d.name;
      const weights = Array.isArray(raw.weights)
        ? raw.weights.filter((w): w is number => typeof w === 'number' && Number.isFinite(w))
        : [];
      const files = raw.files && typeof raw.files === 'object' ? raw.files : {};
      const validWeights = weights.filter((w) => {
        const f = files[String(w)];
        return typeof f === 'string' && existsSync(join(ROOT, dir, f));
      });
      if (!family || !validWeights.length) {
        console.warn(`[fonts] 跳过 ${p}：family 为空或没有可用字重文件`);
        continue;
      }
      const scripts = Array.isArray(raw.scripts)
        ? raw.scripts.filter((s): s is string => typeof s === 'string' && !!s.trim())
        : /\bSC$/.test(family)
          ? ['hans', 'latin']
          : ['latin'];
      out.push({
        family,
        dir,
        weights: validWeights,
        files,
        scripts,
        ...(raw.license ? { license: raw.license } : {}),
        ...(raw.source ? { source: raw.source } : {}),
        ...(raw.subset ? { subset: raw.subset } : {}),
        ...(raw.character ? { character: raw.character } : {}),
        ...(raw.bestFor ? { bestFor: raw.bestFor } : {}),
      });
    } catch (e) {
      console.warn(`[fonts] 读取 ${p} 失败：${(e as Error).message}`);
    }
  }
  out.sort((a, b) => a.family.localeCompare(b.family));
  cache = out;
  return out;
}

/** 按 CSS family 名找；找不到返回 null */
export function findFontFamily(family: string): FontFamily | null {
  const f = family.trim();
  return listFontFamilies().find((x) => x.family === f) ?? null;
}

/** 字体路由用：按目录名 + 文件名找绝对路径（只接受库里登记过的文件名） */
export function fontFileByDir(dir: string, file: string): string | null {
  const f = listFontFamilies().find((x) => x.dir === dir);
  if (!f) return null;
  const name = Object.values(f.files).find((v) => v === file);
  if (!name) return null;
  return join(ROOT, f.dir, name);
}

/** 把 CSS font-family 栈拆成候选 family（去引号、去空白、去 generic） */
export function familyStackOf(stack: string | undefined): string[] {
  if (!stack) return [];
  return stack
    .split(',')
    .map((s) => s.trim().replace(/^["']|["']$/g, '').trim())
    .filter((s) => s && !/^(serif|sans-serif|monospace|cursive|fantasy|system-ui)$/i.test(s));
}

/**
 * 这份 doc 里用到的字体库 family。
 * 只收**库里有的**；系统/未知字体不生成 @font-face（最终会 fallback，出图断言会报错）。
 */
export function usedFontFamilies(doc: DesignDocument): string[] {
  const out = new Set<string>();
  for (const layer of doc.layers) {
    for (const e of iterElements(layer)) {
      if (e.type !== 'text') continue;
      for (const stack of [e.fontFamily, ...e.runs.map((r) => r.fontFamily)]) {
        for (const name of familyStackOf(stack)) {
          if (findFontFamily(name)) out.add(name);
        }
      }
    }
  }
  return [...out];
}

/** 请求的 weight → 库里最近的可用 weight（字体没有 600 就用 700，避免假加粗） */
export function nearestWeight(family: string, requested: number | undefined): number {
  const f = findFontFamily(family);
  if (!f || !f.weights.length) return requested ?? 400;
  const want = requested ?? 400;
  return f.weights.reduce((best, w) => (Math.abs(w - want) < Math.abs(best - want) ? w : best), f.weights[0]!);
}

export interface FontCheck {
  family: string;
  weight: number;
}

/** 出图前要断言的 family + weight（用最近可用字重） */
export function usedFontChecks(doc: DesignDocument): FontCheck[] {
  const out = new Map<string, FontCheck>();
  for (const layer of doc.layers) {
    for (const e of iterElements(layer)) {
      if (e.type !== 'text') continue;
      for (const [stack, weight] of [
        [e.fontFamily, e.weight],
        ...e.runs.map((r) => [r.fontFamily, r.weight] as const),
      ] as const) {
        for (const name of familyStackOf(stack)) {
          if (!findFontFamily(name)) continue;
          const w = nearestWeight(name, weight);
          out.set(`${name}|${w}`, { family: name, weight: w });
        }
      }
    }
  }
  return [...out.values()];
}

/**
 * 生成 `@font-face` CSS。
 * @param baseUrl 字体路由前缀，如 `/api/fonts` 或 `http://127.0.0.1:8787/api/fonts`
 * @param families 不传 = 库里全部（预览/编辑器要能随时换字体）；传 = 只出这份 doc 用到的
 */
export function buildFontCss(opts: { baseUrl: string; families?: string[] }): string {
  const base = opts.baseUrl.replace(/\/+$/, '');
  const want = opts.families ? new Set(opts.families) : null;
  const lines: string[] = [];
  for (const f of listFontFamilies()) {
    if (want && !want.has(f.family)) continue;
    for (const w of f.weights) {
      const file = f.files[String(w)];
      if (!file) continue;
      lines.push(
        `@font-face{font-family:"${f.family}";font-style:normal;font-weight:${w};` +
          `font-display:block;src:url("${base}/${encodeURIComponent(f.dir)}/${encodeURIComponent(file)}") format("woff2")}`,
      );
    }
  }
  return lines.join('\n');
}
