/**
 * `sketch_plan` 工具 —— 把 AI 的草图 plan 写成**当前版式的草稿 doc.json**。
 *
 * 分层：
 *   AI 只出 plan JSON（`sketchPlanJsonSchema`）；
 *   写到哪个版式由**宿主**决定（`ctx.activeLayout`，来自 /chat 的 activeLayout），
 *   AI **不传 layout**。
 *
 * 产物：
 *   `<workDir>/designs/<activeLayout>/doc.json` —— 合法但带默认样式/占位图的**草稿**。
 *   颜色阶段 / 素材阶段后续 patch 这份 doc；plan 不落盘。
 *
 * 失败：
 *   - 没有 activeLayout、版式名非法、plan 结构不完整、translate 有 error → 返回错误，**不写盘**；
 *   - translate 的 note 级 issue 正常返回给 AI，让它知道哪里可能有问题。
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DesignDocument } from '../../document/vocabulary';
import {
  planToIntent,
  sketchPlanJsonSchema,
  type SketchPlan,
} from '../../schema/plan';
import { translate, type IntentIssue } from '../../workflow/translate/translate';
import { getWorkDir } from '../session/transcript';
import type { AgentTool } from '../subagent/types';

export interface WriteSketchResult {
  ok: boolean;
  layout: string;
  /** 翻译出的 doc（成功时；translate error 时也返回，便于诊断） */
  doc?: DesignDocument;
  /** translate 的 issues（note + error） */
  issues: IntentIssue[];
  /** ok=false 时的原因（没写盘） */
  error?: string;
}

/** 版式名只允许一层目录名，禁止路径穿越 */
function safeLayout(layout: string): boolean {
  return (
    layout.length > 0 &&
    layout !== '.' &&
    layout !== '..' &&
    !layout.includes('..') &&
    !/[\\/]/.test(layout)
  );
}

/**
 * 决定写哪个版式：
 * - 当前有 activeLayout → **永远用当前版式**（AI 传的 layout 忽略，防写错）；
 * - 当前没有 → 用 AI 传的可选 layout **新建**；
 * - 两者都没有/名字非法 → null（工具报错）。
 */
export function resolveSketchLayout(
  activeLayout: string | undefined,
  requested: string | undefined,
): { layout: string; created: boolean } | null {
  const active = activeLayout?.trim() ?? '';
  if (active) return safeLayout(active) ? { layout: active, created: false } : null;

  const requestedName = requested?.trim() ?? '';
  if (!requestedName || !safeLayout(requestedName)) return null;
  return { layout: requestedName, created: true };
}

/**
 * 纯函数：plan → doc + 写 `designs/<layout>/doc.json`。
 * 不读 session、不碰网络；测试直接传临时 workDir。
 */
export function writeSketchPlan(workDir: string, layout: string, plan: SketchPlan): WriteSketchResult {
  const issues: IntentIssue[] = [];

  if (!safeLayout(layout)) {
    return { ok: false, layout, issues, error: `非法版式名：${layout || '（空）'}` };
  }
  if (!plan || typeof plan !== 'object' || !plan.canvas || !Array.isArray(plan.layers)) {
    return { ok: false, layout, issues, error: 'plan 结构不完整：需要 canvas 和 layers' };
  }

  let doc: DesignDocument;
  try {
    const result = translate(planToIntent(plan));
    issues.push(...result.issues);
    doc = result.doc;
  } catch (e) {
    return {
      ok: false,
      layout,
      issues,
      error: `plan 无法翻译：${e instanceof Error ? e.message : String(e)}`,
    };
  }

  if (issues.some((i) => i.level === 'error')) {
    return {
      ok: false,
      layout,
      issues,
      doc,
      error: `translate 有 ${issues.filter((i) => i.level === 'error').length} 条 error，未写盘`,
    };
  }

  const dir = join(workDir, 'designs', layout);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'doc.json'), JSON.stringify(doc, null, 2), 'utf8');
  } catch (e) {
    return {
      ok: false,
      layout,
      issues,
      doc,
      error: `写 doc.json 失败：${e instanceof Error ? e.message : String(e)}`,
    };
  }

  return { ok: true, layout, doc, issues };
}

/**
 * 主 AI 的草图工具。
 *
 * `activeLayout` 由 `chat-session` 从 `/chat` 的 `activeLayout` 注入
 * （见 `AgentToolContext.activeLayout`），模型只给 `plan`。
 */
export function createSketchTool(config: { sessionId: string }): AgentTool {
  return {
    name: 'sketch_plan',
    description:
      '把草图 plan 写成当前版式的 doc.json（草稿）。只决定结构/位置/占位图；' +
      '颜色与素材由后续阶段 patch，不要在这里写 px 样式。' +
      '当前已打开版式时不需要传 layout；当前没有打开版式时，传 layout（如 product-site）新建一个。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['plan'],
      properties: {
        plan: sketchPlanJsonSchema,
        layout: {
          type: 'string',
          description: '可选：当前没有打开版式时用它新建（如 product-site）；已打开版式时忽略',
        },
      },
    },
    async execute(args, ctx) {
      const hadActive = Boolean(ctx.activeLayout?.trim());
      const resolved = resolveSketchLayout(
        ctx.activeLayout,
        typeof args.layout === 'string' ? args.layout : undefined,
      );
      if (!resolved) {
        return {
          content:
            'ERROR: 当前没有打开的版式；请传 layout（如 product-site）新建，或先在左侧打开一个版式。',
          isError: true,
        };
      }
      const { layout, created } = resolved;
      const rawPlan = args.plan ?? (args.canvas && Array.isArray(args.layers) ? args : undefined);
      const plan = rawPlan as SketchPlan | undefined;
      if (!plan) {
        return { content: 'ERROR: 缺少 plan（参数应为 { plan: { canvas, layers } }）。', isError: true };
      }

      const workDir = await getWorkDir(config.sessionId);
      const r = writeSketchPlan(workDir, layout, plan);
      if (!r.ok) {
        return {
          content: JSON.stringify({ ok: false, layout, error: r.error, issues: r.issues }),
          isError: true,
        };
      }

      const doc = r.doc!;
      if (created) {
        // 新建布局才需要“打开”：从无 active 新建 → 打开；已有 active 新建系列里的另一张 → 只刷画廊。
        ctx.onEvent?.({ kind: 'artifacts', layout, created, open: !hadActive });
      } else {
        // 已有版式更新 → 就地 doc-patch（不重挂编辑器、不刷新预览）。
        ctx.onEvent?.({ kind: 'doc-patch', layout, doc });
      }
      return {
        content: JSON.stringify({
          ok: true,
          layout,
          created,
          canvas: doc.canvas,
          layers: doc.layers.map((l) => ({
            id: l.id,
            name: l.name ?? null,
            elements: l.elements.length,
          })),
          issues: r.issues,
        }),
      };
    },
  };
}
