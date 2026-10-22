/**
 * 探针：project 层 skill 里提到的相对路径必须真实存在。
 *
 * 扫描 `skills` 目录下所有 markdown 里的 `references/` 与 `styles/` 相对路径，
 * 相对路径一律相对该 skill 根目录（`skills/<name>/`）解析。
 * 这样 SKILL.md 索引写错、或删了附属文件，探针会立刻失败。
 *
 * 跑法：
 *   node scripts/_probe-skill-links.mjs [skillsRoot]
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const ROOT = resolve(process.argv[2] || join(process.cwd(), 'skills'));
const LINK_RE = /(?:references|styles)\/[^\s`"'）)]+\.md/g;

function ok(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`ok: ${msg}`);
}

ok(LINK_RE.test('见 references/04-杠杆点.md 与 styles/editorial.md'), 'link 正则能命中相对路径');
LINK_RE.lastIndex = 0;
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

const missing = [];
const checked = new Set();
for (const file of files) {
  const rel = relative(ROOT, file);
  const skillRoot = join(ROOT, rel.split(sep)[0]);
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(LINK_RE)) {
    const link = m[0];
    const target = join(skillRoot, link);
    const key = `${rel} -> ${link}`;
    if (checked.has(key)) continue;
    checked.add(key);
    if (!existsSync(target) || !statSync(target).isFile()) {
      missing.push(`${rel}: ${link}`);
    }
  }
}

ok(checked.size > 0, `扫到 ${checked.size} 条相对引用`);
ok(missing.length === 0, `所有相对引用都存在（缺失 ${missing.length} 条）`);

const LAYOUT_DIR = resolve(process.cwd(), 'src/designharness/skills/bundled/layout-planning');
if (existsSync(LAYOUT_DIR)) {
  ok(existsSync(join(LAYOUT_DIR, 'examples.md')), 'layout-planning/examples.md 存在');
  ok(
    readFileSync(join(LAYOUT_DIR, 'SKILL.md'), 'utf8').includes('examples.md'),
    'layout-planning/SKILL.md 指向 examples.md',
  );
}
if (missing.length) {
  console.error('\n缺失清单：');
  for (const m of missing) console.error(`  ${m}`);
  process.exit(1);
}

console.log('\n全部通过');
