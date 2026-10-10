/**
 * render_design 工具 —— 主 AI 把已保存的版式渲染成**成品图**。
 *
 * 与子 agent 工具集（tools/design-sketch.ts）的分工：
 * - render_sketch 渲**草图**（灰条占位框，结构确认用）——子 agent 的循环工具
 * - render_design 渲**成品**（真实素材 + 文字自适应 + 自包含 HTML）——主 AI 的交付工具
 *
 * 权限边界（与既有自动化边界咬合）：渲染是本地确定性操作，零模型调用，
 * 不需要人确认。但**素材缺失会直接失败并返回缺失清单**——生图（gen）是
 * 花钱动作，不在这工具里做（第 2 步再接，且必须有人确认闸门）。
 *
 * 目录语义：版式在会话工作目录的 designs/<name>/ 下（spawn 子 agent 的
 * 产物落点）。与既有的 test_product/layout/<name>/ 布局同构——
 * 一个版式目录 = design-sketch.json + (design-appearance.json) + (assets.json) + 素材。
 */

import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { checkAppearance, checkAppearanceRefs, checkSketch } from '../../workflow/design-sketch/validate';
import { loadAppearance, loadPalette, loadTypography, getSharedRenderer } from '../../workflow/design-sketch/runtime';
import { applyAppearance, type DesignAppearance } from '../../workflow/design-sketch/design-appearance';
import { assembleFinal } from '../../workflow/compose/assemble';
import type { AssetOrders } from '../../workflow/assetsgen/asset-order';
import type { AgentTool } from '../subagent/types';
import { resolveDesignDir } from './project-paths';

/** 版式名 = 目录名，与 validate.ts 对 spec.name 的规则一致（防路径注入） */
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function createRenderDesignTool(config: { sessionId: string }): AgentTool {
  return {
    name: 'render_design',
    description:
      '把已保存的版式渲染成**成品图**（final.png）。' +
      '真实素材、文字自适应排版；纯本地渲染（零模型调用），约 5–10 秒。' +
      '版式必须在会话工作目录的 designs/<name>/design-sketch.json（spawn 产出的就在那）。' +
      '素材缺失时会失败并列出缺哪些文件——此时告诉用户需要先生成素材，不要自己重试。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '版式名（designs/ 下的目录名），如 "PT10"' },
      },
      required: ['name'],
    },
    async execute(args, ctx) {
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

      // 渲染守卫：非法 spec 不进渲染器（fail-loud，错误可行动）
      let specRaw: unknown;
      try {
        specRaw = JSON.parse(readFileSync(specPath, 'utf8'));
      } catch (e) {
        return { content: `ERROR: spec 不是合法 JSON（${(e as Error).message}）。`, isError: true };
      }
      const check = checkSketch(specRaw);
      if (!check.ok) {
        return {
          content: 'ERROR: 校验不通过，拒绝渲染。先让子 agent 修复 spec：\n' +
            check.issues.map((i) => `[${i.level}] ${i.path}: ${i.message}`).join('\n'),
          isError: true,
        };
      }
      const spec = specRaw as Parameters<typeof assembleFinal>[0]['spec'];

      // ── 外观预检（渲染前最后一道关）──
      // 三种失配此前全是静默的：坏 JSON 裸抛异常、palette/fontScheme 编造名字
      // 只 console.warn 然后悄悄走兜底（观感跑偏没人知道）、图层 id 失配时
      // applyAppearance 直接跳过该层配色。这里全部变成可行动的错误/警告。
      let appearance: DesignAppearance;
      try {
        appearance = loadAppearance(specPath);
      } catch (e) {
        return {
          content: `ERROR: design-appearance.json 不是合法 JSON（${(e as Error).message}）。` +
            '修好它，或删掉这个文件（没有外观就走渲染器兜底）。',
          isError: true,
        };
      }
      const apCheck = checkAppearance(appearance);
      if (!apCheck.ok) {
        return {
          content: 'ERROR: design-appearance.json 校验不通过，拒绝渲染（否则配色会悄悄走兜底）。' +
            '让 compile_appearance 重编，或手改对应字段：\n' +
            apCheck.issues.map((i) => `[${i.level}] ${i.path}: ${i.message}`).join('\n'),
          isError: true,
        };
      }
      const refWarns = checkAppearanceRefs(spec, appearance);

      const palette = loadPalette(appearance.palette ?? 'warm-copper');
      const typography = loadTypography(appearance.fontScheme ?? 'legacy-system');

      // ⚠️ 外观合并不能漏：palette/typography 只是「表」，appearance.layers 里的
      // 逐图层颜色分配（title.color / accent 染色词 / shape.fill…）必须先合进
      // 图层树再渲染——设计链路一直是这么做的，本工具此前漏了
      // 这步，图层分配被静默丢弃、文字全走 palette.ink 兜底（实测 demo-with-image
      // 标题显示为 ink 深蓝而非设计的 cream + accent，才暴露）。顺序同设计链路：
      // 先合并外观、再交给渲染器（渲染器内部才展开 repeat）。
      const painted = {
        ...spec,
        layers: applyAppearance(spec.layers, appearance) as typeof spec.layers,
      };

      // 素材订单：溯源注释用；没有 assets.json = 无生成素材（纯版式/手放素材），合法
      const ordersPath = resolve(dir, 'assets.json');
      const orders: AssetOrders = existsSync(ordersPath)
        ? (JSON.parse(readFileSync(ordersPath, 'utf8')) as AssetOrders)
        : [];

      // 共享渲染器：文字自适应测量（host.newPage）与成品渲染共用一个浏览器实例
      const renderer = await getSharedRenderer();
      let result;
      try {
        // 素材回退根：贴图落 <工作目录>/uploads/，spec 常以 uploads/chat-x.jpg
        // （相对工作目录）被引用——版式目录找不到就去工作目录找。
        const fallbackRoots = [workDir];
        result = await assembleFinal({
          spec: painted,
          orders,
          outDir: dir,
          searchRoots: fallbackRoots,
          palette,
          typography,
          host: renderer,
          renderer,
        });
      } catch (e) {
        // 典型失败：素材缺失（assembleFinal 抛可行动清单）——原样回喂，
        // 主 AI 据此告诉用户需要先生成素材（gen 是花钱步骤，不在这里自动做）
        return { content: `ERROR: ${(e as Error).message}`, isError: true };
      }

      const rel = (p: string) => relative(resolve(workDir), p);
      // 产物事件：gallery 里多了一张成品图——前端据此实时刷新（不等本轮对话结束）
      ctx.onEvent?.({ kind: 'artifacts', source: 'render_design', name });
      return {
        content: JSON.stringify({
          png: rel(result.png),
          // id 失配不阻塞渲染（其余层照常上色），但警告必须跟着产物走——
          // 主 AI 看到就该告诉用户，或让 compile_appearance 重编清理
          appearanceWarnings: refWarns.length
            ? refWarns.map((i) => `${i.path}: ${i.message}`)
            : undefined,
        }),
      };
    },
  };
}
