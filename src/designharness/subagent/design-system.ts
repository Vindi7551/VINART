/**
 * 版式设计子 agent 的 system 素材。
 *
 * 契约单一真源：直接读 `src/workflow/design-sketch/design-sketch.md`——
 * 子 agent 与（已删的）CLI `compile.ts` 用的是同一份，契约更新自动同步（不复制）。
 *
 * 纪律部分从 `compile.ts` 的提示词资产抽取改写（**该 CLI 已于 2026-10-09 删除**）：
 * 它那版写给「产 spec 的固定循环」（只输出 JSON），这里写给「用工具的智能体」
 * （save_spec → 按 issues 自纠 → render_sketch → finish）。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CONTRACT_PATH = resolve('src/workflow/design-sketch/design-sketch.md');
const SYSTEM_PATH = resolve('src/designharness/subagent/subagent-system.md');

/** 版式契约全文（单一真源；进程内读一次缓存） */
let contractCache: string | null = null;
export function layoutContract(): string {
  if (contractCache === null) contractCache = readFileSync(CONTRACT_PATH, 'utf8');
  return contractCache;
}

/**
 * 子 agent 的 system prompt（契约 + 纪律 + 工作方式）。
 *
 * ⚠️ 文本单一真源是 `subagent-system.md`（同目录）——改提示词不必改代码。
 * md 里的 `{{CONTRACT}}` 占位符由 layoutContract() 注入（契约仍单一真源在
 * design-sketch.md，不复制）。
 */
let systemTemplateCache: string | null = null;
export function designAgentSystem(): string {
  if (systemTemplateCache === null) {
    systemTemplateCache = readFileSync(SYSTEM_PATH, 'utf8');
  }
  return systemTemplateCache.replace('{{CONTRACT}}', layoutContract());
}
