/**
 * `sketch_plan` 工具 —— 把 AI 的草图 plan 写成**一个新版式**的草稿 doc.json。
 *
 * 分层：
 *   AI 只出 plan JSON（`sketchPlanJsonSchema`）；
 *   版式名由 **AI 必填**（`layout`）——本工具**只新建**，不写 current active。
 *
 * 产物：
 *   `<workDir>/designs/<layout>/doc.json` —— 合法但带默认样式/占位图的**草稿**。
 *   颜色 / 素材 / 位置后续用 `patch_doc` 改；plan 不落盘。
 *
 * 失败：
 *   - 没传 layout、版式名非法、版式已存在、plan 结构不完整、translate 有 error
 *     → 返回错误，**不写盘**；
 *   - translate 的 note 级 issue 正常返回给 AI，让它知道哪里可能有问题。
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
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
 * 解析要新建的版式名：
 * - AI **必须**传一个合法名字；本工具不再从 activeLayout 兜底（那是"改现有"的语义）；
 * - 名字非法 / 为空 → null（工具报错）。
 */
export function resolveSketchLayout(
  requested: string | undefined,
): { layout: string; created: true } | null {
  const name = requested?.trim() ?? '';
  if (!name || !safeLayout(name)) return null;
  return { layout: name, created: true };
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

  const docPath = join(workDir, 'designs', layout, 'doc.json');
  if (existsSync(docPath)) {
    return {
      ok: false,
      layout,
      issues,
      error: `版式已存在：${layout}。换一个新名字新建，或用 patch_doc / edit_structure 改现有版式。`,
    };
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
    writeFileSync(docPath, JSON.stringify(doc, null, 2), 'utf8');
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
 * 主 AI 的草图工具 —— **只新建版式**。
 *
 * `layout` 必填（新名字）；已存在 → 报错，不写盘。
 * 改现有版式字段走 `patch_doc`；增删元素/图层走 `edit_structure`，不再用 sketch_plan 整份重写。
 */
export function createSketchTool(config: { sessionId: string }): AgentTool {
  return {
    name: 'sketch_plan',
    description:
      '**只新建**版式的 doc.json（草稿），不修改已有版式、不写当前 active。' +
      '必须传 layout（新名字，如 coffee-brand-poster）；名字已存在会报错——' +
      '改现有版式的字段请用 patch_doc，增删元素/图层用 edit_structure，不要重跑本工具。' +
      'plan 只决定结构/位置/占位图，不要写 px 样式；元素可选 clip / mask，shape 支持 polygon(points)。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['plan', 'layout'],
      properties: {
        plan: sketchPlanJsonSchema,
        layout: {
          type: 'string',
          description: '必填：新建的版式名（如 coffee-brand-poster-02）；已存在会报错',
        },
      },
    },
    async execute(args, ctx) {
      const hadActive = Boolean(ctx.activeLayout?.trim());
      const resolved = resolveSketchLayout(
        typeof args.layout === 'string' ? args.layout : undefined,
      );
      if (!resolved) {
        return {
          content:
            'ERROR: 必须传 layout（一个新的版式名，如 coffee-brand-poster-02）。' +
            '本工具只新建；改字段用 patch_doc，增删结构用 edit_structure。',
          isError: true,
        };
      }
      const { layout } = resolved;
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
      // 只新建：没有 active 时打开；已有 active 时只刷画廊，不抢当前预览。
      ctx.onEvent?.({ kind: 'artifacts', layout, created: true, open: !hadActive });
      return {
        content: JSON.stringify({
          ok: true,
          layout,
          created: true,
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
