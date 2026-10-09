/**
 * read_spec / edit_spec —— 主 AI 的版式**局部编辑**工具（本地零成本）。
 *
 * 解决「聊天里改一个字段也要 spawn 子 agent 整份重写」的断链：
 * - save_spec（子 agent）语义 = 整份覆写，适合从零产出与结构级重做
 * - edit_spec（主 AI）语义 = 按图层 id 的**最小 patch**：set / add / remove
 *   三操作，保存即自动校验；校验不过**不落盘**——编辑永远不会把好 spec 改坏
 * - 小修改不再经 brief 自然语言转述（子 agent 上下文零继承，转述有损），
 *   主 AI 直接动手，一次工具调用完事
 *
 * 边界（SoC）：本工具只动 design-sketch.json（布局契约）。颜色/字体是
 * design-appearance.json 的事——改颜色走 compile_appearance 重编；remove
 * 掉的图层若在 appearance 有配色分配，只警告不代删（重编即清理）。
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkAppearanceRefs, checkSketch, type CheckResult } from '../../workflow/design-sketch/validate';
import type { AgentTool } from '../subagent/types';
import { resolveDesignDir } from './project-paths';

/** 版式名 = 目录名，与 validate.ts 对 spec.name 的规则一致（防路径注入） */
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

type Rec = Record<string, unknown>;

/** 给模型的图层索引行：id (类型) "文字前 12 字" —— 改错了能立刻找对 id */
function layerIndex(spec: Rec): string {
  const layers = (spec.layers ?? []) as Rec[];
  if (!layers.length) return '（当前没有任何图层）';
  return layers
    .map((l) => {
      const text = typeof l.text === 'string' ? ` "${l.text.slice(0, 12)}${l.text.length > 12 ? '…' : ''}"` : '';
      return `- ${String(l.id)} (${String(l.type)})${text}`;
    })
    .join('\n');
}

function fmtCheck(check: CheckResult): string {
  return check.issues.map((i) => `[${i.level}] ${i.path}: ${i.message}`).join('\n');
}

/** 读项目下 designs/<name>/design-sketch.json（项目层读回退见 project-paths）；返回解析后的对象或错误消息 */
async function loadSpec(
  sessionId: string,
  name: unknown,
): Promise<{ ok: true; dir: string; spec: Rec } | { ok: false; error: string }> {
  if (typeof name !== 'string' || !NAME_RE.test(name)) {
    return { ok: false, error: `版式名 ${JSON.stringify(name)} 非法。只能用英文、数字、点、下划线、连字符（如 "PT10"）。` };
  }
  const r = await resolveDesignDir(sessionId, name);
  const specPath = resolve(r.dir, 'design-sketch.json');
  if (!existsSync(specPath)) {
    // 可行动报错：列出同项目下已有的版式名——主 AI 忘记版式全名时能立刻自我纠正
    // （真实案例：连错 4 次裸名后误判「产物丢失」擅自重跑，双份版式就是这么来的）
    const designsDir = resolve(r.dir, '..');
    const existing = existsSync(designsDir)
      ? readdirSync(designsDir, { withFileTypes: true })
          .filter((d) => d.isDirectory() && existsSync(resolve(designsDir, d.name, 'design-sketch.json')))
          .map((d) => d.name)
      : [];
    const hint = existing.length ? `该项目下已有版式：${existing.join('、')}。` : '';
    return {
      ok: false,
      error: `${name}/design-sketch.json 不存在（在 ${r.dir} 下找的）。${hint}` +
        '还没有这个版式的话，先用 spawn_design_agents 出草案。',
    };
  }
  try {
    const spec = JSON.parse(readFileSync(specPath, 'utf8')) as Rec;
    if (typeof spec !== 'object' || spec === null || !Array.isArray(spec.layers)) {
      return { ok: false, error: `${name}/design-sketch.json 结构不对（缺 layers 数组）。用 spawn 重新出这份版式。` };
    }
    return { ok: true, dir: r.dir, spec };
  } catch (e) {
    return { ok: false, error: `spec 不是合法 JSON（${(e as Error).message}）。用 spawn 修复或重出。` };
  }
}

// ── read_spec ──

export function createReadSpecTool(config: { sessionId: string }): AgentTool {
  return {
    name: 'read_spec',
    description:
      '读 designs/<版式名>/ 的当前 design-sketch.json（图层 id/类型/文字/位置全在里面）。' +
      '改版式前先读它拿图层 id；纯本地零成本。颜色/字体不在这份文件里（appearance 另算）。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '版式名（designs/ 下的目录名），如 "PT10"' },
      },
      required: ['name'],
    },
    async execute(args) {
      const r = await loadSpec(config.sessionId, args.name);
      if (!r.ok) return { content: `ERROR: ${r.error}`, isError: true };

      const appearancePath = resolve(r.dir, 'design-appearance.json');
      const appearanceNote = existsSync(appearancePath)
        ? `存在（配色已编译；改颜色走 compile_appearance 重编，不归 edit_spec 管）`
        : '不存在（尚无专属配色）';
      return {
        content: JSON.stringify({ name: args.name, spec: r.spec, appearance: appearanceNote }),
      };
    },
  };
}

// ── edit_spec ──

interface OpSet { op: 'set'; id: string; fields: Rec }
interface OpAdd { op: 'add'; layer: Rec }
interface OpRemove { op: 'remove'; id: string }
type Op = OpSet | OpAdd | OpRemove;

/** 解析 + 形状校验单个 op；错误返回可行动消息 */
function parseOp(raw: unknown): { ok: true; op: Op } | { ok: false; error: string } {
  const o = raw as Rec;
  if (typeof o !== 'object' || o === null) return { ok: false, error: `op 必须是对象：${JSON.stringify(raw)?.slice(0, 80)}` };
  if (o.op === 'set') {
    if (typeof o.id !== 'string' || !o.id) return { ok: false, error: 'set 需要 id（要改哪个图层）' };
    if (typeof o.fields !== 'object' || o.fields === null || Array.isArray(o.fields)) {
      return { ok: false, error: 'set 需要 fields（要改的字段对象）' };
    }
    if ('id' in (o.fields as Rec)) return { ok: false, error: 'fields 里不能改 id（改 id 等于换图层引用，会弄丢配色分配）' };
    return { ok: true, op: { op: 'set', id: o.id as string, fields: o.fields as Rec } };
  }
  if (o.op === 'add') {
    const l = o.layer as Rec | undefined;
    if (typeof l !== 'object' || l === null || Array.isArray(l)) return { ok: false, error: 'add 需要 layer（完整的图层对象）' };
    if (typeof l.id !== 'string' || !l.id) return { ok: false, error: 'add 的 layer 必须带 id（新增图层的唯一标识）' };
    return { ok: true, op: { op: 'add', layer: l } };
  }
  if (o.op === 'remove') {
    if (typeof o.id !== 'string' || !o.id) return { ok: false, error: 'remove 需要 id（要删哪个图层）' };
    return { ok: true, op: { op: 'remove', id: o.id } };
  }
  return { ok: false, error: `op 只能是 set / add / remove，收到 ${JSON.stringify(o.op)}` };
}

export function createEditSpecTool(config: { sessionId: string }): AgentTool {
  return {
    name: 'edit_spec',
    description:
      '按**图层 id 局部修改** designs/<版式名>/ 的 design-sketch.json——不整份重写、不委派。' +
      '三操作：set（改某图层字段；rect 可只给要改的维，如 {"rect":{"x":0.1}}）、' +
      'add（加图层，layer 必须带 id）、remove（删图层）。' +
      '多个 op 顺序执行，全部成功才保存；保存前自动校验，不过就原样退回并列出错误。' +
      '不知道图层 id 就先 read_spec。改完用 render_design 重渲看效果（零 API）。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '版式名（designs/ 下的目录名）' },
        ops: {
          type: 'array',
          description: '修改操作列表（按顺序执行，原子生效——任一失败整批不落盘）',
          items: {
            type: 'object',
            properties: {
              op: { type: 'string', description: '"set" | "add" | "remove"' },
              id: { type: 'string', description: 'set/remove：目标图层 id' },
              fields: { type: 'object', description: 'set：要合并进去的字段（rect 浅合并，其余覆盖）' },
              layer: { type: 'object', description: 'add：完整图层对象（含 id）' },
            },
            required: ['op'],
          },
        },
      },
      required: ['name', 'ops'],
    },
    async execute(args) {
      const r = await loadSpec(config.sessionId, args.name);
      if (!r.ok) return { content: `ERROR: ${r.error}`, isError: true };
      const { dir, spec } = r;
      const layers = spec.layers as Rec[];

      if (!Array.isArray(args.ops) || args.ops.length === 0) {
        return { content: 'ERROR: ops 必须是非空数组。当前图层：\n' + layerIndex(spec), isError: true };
      }

      // 1) 解析全部 op（形状错了整批拒绝，不动磁盘）
      const ops: Op[] = [];
      for (const raw of args.ops as unknown[]) {
        const p = parseOp(raw);
        if (!p.ok) return { content: `ERROR: ${p.error}\n当前图层：\n` + layerIndex(spec), isError: true };
        ops.push(p.op);
      }

      // 2) 按序应用到内存副本（任一失败 → 整批拒绝 + 图层索引回喂）
      const changed: string[] = [];
      const findLayer = (id: string) => layers.find((l) => l.id === id);
      for (const op of ops) {
        if (op.op === 'set') {
          const l = findLayer(op.id);
          if (!l) {
            return {
              content: `ERROR: 图层 "${op.id}" 不存在，未做任何修改。当前图层：\n` + layerIndex(spec),
              isError: true,
            };
          }
          for (const [k, v] of Object.entries(op.fields)) {
            if (k === 'rect' && typeof v === 'object' && v !== null) {
              l.rect = { ...(l.rect as Rec), ...(v as Rec) }; // rect 浅合并——与前端 mergePatch 同语义
            } else {
              l[k] = v;
            }
          }
          changed.push(`set ${op.id}：${Object.keys(op.fields).join(', ')}`);
        } else if (op.op === 'add') {
          if (findLayer(op.layer.id as string)) {
            return {
              content: `ERROR: 图层 id "${String(op.layer.id)}" 已存在，未做任何修改（add 要用新 id）。当前图层：\n` + layerIndex(spec),
              isError: true,
            };
          }
          layers.push(op.layer);
          changed.push(`add ${String(op.layer.id)} (${String(op.layer.type ?? '?')})`);
        } else {
          const i = layers.findIndex((l) => l.id === op.id);
          if (i < 0) {
            return {
              content: `ERROR: 图层 "${op.id}" 不存在，未做任何修改。当前图层：\n` + layerIndex(spec),
              isError: true,
            };
          }
          layers.splice(i, 1);
          changed.push(`remove ${op.id}`);
        }
      }

      // 3) 校验合并结果——不过则**不落盘**（编辑永远不会把好 spec 改坏）
      const check = checkSketch(spec);
      if (!check.ok) {
        return {
          content: 'ERROR: 修改后校验不通过，**已原样退回（磁盘未动）**。修正后重试：\n' + fmtCheck(check),
          isError: true,
        };
      }

      // 4) 原子生效
      writeFileSync(resolve(dir, 'design-sketch.json'), JSON.stringify(spec, null, 2) + '\n', 'utf8');

      // 5) appearance 引用复查（统一真源 validate.ts 的 checkAppearanceRefs）：
      //    remove 掉的图层若在 appearance 有配色分配，这里以失配 warn 冒出来；
      //    spec 里既有的失配同样暴露。只警告不代删——appearance 归 compile_appearance 管（SoC）
      let appearanceWarns: string[] = [];
      const appearancePath = resolve(dir, 'design-appearance.json');
      if (existsSync(appearancePath)) {
        try {
          appearanceWarns = checkAppearanceRefs(
            spec as unknown as Parameters<typeof checkAppearanceRefs>[0],
            JSON.parse(readFileSync(appearancePath, 'utf8')),
          ).map((i) => `${i.path}: ${i.message}`);
        } catch {
          /* appearance 坏 JSON 不是本次编辑的职责，不拦 */
        }
      }

      const warns = check.issues.filter((i) => i.level === 'warn');
      return {
        content: JSON.stringify({
          ok: true,
          changed,
          layers: layers.length,
          appearanceWarnings: appearanceWarns.length ? appearanceWarns : undefined,
          validateWarns: warns.length ? warns.map((i) => `${i.path}: ${i.message}`) : undefined,
          next: '改完了——render_design 重渲即可看到效果（零 API）',
        }),
      };
    },
  };
}
