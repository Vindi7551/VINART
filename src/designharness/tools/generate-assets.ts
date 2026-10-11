/**
 * generate_assets 工具 —— 主 AI 生成交付素材（doubao-seedream，**花钱动作**）。
 *
 * 与既有权限边界的咬合：子 agent 工具表**没有**生图（tools/design-sketch.ts
 * 的边界注释——烧钱动作留在主 AI / 用户手里）。本工具把闸门做在**结构上**，
 * 不依赖 prompt 自觉：
 *
 *   第一次调用（不带 confirm）→ 只返回将生成的清单 + 提示词，status:"needs_confirm"
 *   主 AI 把清单转告用户 → 用户确认 → 第二次调用带 confirm:true → 真正执行
 *
 * 订单（assets）由主 AI 按 asset-order.ts 的写法规范当场写好，随参数传入；
 * 执行时落盘 assets.json（落进版式目录，与设计链路既有约定同名同目录——素材生成有据可查）。
 * 未确认的订单不落盘。
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, relative, resolve } from 'node:path';
import { checkSketch } from '../../workflow/design-sketch/validate';
import { getSharedRenderer } from '../../workflow/design-sketch/runtime';
import { generateAssets, type AssetJobResult } from '../../workflow/assetsgen/image';
import type { AssetOrders } from '../../workflow/assetsgen/asset-order';
import type { DesignSketch } from '../../workflow/design-sketch/design-sketch';
import type { AgentTool } from '../subagent/types';
import { resolveDesignDir } from './project-paths';

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function createGenerateAssetsTool(config: { sessionId: string }): AgentTool {
  return {
    name: 'generate_assets',
    description:
      '按订单**生成 AI 素材**（doubao-seedream，花钱动作——必须先经用户确认）。' +
      '两段式：第一次不带 confirm → 返回清单（status:"needs_confirm"），把清单转告用户等确认；' +
      '用户明确同意后再带 confirm:true 执行。用户没确认就调 confirm 属于违规。' +
      '订单写法按七要素规范：主体/动作/场景/风格/光线/构图；引用 @product 必须带保真声明' +
      '（keep the shape, lid, label and color exactly the same…）；权重语法和质量词堆砌无效。' +
      '要「产品摆在场景里」时，用 @product 让模型**直接画出产品在场景中的整图**，' +
      '不要只生成空场景再叠产品图层（那样只会得到白底矩形硬贴）。' +
      '生成完素材后，用 render_design 重渲该版式出成品。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '版式名（designs/ 下的目录名）' },
        assets: {
          type: 'array',
          description:
            '素材订单数组，每项 {file, size, prompt, promptLang?, references?, useSketchRef?}。' +
            'file 是文件名（与 spec 里 image 节点的 asset 一致，如 "scene.png"）；' +
            'size 如 "2048x2048"（竖构图 "1440x2560"）；references 的 ref 可为 ' +
            '"@product"（商品照）/"@sketch"（默认自动加，构图参考）/相对文件名',
        },
        productPath: {
          type: 'string',
          description: '商品照路径（相对工作目录，如 "uploads/chat-xxx.png"）。仅订单引用 @product 时必须',
        },
        confirm: {
          type: 'boolean',
          description: '用户确认后的执行开关。缺省/false = 只返回清单不花钱',
        },
      },
      required: ['name', 'assets'],
    },
    async execute(args, ctx) {
      const name = args.name;
      if (typeof name !== 'string' || !NAME_RE.test(name)) {
        return {
          content: `ERROR: 版式名 ${JSON.stringify(name)} 非法。只能用英文、数字、点、下划线、连字符。`,
          isError: true,
        };
      }
      const orders = args.assets;
      if (!Array.isArray(orders) || orders.length === 0) {
        return { content: 'ERROR: assets 必须是非空数组（素材订单）。没有要生成的素材就不要调这个工具。', isError: true };
      }
      for (const o of orders) {
        const rec = o as Record<string, unknown>;
        if (typeof rec.file !== 'string' || typeof rec.prompt !== 'string' || !rec.prompt.trim()) {
          return { content: `ERROR: 订单项缺少 file 或 prompt：${JSON.stringify(rec).slice(0, 120)}`, isError: true };
        }
      }

      const r = await resolveDesignDir(config.sessionId, name);
      const workDir = r.workDir;
      const dir = r.dir;
      const specPath = resolve(dir, 'design-sketch.json');
      if (!existsSync(specPath)) {
        return { content: `ERROR: ${name}/design-sketch.json 不存在（在 ${dir} 下找的）。先出草案再谈素材。`, isError: true };
      }
      let spec: DesignSketch;
      try {
        spec = JSON.parse(readFileSync(specPath, 'utf8')) as DesignSketch;
        const check = checkSketch(spec);
        if (!check.ok) {
          return { content: 'ERROR: spec 校验不通过，先修 spec：\n' + check.issues.map((i) => `[${i.level}] ${i.path}: ${i.message}`).join('\n'), isError: true };
        }
      } catch (e) {
        return { content: `ERROR: spec 读取失败（${(e as Error).message}）。`, isError: true };
      }

      // ── 闸门第一段：只看清单，不花钱 ──
      if (!args.confirm) {
        const lines = (orders as AssetOrders).map((o, i) => {
          const owner = spec.layers.find((l) => l.type === 'image' && l.asset === o.file);
          const used = owner ? '' : '（⚠️ spec 里没有 image 节点引用它）';
          return `${i + 1}. ${o.file}（${o.size ?? '2048x2048'}）${used}\n   提示词：${o.prompt.slice(0, 160)}${o.prompt.length > 160 ? '…' : ''}`;
        });
        const sketchOk = existsSync(resolve(dir, 'sketch.png'));
        return {
          content: JSON.stringify({
            status: 'needs_confirm',
            name,
            count: orders.length,
            sketchAvailable: sketchOk,
            note: sketchOk ? undefined : '⚠️ 版式目录没有 sketch.png——@sketch 构图参考会失败，先让子 agent 渲草图',
            list: lines,
            next: '把清单转告用户（含每张的提示词要点），用户确认后带 confirm:true 重调',
          }),
        };
      }

      // ── 闸门第二段：执行 ──
      // 订单落盘（确认过的才写——与 assets.json 既有约定同目录同名）
      mkdirSync(dir, { recursive: true });
      writeFileSync(resolve(dir, 'assets.json'), JSON.stringify(orders, null, 2) + '\n', 'utf8');

      // productPath 按工作目录相对解析（贴图落 <workDir>/uploads/）
      const productRoots = [workDir];
      const productArg = typeof args.productPath === 'string' && args.productPath.trim()
        ? productRoots.map((r) => resolve(r, args.productPath as string)).find((p) => existsSync(p)) ?? null
        : null;
      if (args.productPath && !productArg) {
        return {
          content: `ERROR: productPath 不存在：${args.productPath}（试过 ${productRoots.join(' 与 ')}）`,
          isError: true,
        };
      }

      // 品牌词消毒：生成提示词里写品牌名（如 Gogokids）会触发内容审核拦截（实测）。
      // 品牌词唯一真源 = **工作目录名**（一个工作目录就是一个项目，目录名通常就是
      // 产品/listing 的英文标识）；替换为中性词。用户看到的确认清单仍是原文（清单在第一段）。
      const brandWords = (() => {
        try {
          const words = new Set<string>();
          const GENERIC = new Set(['test', 'demo', 'e2e', 'probe', 'the', 'and']);
          for (const w of basename(workDir).match(/[A-Za-z][A-Za-z0-9]{2,}/g) ?? []) {
            if (!GENERIC.has(w.toLowerCase())) words.add(w);
          }
          return [...words];
        } catch {
          return [];
        }
      })();
      const sanitize = (prompt: string): string => {
        let out = prompt;
        for (const w of brandWords) out = out.replace(new RegExp(`\\b${w}\\b`, 'gi'), 'the product');
        return out.replace(/\s{2,}/g, ' ').trim();
      };
      const ordersForGen = brandWords.length
        ? (orders as AssetOrders).map((o) => ({ ...o, prompt: sanitize(o.prompt) }))
        : (orders as AssetOrders);

      const renderer = await getSharedRenderer();
      let results: AssetJobResult[];
      try {
        results = await generateAssets({
          orders: ordersForGen,
          spec,
          outDir: dir,
          productPath: productArg,
          host: renderer,
          force: false,
        });
      } catch (e) {
        // 典型：引用 @product 但没给 productPath（generateAssets 前置检查）
        return { content: `ERROR: ${(e as Error).message}`, isError: true };
      }

      const rel = (p: string) => relative(resolve(workDir), resolve(dir, p));
      const ok = results.filter((r) => r.ok);
      const failed = results.filter((r) => !r.ok);
      // 产物事件：本轮真的生成了新素材才推（skipped = 已存在，不算变更）——
      // 前端据此实时刷新 gallery
      if (ok.some((r) => !r.skipped)) {
        ctx.onEvent?.({ kind: 'artifacts', source: 'generate_assets', name });
      }
      return {
        content: JSON.stringify({
          name,
          generated: ok.filter((r) => !r.skipped).map((r) => ({ file: rel(r.file), bytes: r.bytes })),
          skipped: ok.filter((r) => r.skipped).map((r) => r.file),
          failed: failed.map((r) => ({ file: r.file, error: r.error })),
          next: ok.length && !failed.length
            ? '全部就绪——调 render_design 渲成品'
            : failed.length
              ? '有失败项：把失败原因告诉用户，建议改提示词后重试（已成功的不会重复生成）'
              : '全部已存在，无需生成——直接 render_design',
        }),
      };
    },
  };
}
