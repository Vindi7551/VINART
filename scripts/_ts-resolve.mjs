/**
 * Node 解析钩子：让**无扩展名的 TS import** 也能被 Node 直接解析。
 *
 * 项目源码是打包器风格（`import { x } from './emit'`），Node 的 ESM 解析器
 * 找不到这种 specifier。本机沙箱里 esbuild 起不来（`spawn EPERM`），
 * 所以给 Node 挂一个 loader：
 *   `./x` → 先试 `./x.ts`，再试 `./x.tsx`，都不存在就退回原样（保留 Node 报错）。
 *
 * ⚠️ `--import` 进来的模块**必须自己 `register()`**（导出一个 `resolve` 是没用的）。
 *
 * 用法：`node --import ./scripts/_ts-resolve.mjs <脚本.mjs>`
 * ⚠️ 只给探针用，**不影响应用**：vite / tsc 那条链一个字都没改。
 */

import { existsSync } from 'node:fs';
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';

register('./_ts-resolve-hooks.mjs', import.meta.url);

/** 钩子是否真的挂上了 —— 探针可以断言这一条，免得"hooks 静默失效"又成暗坑 */
export const REGISTERED = existsSync(fileURLToPath(new URL('./_ts-resolve-hooks.mjs', import.meta.url)));
