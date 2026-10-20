/**
 * 探针：design-style 分层 skill 是否完整可读。
 *
 * 跑法：
 *   node --experimental-transform-types --import ./scripts/_ts-resolve.mjs scripts/_probe-design-style.mjs [workDir]
 */
import { getSkill, readSkillFile, renderSkillCatalog } from '../src/designharness/skills/registry.ts';

const WORKDIR = process.argv[2] || process.cwd();
const NAME = 'design-style';

function ok(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`ok: ${msg}`);
}

const skill = getSkill(WORKDIR, NAME);
ok(Boolean(skill), `getSkill(${NAME}) 能读到`);
ok(skill.source === 'user' || skill.source === 'project', `source=${skill.source}`);

const refs = [
  ['styles/editorial.md', '杂志'],
  ['styles/minimal.md', '极简'],
  ['styles/swiss.md', '瑞士'],
  ['styles/luxury.md', '奢华'],
  ['styles/brutalist.md', '粗野'],
  ['styles/organic.md', '自然'],
  ['styles/retro.md', '复古'],
  ['styles/tech.md', '科技'],
  ['references/history.md', 'Bauhaus'],
];

for (const [rel, needle] of refs) {
  ok(skill.content.includes(rel), `SKILL.md 索引了 ${rel}`);
  const r = readSkillFile(skill, rel);
  ok(r.ok, `${rel} 可读${r.ok ? '' : `（${r.error}）`}`);
  ok(r.content.includes(needle), `${rel} 含关键内容「${needle}」`);
}

ok(skill.content.includes('70%'), 'SKILL.md 写了主/辅风格比例');
ok(skill.content.includes('不是套餐'), 'SKILL.md 明确「不是套餐」');
ok(renderSkillCatalog(WORKDIR).includes(NAME), '目录里能看到 design-style');

console.log('\n全部通过');
