/**
 * compile_appearance 工具 —— 主 AI 为版式编译**专属配色**。
 *
 * 包装 workflow/appearance/compile.ts 的 compileAppearance：
 * 版式 spec + 创意方案 + 产品照（可选，看图取色）→ design-appearance.json
 * （内嵌 palette 角色表 + 逐图层颜色分配）。产出是数据——用户可手改 hex
 * 重渲 final（零 API），好用的配色再由人提升进 designassets/elements/palette/。
 *
 * 权限边界：调用的是 chat 模型（几轮、几分钱），与 spawn 同级，**不加确认闸门**；
 * 生图那种量级的钱闸在 generate_assets。衔接零改动：render_design 的
 * loadAppearance 会自动读取产物，重渲即生效。
 *
 * brief 溯源：聊天里 spawn 的 brief 只传字符串给子 agent、不落盘（易失）。
 * 本工具把主 AI 传来的 brief 落成 designs/<name>/brief.md——与 spec/appearance
 * 同目录，回看方案一个目录看全；重编配色（不改方案）时可省略 brief 参数复用。
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { checkSketch } from '../../workflow/design-sketch/validate';
import { compileAppearance } from '../../workflow/appearance/compile';
import type { DesignSketch } from '../../workflow/design-sketch/design-sketch';
import type { AgentTool } from '../subagent/types';
import { resolveDesignDir } from './project-paths';
import { getProject } from '../session/transcript';

/** 版式名 = 目录名，与 validate.ts 对 spec.name 的规则一致（防路径注入） */
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function createCompileAppearanceTool(config: { sessionId: string }): AgentTool {
  return {
    name: 'compile_appearance',
    description:
      '为版式编译**专属配色**：看产品照取色，产 design-appearance.json（palette 角色表 + ' +
      '逐图层颜色分配 + 字体方案）。草图确认后、首次渲染成品前用一次；渲染时自动采用。' +
      'brief 必须**自包含**（编译器看不到你们的对话：画面氛围、文案要点、想要的色彩方向）。' +
      '拿到结果把 palette 角色与色值展示给用户；用户不满意就改 brief（或只说色彩方向）重新编译' +
      '——产出是数据，重编只花几分钱，重渲零 API。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '版式名（designs/ 下的目录名），如 "PT10"' },
        brief: {
          type: 'string',
          description:
            '自包含创意方案：画面氛围、逐字文案要点、色彩方向。' +
            '想沿用上次方案只换配色方向时可省略（复用已落盘的 brief.md）',
        },
        productPath: {
          type: 'string',
          description: '产品照路径（相对工作目录，如 "uploads/chat-xxx.png"）。给了才会看图取色',
        },
      },
      required: ['name'],
    },
    async execute(args) {
      const name = args.name;
      if (typeof name !== 'string' || !NAME_RE.test(name)) {
        return {
          content: `ERROR: 版式名 ${JSON.stringify(name)} 非法。只能用英文、数字、点、下划线、连字符（如 "PT10"）。`,
          isError: true,
        };
      }

      const r = await resolveDesignDir(config.sessionId, name);
      const workDir = r.workDir;
      const dir = r.dir;
      const specPath = resolve(dir, 'design-sketch.json');
      if (!existsSync(specPath)) {
        return {
          content: `ERROR: ${name}/design-sketch.json 不存在（在 ${dir} 下找的）。` +
            '还没有这个版式的话，先用 spawn_design_agents 出草案。',
          isError: true,
        };
      }

      // spec 守卫：与 render_design 同款——非法 spec 不进编译器（图层清单是配色的对象，
      // spec 坏了配色必是垃圾）。fail-loud，错误回喂让主 AI 先修 spec
      let spec: DesignSketch;
      try {
        spec = JSON.parse(readFileSync(specPath, 'utf8')) as DesignSketch;
        const check = checkSketch(spec);
        if (!check.ok) {
          return {
            content: 'ERROR: spec 校验不通过，先让子 agent 修复 spec：\n' +
              check.issues.map((i) => `[${i.level}] ${i.path}: ${i.message}`).join('\n'),
            isError: true,
          };
        }
      } catch (e) {
        return { content: `ERROR: spec 读取失败（${(e as Error).message}）。`, isError: true };
      }

      // brief：参数传入 → 落盘 brief.md（溯源）；不传 → 复用已落盘的（重编配色场景）
      const briefPath = resolve(dir, 'brief.md');
      if (typeof args.brief === 'string' && args.brief.trim()) {
        writeFileSync(briefPath, args.brief.trim() + '\n', 'utf8');
      } else if (!existsSync(briefPath)) {
        return {
          content: 'ERROR: 缺 brief（自包含创意方案：画面氛围、文案要点、色彩方向）。' +
            '编译器看不到你们的对话，必须由你写全传入；仅当该版式编译过一次后才可省略。',
          isError: true,
        };
      }

      // 产品照 fail-loud：传了路径但文件不存在是主 AI 的错——静默跳过会得到
      // 假装「看图取色」的氛围配色（compileAppearance 对缺失路径是静默跳过的）
      let productAbs: string | null = null;
      if (typeof args.productPath === 'string' && args.productPath.trim()) {
        // 多根回退：先按工作目录相对解析，找不到再按「工作目录/<当前项目>/」相对
        // （贴图落项目 uploads/ 时，主 AI 常写 uploads/chat-x.jpg 这种相对 workDir 的路径）
        const project = await getProject(config.sessionId);
        const roots = [workDir, ...(project ? [resolve(workDir, project)] : [])];
        productAbs = roots.map((r) => resolve(r, args.productPath as string)).find((p) => existsSync(p)) ?? null;
        if (!productAbs) {
          return {
            content: `ERROR: productPath 不存在：${args.productPath}（试过 ${roots.join(' 与 ')}）`,
            isError: true,
          };
        }
      }

      let result;
      try {
        result = await compileAppearance({
          specPath,
          briefPath,
          productPath: productAbs,
        });
      } catch (e) {
        // 典型：多轮校验用尽（palette 角色引用不可解析等）——错误清单原样回喂
        return { content: `ERROR: 配色编译失败：\n${(e as Error).message}`, isError: true };
      }

      const rel = (p: string) => relative(resolve(workDir), p);
      return {
        content: JSON.stringify({
          outPath: rel(result.outPath),
          palette: result.appearance.palette,
          fontScheme: result.appearance.fontScheme,
          layers: Object.keys(result.appearance.layers ?? {}).length,
          rounds: result.rounds,
          next: '配色已就位——render_design 重渲即自动采用；把 palette 角色与色值展示给用户',
        }),
      };
    },
  };
}
