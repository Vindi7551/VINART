/**
 * 探针：project / user 层 skill 必须工具无关。
 *
 * 规则（2026-10-22 决策 A）：
 * - bundled 是产品能力手册，可以写工具名 / 字段 / 占位符；
 * - project / user 是领域知识，只能写设计判断与阶段语言，
 *   不得出现宿主工具名、schema 字段、资源名。
 *
 * 本探针只扫项目根下的 `skills/`（project 层）。命中 denylist 即失败。
 * 跑法：
 *   node scripts/_probe-skill-purity.mjs [skillsRoot]
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(process.argv[2] || join(process.cwd(), 'skills'));

function ok(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`ok: ${msg}`);
}

/**
 * 宿主耦合 denylist：
 * - 工具名
 * - skill 加载语法 / 宿主文档名
 * - 文档 schema 字段 / 占位符 / 文件约定
 * - 宿主字体 / 生图模型 / 像素下限
 */
const DENY =
  /sketch_plan|patch_doc|generate_assets|get_design|spawn_design_agents|render_design|compile_appearance|skill\s*\(|assistant-system|fontScale|fontFamily|fontSizePx|canvas\.background|@placeholder|doc\.json|assets\.json|\b(?:fit|asset|rect|layers|canvas|type)\s*:|type-led|full-bleed|two-up|bleed-inset|three-up|\bsplit\b|\bgrid\b|素材要求|素材生成|素材命名|排版指令|主体\s*\+\s*视角|消耗素材|文件命名|生成参数|提示词|prompt|Noto(?:\s+(?:Serif|Sans))?|Bitter|Arvo|Alfa\s+Slab|seedream|3,686,400|viewBox|currentColor/i;

// 反向验证：denylist 本身要能命中已知坏词，也不能误伤正常设计词
ok(DENY.test('patch_doc'), 'denylist 能命中工具名');
ok(DENY.test('asset: @placeholder'), 'denylist 能命中占位符 / schema');
ok(DENY.test('type-led'), 'denylist 能命中旧结构名');
ok(DENY.test('排版指令 / 主体 + 视角'), 'denylist 能命中制作说明');
ok(!DENY.test('落版 / 调外观 / 素材阶段'), 'denylist 不误伤阶段语言');

ok(existsSync(ROOT), `skills 根目录存在：${ROOT}`);

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.isFile() && e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

const files = walk(ROOT);
ok(files.length > 0, `扫到 ${files.length} 个 markdown 文件`);

const bad = [];
for (const file of files) {
  const rel = relative(ROOT, file);
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    if (DENY.test(line)) bad.push(`${rel}:${i + 1}: ${line.trim()}`);
  });
}

ok(bad.length === 0, `目标层无宿主耦合（命中 ${bad.length} 处）`);
if (bad.length) {
  console.error('\n命中清单：');
  for (const b of bad) console.error(`  ${b}`);
  process.exit(1);
}

console.log('\n全部通过');
