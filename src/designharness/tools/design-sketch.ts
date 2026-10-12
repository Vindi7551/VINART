/**
 * design-sketch 工具集 —— 把版式工作流的能力包成子 agent 可用的工具。
 *
 * 四个工具对应子 agent 的工作循环：
 *   save_spec（保存+即验）→ validate_sketch（复查）→ render_sketch（渲草图）→ read_file（看文件）
 *
 * 权限边界（与自动化边界咬合）：
 * - 保存/校验/渲染全是**本地确定性操作，零 API 成本**——模型随便用，
 *   不需要人确认（spec 变更自动校验渲染是既定自动化）
 * - VLM 看图验收、生图**不在工具表里**——烧钱动作留在主 AI / 用户手里
 *
 * 目录语义：ctx.dir 是子 agent 的工作目录；一个版式 = `<dir>/<name>/` 子目录
 * （design-sketch.json + design-appearance.json + sketch.png），
 * 与 test_product/layout/<name>/ 的既有落点约定一致——runner 调用方把
 * dir 指到 test_product/layout 即可无缝对接现有链。
 *
 * 错误信息全部**可行动**（继承 validate.ts 的写作标准）：说清哪个字段、
 * 错在哪、该改成什么——它们会被原样回喂当修改指令。
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { checkAppearance, checkAppearanceRefs, checkSketch, type CheckResult, type SketchIssue } from '../../document/validate';
import { renderSketchFile } from '../../render/runtime';
import type { AgentTool, AgentToolContext } from '../subagent/types';

// ── 共享 ──

/** 版式名 = 目录名，与 validate.ts 对 spec.name 的规则一致（防路径注入） */
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function layoutDir(ctx: AgentToolContext, name: unknown): string | null {
  if (typeof name !== 'string' || !NAME_RE.test(name)) return null;
  return resolve(ctx.dir, name);
}

function badName(name: unknown): string {
  return `ERROR: 版式名 ${JSON.stringify(name)} 非法。只能用英文、数字、点、下划线、连字符（如 "PT10"）。`;
}

function fmtCheck(check: CheckResult): string {
  return check.issues.map((i) => `[${i.level}] ${i.path}: ${i.message}`).join('\n');
}

/**
 * 报错时顺带说明「附近真实存在什么」。
 *
 * 动机（实测）：子 agent 的 read_file 有 9/19 次是"文件不存在"——它在**猜路径**
 * （assets.json、uploads/*.png、PT10/design-appearance.json…）。原来的报错只有
 * 一句"不存在"，模型只能继续猜、继续烧轮次。这里把真实目录内容回给它。
 */
function listDir(abs: string): string {
  const fmt = (d: string): string => {
    try {
      const items = readdirSync(d, { withFileTypes: true }).map((e) =>
        e.isDirectory() ? `${e.name}/` : e.name,
      );
      if (!items.length) return `（${basename(d)}/ 是空的）`;
      return `（${basename(d)}/ 下现有：${items.slice(0, 20).join(' / ')}${items.length > 20 ? ' …' : ''}）`;
    } catch {
      return '';
    }
  };
  const dir = dirname(abs);
  if (existsSync(dir)) return fmt(dir);
  const up = dirname(dir);
  return existsSync(up) ? ` ${basename(dir)}/ 这一层不存在。${fmt(up)}` : '';
}

/** 读工作目录内的文本文件，带防逃逸守卫。返回内容或错误消息 */
function readTextInDir(ctx: AgentToolContext, relPath: string): { ok: true; text: string } | { ok: false; error: string } {
  const abs = resolve(ctx.dir, relPath);
  const rel = relative(resolve(ctx.dir), abs);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    return { ok: false, error: `路径越出了工作目录：${relPath}。只能访问工作目录内的文件。` };
  }
  if (!existsSync(abs)) {
    return { ok: false, error: `文件不存在：${relPath}。${listDir(abs)}` };
  }
  if (statSync(abs).size > 200 * 1024) {
    return { ok: false, error: `文件超过 200KB：${relPath}。工具只读文本片段，这么大的文件请用别的方式确认。` };
  }
  return { ok: true, text: readFileSync(abs, 'utf8') };
}

// ── save_spec ──

/**
 * 保存 + 立即校验。这是「spec 运行时校验缺失」的正面解决：
 * LLM 写坏的结构在保存的瞬间就被拦下并回喂可行动错误，而不是等渲染出怪东西。
 * 坏 spec 也落盘（工作产物，修正轮覆盖；人可事后查看模型写了什么）。
 */
const saveSpec: AgentTool = {
  name: 'save_spec',
  description:
    '保存一份版式规格 design-sketch.json 到工作目录下 <name>/ 子目录，并**立即做静态校验**。' +
    '返回 valid=true（附 warn 提示）或 valid=false（附 issues，每条都是可行动的修改指令，必须全部修复后重新保存）。' +
    'spec 是对象本身，不是 JSON 字符串。',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: '版式名（目录名），如 "PT10"。必须与 spec.name 一致' },
      spec: {
        type: 'object',
        description:
          'design-sketch.json 的完整内容。结构：{ name, title?, description?, canvas:{width,height}, layers:[…] }；' +
          'layers 数组顺序即叠放顺序（先写的在下面）；位置尺寸一律 rect:{x,y,w,h}（0–1 画布比例）。',
      },
    },
    required: ['name', 'spec'],
  },
  async execute(args, ctx) {
    const dir = layoutDir(ctx, args.name);
    if (!dir) return { content: badName(args.name), isError: true };

    const spec = args.spec;
    if (typeof spec !== 'object' || spec === null || Array.isArray(spec)) {
      return { content: 'ERROR: spec 必须是一个 JSON 对象（design-sketch.json 的完整内容）。', isError: true };
    }
    // 目录名与 spec.name 必须一致——renderSketchFile 与产物约定都以 spec.name 为真源
    if ((spec as { name?: unknown }).name !== args.name) {
      return {
        content: `ERROR: spec.name = ${JSON.stringify((spec as { name?: unknown }).name)} 与参数 name = ${JSON.stringify(args.name)} 不一致。两者必须相同（目录名 = 版式名）。`,
        isError: true,
      };
    }

    const check = checkSketch(spec);
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, 'design-sketch.json'), JSON.stringify(spec, null, 2) + '\n', 'utf8');

    if (!check.ok) {
      return {
        content: `已保存但校验**不通过**（${check.issues.filter((i) => i.level === 'error').length} 个错误）。逐条修复后重新 save_spec：\n${fmtCheck(check)}`,
        isError: true,
      };
    }
    const warns = check.issues.filter((i) => i.level === 'warn');
    // appearance 引用复查：spec 覆写是「配色静默失效」的主要制造者
    // （图层改名/删除后 appearance 里的旧 id 匹配不上）。保存照常，
    // 但失配必须随返回冒出来——不静默。
    const refWarns: SketchIssue[] = [];
    const appearancePath = resolve(dir, 'design-appearance.json');
    if (existsSync(appearancePath)) {
      try {
        refWarns.push(
          ...checkAppearanceRefs(spec as Parameters<typeof checkAppearanceRefs>[0], JSON.parse(readFileSync(appearancePath, 'utf8'))),
        );
      } catch {
        /* appearance 坏 JSON：validate_sketch / render_design 会报，保存不拦 */
      }
    }
    const allWarns = [...warns, ...refWarns];
    return {
      content: allWarns.length
        ? `已保存并通过校验。有 ${allWarns.length} 条 warn 提示（不阻塞，但建议看一眼）：\n${fmtCheck({ ok: true, issues: allWarns })}`
        : `已保存并通过校验，无任何问题。路径：${args.name}/design-sketch.json`,
    };
  },
};

// ── validate_sketch ──

const validateSketch: AgentTool = {
  name: 'validate_sketch',
  description:
    '对已保存的版式跑静态校验：design-sketch.json 必查，同目录 design-appearance.json（若存在）也查。' +
    '渲染前不需要手动调它（render_sketch 会先校验），用于保存后想单独复查的场景。',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: '版式名（目录名）' },
    },
    required: ['name'],
  },
  async execute(args, ctx) {
    const dir = layoutDir(ctx, args.name);
    if (!dir) return { content: badName(args.name), isError: true };
    const specPath = resolve(dir, 'design-sketch.json');
    if (!existsSync(specPath)) {
      return { content: `ERROR: ${args.name}/design-sketch.json 不存在。先用 save_spec 保存。`, isError: true };
    }

    let specRaw: unknown;
    try {
      specRaw = JSON.parse(readFileSync(specPath, 'utf8'));
    } catch (e) {
      return { content: `ERROR: spec 文件不是合法 JSON（${(e as Error).message}）。重新 save_spec 覆盖它。`, isError: true };
    }
    const check = checkSketch(specRaw);
    const issues = [...check.issues];

    const appearancePath = resolve(dir, 'design-appearance.json');
    if (existsSync(appearancePath)) {
      let apRaw: unknown;
      try {
        apRaw = JSON.parse(readFileSync(appearancePath, 'utf8'));
      } catch (e) {
        return { content: `ERROR: design-appearance.json 不是合法 JSON（${(e as Error).message}）。修好它或删掉这个文件（没有外观就走渲染器兜底）。`, isError: true };
      }
      const ac = checkAppearance(apRaw);
      issues.push(...ac.issues);
      // 跨文件引用：appearance 里的 id 必须在 spec 里存在（失配 = 配色静默失效）
      if (check.ok) issues.push(...checkAppearanceRefs(check.spec!, apRaw as Parameters<typeof checkAppearanceRefs>[1]));
    }
    const hasError = issues.some((i) => i.level === 'error');
    if (hasError) {
      return { content: `校验不通过。逐条修复：\n${issues.map((i) => `[${i.level}] ${i.path}: ${i.message}`).join('\n')}`, isError: true };
    }
    const warns = issues.filter((i) => i.level === 'warn');
    return {
      content: warns.length
        ? `校验通过，有 ${warns.length} 条 warn 提示：\n${issues.map((i) => `[${i.level}] ${i.path}: ${i.message}`).join('\n')}`
        : '校验通过，无任何问题。',
    };
  },
};

// ── render_sketch ──

const renderSketch: AgentTool = {
  name: 'render_sketch',
  description:
    '把已保存的版式渲染成**草图 PNG**（灰条区域框 + 区域标签，确定性渲染，零 API 成本，约 3 秒）。' +
    '渲染前自动校验，校验不通过会拒绝并列出错误。返回 png 的相对路径（相对工作目录）。' +
    '⚠️ read_file 只能读文本，**看不了这张 PNG** —— 需要视觉判断时把它报给上层（主 AI / 用户），' +
    '不要靠反复读文件来"确认"渲染结果；结构问题以 validate_sketch 的提示为准。',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: '版式名（目录名）' },
    },
    required: ['name'],
  },
  async execute(args, ctx) {
    const dir = layoutDir(ctx, args.name);
    if (!dir) return { content: badName(args.name), isError: true };
    const specPath = resolve(dir, 'design-sketch.json');
    if (!existsSync(specPath)) {
      return { content: `ERROR: ${args.name}/design-sketch.json 不存在。先用 save_spec 保存。`, isError: true };
    }

    // 渲染守卫：非法 spec 不进渲染器（fail-loud，错误可行动）
    const check = checkSketch(JSON.parse(readFileSync(specPath, 'utf8')));
    if (!check.ok) {
      return { content: `ERROR: 校验不通过，拒绝渲染。先修复再重试：\n${fmtCheck(check)}`, isError: true };
    }

    // 渲染约 3 秒（起 Blink）；不接 abort signal——中断在下一轮检查点生效（已知局限，延迟可接受）
    const r = await renderSketchFile(specPath, dir);
    if (!r.ok) {
      return { content: `ERROR: 渲染失败：${r.error ?? '未知原因'}`, isError: true };
    }
    return {
      content: JSON.stringify({
        png: relative(resolve(ctx.dir), r.png),
      }),
    };
  },
};

// ── read_file ──

const readFileTool: AgentTool = {
  name: 'read_file',
  description:
    '读工作目录内的文本文件（JSON / HTML / 文本），路径相对工作目录。越界或二进制文件会被拒绝。',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '相对工作目录的路径，如 "PT10/design-sketch.json" 或 "assets.json"' },
    },
    required: ['path'],
  },
  async execute(args, ctx) {
    const p = args.path;
    if (typeof p !== 'string' || !p.trim()) {
      return { content: 'ERROR: path 必须是非空字符串（相对工作目录）。', isError: true };
    }
    const r = readTextInDir(ctx, p);
    return r.ok ? { content: r.text } : { content: `ERROR: ${r.error}`, isError: true };
  },
};

// ── 汇总 ──

export const DESIGN_SKETCH_TOOLS: AgentTool[] = [saveSpec, validateSketch, renderSketch, readFileTool];
