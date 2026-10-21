/**
 * 探针：design-direction 分层 skill 是否完整可读。
 *
 * 断言（不成立即抛错 + 非 0 退出）：
 * 1. SKILL.md 能被 getSkill 读到（user 层，测试工作目录可见）；
 * 2. SKILL.md 正文里索引的每个 references/*.md 都存在且可读；
 * 3. 关键设计主题（杠杆点 / 运动感 / 外观对比）确实在对应文件里；
 * 4. 目录（renderSkillCatalog）里能看到它。
 *
 * 跑法：
 *   node --experimental-transform-types --import ./scripts/_ts-resolve.mjs scripts/_probe-design-skill.mjs [workDir]
 *
 * 不传 workDir 时用当前目录（会命中仓库里的 project skill）；
 * 传 `D:/workplace/test` 时测的是用户级 `~/.vinart/skills/` 那份。
 */
import {
  getSkill,
  readSkillFile,
  renderSkillCatalog,
} from '../src/designharness/skills/registry.ts';

const WORKDIR = process.argv[2] || process.cwd();
const NAME = 'design-direction';

function ok(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`ok: ${msg}`);
}

const skill = getSkill(WORKDIR, NAME);
ok(Boolean(skill), `getSkill(${NAME}) 能读到`);
ok(skill.source === 'user' || skill.source === 'project', `source=${skill.source}`);

const refs = [
  ['references/01-槽位规划.md', '图槽位'],
  ['references/02-构图recipe.md', 'triptych'],
  ['references/03-排版思想.md', '视线怎么走'],
  ['references/04-杠杆点.md', '六个杠杆'],
  ['references/05-运动感.md', '方向性'],
  ['references/06-外观与对比.md', 'patch_doc'],
  ['references/07-自检与反模式.md', '反模式'],
];

for (const [rel, needle] of refs) {
  ok(skill.content.includes(rel), `SKILL.md 索引了 ${rel}`);
  const r = readSkillFile(skill, rel);
  ok(r.ok, `${rel} 可读${r.ok ? '' : `（${r.error}）`}`);
  ok(r.content.includes(needle), `${rel} 含关键内容「${needle}」`);
}

// v0.2 的硬性约束：缺了这些就等于退回 v0.1
ok(skill.content.includes('三个检查点'), 'SKILL.md 有「三个检查点」');
ok(skill.content.includes('硬门'), 'SKILL.md 有槽位表硬门');
const v02 = [
  ['references/02-构图recipe.md', 'text-bottom'],
  ['references/02-构图recipe.md', 'scrim 三条纪律'],
  ['references/04-杠杆点.md', '主角检查'],
  ['references/06-外观与对比.md', '渐变是例外'],
  ['references/07-自检与反模式.md', 'patch_doc` 做不到'],
];
for (const [rel, needle] of v02) {
  const r = readSkillFile(skill, rel);
  ok(r.ok, `${rel} 可读（v0.2 检查）`);
  ok(r.content.includes(needle), `${rel} 含 v0.2 内容「${needle}」`);
}

ok(renderSkillCatalog(WORKDIR).includes(NAME), '目录里能看到 design-direction');
console.log('\n全部通过');
