/**
 * 解析钩子本体（由 `_ts-resolve.mjs` 用 `register()` 挂上）。
 *
 * 背景与用法见 `_ts-resolve.mjs`。这里做两件事（都是打包器会做、Node 不会做的）：
 * 1. 无扩展名的相对 specifier → 补 `.ts` / `.tsx`
 * 2. **目录 import**（`'./context'` → `'./context/index.ts'`）
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const EXTS = ['.ts', '.tsx'];

function tryFile(url) {
  return existsSync(fileURLToPath(url)) ? url : null;
}

export async function resolve(specifier, context, nextResolve) {
  // ⚠️ `parentURL` 是 data URL 时，相对 specifier **没法解析**（data URL 没有目录）。
  //    反向验证用 data URL import 改过的源码 ⇒ 把它的相对 import 映射回原文件所在目录
  //    （原文件路径由 `_verify-polygon-fix.mjs` 通过 globalThis 递进来）。
  if (specifier.startsWith('.') && context.parentURL?.startsWith('data:')) {
    const base = globalThis.__TS_RESOLVE_BASE__;
    if (base) {
      for (const ext of EXTS) {
        const hit = tryFile(new URL(specifier + ext, base));
        if (hit) return { url: hit.href, shortCircuit: true };
      }
      for (const ext of EXTS) {
        const hit = tryFile(new URL(`${specifier}/index${ext}`, base));
        if (hit) return { url: hit.href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  }

  if (specifier.startsWith('.') && context.parentURL) {
    const hasExt = /\.[cm]?[jt]sx?$/.test(specifier);
    if (!hasExt) {
      // ① 直接补扩展名
      for (const ext of EXTS) {
        const hit = tryFile(new URL(specifier + ext, context.parentURL));
        if (hit) return { url: hit.href, shortCircuit: true };
      }
      // ② 当成目录 ⇒ 找 index
      for (const ext of EXTS) {
        const hit = tryFile(new URL(`${specifier}/index${ext}`, context.parentURL));
        if (hit) return { url: hit.href, shortCircuit: true };
      }
    }
  }
  return nextResolve(specifier, context);
}

/**
 * `.json` 的 import —— 项目里写的是 bundler 风格（`import keys from './keys.json'`），
 * 没有 `with { type: 'json' }`，Node 会直接拒。这里自己读盘、包成 JS 模块。
 *
 * 另外放行 `data:text/typescript`（反向验证用：把改过的源码在内存里 import，
 * 不必碰工作区文件 —— 曾经用 PowerShell 改源文件把中文写坏过一次）。
 */
export async function load(url, context, nextLoad) {
  if (url.startsWith('data:text/typescript')) {
    const comma = url.indexOf(',');
    return { format: 'module-typescript', shortCircuit: true, source: decodeURIComponent(url.slice(comma + 1)) };
  }
  if (url.endsWith('.json')) {
    const src = readFileSync(fileURLToPath(url), 'utf8');
    return {
      format: 'module',
      shortCircuit: true,
      source: `export default ${src.trim()};`,
    };
  }
  return nextLoad(url, context);
}
