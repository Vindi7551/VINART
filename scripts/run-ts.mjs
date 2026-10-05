#!/usr/bin/env node
/**
 * 通用 TS 脚本运行器。
 *
 * 项目的 TS 用的是 bundler 风格的无扩展名 import（'./chat-context'），
 * Node 原生 ESM 解析不了，所以先用 esbuild 打包成单个 .mjs 再执行。
 * esbuild 是 vite 的既有依赖，无需额外安装。
 *
 * 用法：
 *   node scripts/run-ts.mjs scripts/verify-vision.ts
 *   npm run step scripts/verify-vision.ts        ← 等价写法
 *
 * 设计意图：让每一步管线都能「单独跑、单独看输出」，脚本本身零配置。
 *
 * ⚠️ 为什么把 bundle 放在**项目内**的 .tmp-run/ 而不是系统临时目录：
 * 脚本可能 import 运行时依赖（如 playwright）。esbuild 把这类依赖标为 external
 * 后由 Node 在运行时解析，而**模块解析是从 bundle 所在目录向上找 node_modules**。
 * 若 bundle 落在系统临时目录，向上永远找不到项目的 node_modules，
 * 会报 ERR_MODULE_NOT_FOUND: Cannot find package 'playwright'。
 */

import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const target = process.argv[2];
if (!target) {
  console.error('用法: node scripts/run-ts.mjs <脚本.ts> [...参数]');
  process.exit(1);
}

const entry = resolve(process.cwd(), target);
// 放在项目根下的 .tmp-run/：向上两级就能命中 node_modules
const outDir = resolve(process.cwd(), '.tmp-run');
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, `bundle-${Date.now()}.mjs`);

await build({
  entryPoints: [entry],
  outfile: outFile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: 'inline',
  // playwright 带原生二进制，不能打进 bundle
  external: ['playwright', 'playwright-core'],
  logLevel: 'warning',
});

// 把剩余参数透传给目标脚本（argv[0]=node, argv[1]=虚拟脚本路径, argv[2..]=真实参数）
process.argv = [process.argv[0], outFile, ...process.argv.slice(3)];

await import(pathToFileURL(outFile).href);
