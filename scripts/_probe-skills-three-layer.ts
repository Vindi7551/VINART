/**
 * 探针：skills 三层来源 + 优先级（bundled > project > user）+ 附属文件按需加载。
 * 断言驱动：失败即非 0 退出；跑完自清理临时目录。
 * 用法：npm run step scripts/_probe-skills-three-layer.ts
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import {
  listSkills,
  getSkill,
  readSkillFile,
  renderSkillCatalog,
  registerBundledSkill,
} from '../src/designharness/skills/registry';

let failed = 0;
const ok = (cond: boolean, msg: string) => {
  if (cond) console.log(`  [ok] ${msg}`);
  else {
    console.error(`  [FAIL] ${msg}`);
    failed++;
  }
};

const userSkillPath = join(homedir(), '.vinart', 'skills', 'amazon-listing', 'SKILL.md');
console.log('[1] 用户全局层（~/.vinart/skills/）');
ok(existsSync(userSkillPath), `SKILL.md 存在：${userSkillPath}`);

const tmp = mkdtempSync(join(tmpdir(), 'vinart-skills-probe-'));
try {
  // 空工作目录（无 skills/）→ 只剩 user 层可读
  const s1 = listSkills(tmp).find((s) => s.name === 'amazon-listing');
  ok(!!s1, '空工作目录仍能列出 amazon-listing（来自 user 全局层）');
  ok(s1?.source === 'user', `source === 'user'（实际 ${s1?.source}）`);
  const g1 = getSkill(tmp, 'amazon-listing');
  ok(g1?.source === 'user', 'getSkill 命中 user 层');
  ok((g1?.content.length ?? 0) > 100, `正文被加载（长度 ${g1?.content.length}）`);

  // ⚠️ 必须在 [4] 注册 bundled 之前测——否则 bundled 会挡住真实 user 层
  console.log('[1b] 真实 skill 的中文路径附件（设计风格/风格指南.md）');
  const realSkill = getSkill(process.cwd(), 'amazon-listing');
  ok(realSkill?.source === 'user', `无 skills/ 的目录 → 来自 user 层（实际 ${realSkill?.source}）`);
  const rf = readSkillFile(realSkill!, '设计风格/风格指南.md');
  ok(rf.ok, `读取中文路径附件（${rf.ok ? '成功' : rf.error}）`);
  if (rf.ok) ok(rf.content.length > 50, `附件内容非空（${rf.content.length} 字符）`);

  console.log('[2] 项目层覆盖 user（project > user）');
  const projDir = join(tmp, 'skills', 'amazon-listing');
  mkdirSync(projDir, { recursive: true });
  writeFileSync(
    join(projDir, 'SKILL.md'),
    '---\nname: amazon-listing\ndescription: 项目级覆盖版\n---\n\nproject override\n',
    'utf8',
  );
  const s2 = listSkills(tmp).find((s) => s.name === 'amazon-listing');
  ok(s2?.source === 'project', `project 同名覆盖 user（实际 ${s2?.source}）`);
  ok(!!getSkill(tmp, 'amazon-listing')?.content.includes('project override'), 'getSkill 拿到项目版正文');

  console.log('[3] 不同名三层共存');
  const localDir = join(tmp, 'skills', 'my-local-skill');
  mkdirSync(localDir, { recursive: true });
  writeFileSync(
    join(localDir, 'SKILL.md'),
    '---\nname: my-local-skill\ndescription: 本地技能\n---\n\nlocal body\n',
    'utf8',
  );
  const names = listSkills(tmp).map((s) => s.name);
  ok(
    names.includes('my-local-skill') && names.includes('amazon-listing'),
    `共存：${names.join(', ')}`,
  );

  console.log('[4] 内置层最高（bundled > project）');
  registerBundledSkill({ name: 'amazon-listing', description: '内置锁定版', content: 'bundled body' });
  const s3 = listSkills(tmp).find((s) => s.name === 'amazon-listing');
  ok(s3?.source === 'bundled', `bundled 同名覆盖 project（实际 ${s3?.source}）`);
  ok(getSkill(tmp, 'amazon-listing')?.content === 'bundled body', 'getSkill 拿到内置版正文');

  console.log('[5] renderSkillCatalog');
  const cat = renderSkillCatalog(tmp);
  ok(cat.includes('amazon-listing') && cat.includes('<available_skills>'), '目录块含 amazon-listing');
  ok(cat.split('\n').filter((l) => l.startsWith('- `')).length >= 2, '目录列出 >=2 个 skill');

  console.log('[6] 目录内文件按路径读取（不枚举 · 结构自由）');
  const local = getSkill(tmp, 'my-local-skill');
  ok(!!local, 'getSkill 拿到 my-local-skill');
  writeFileSync(join(localDir, 'REFERENCE.md'), '# 参考\n\nattachment body\n', 'utf8');
  mkdirSync(join(localDir, 'refs', 'deep', 'deeper'), { recursive: true });
  writeFileSync(join(localDir, 'refs', 'deep', 'deeper', 'contract.md'), 'deep nested contract\n', 'utf8');
  writeFileSync(join(localDir, 'big.md'), 'x'.repeat(70 * 1024), 'utf8');

  const r1 = readSkillFile(local!, 'REFERENCE.md');
  ok(r1.ok && r1.content.includes('attachment body'), '按路径读到同级文件');
  const r5 = readSkillFile(local!, 'refs/deep/deeper/contract.md');
  ok(r5.ok && r5.content.includes('deep nested'), '读到深层嵌套文件（无深度限制）');
  const r2 = readSkillFile(local!, '../../../etc/passwd');
  ok(!r2.ok, `路径穿越被拒（${r2.ok ? '居然通过' : r2.error}）`);
  const r3 = readSkillFile(local!, 'nope.md');
  ok(!r3.ok, '不存在文件报错');
  const r4 = readSkillFile(local!, 'big.md');
  ok(!r4.ok, '超大文件被拒');
} finally {
  rmSync(tmp, { recursive: true, force: true });
  console.log(`\n清理临时目录：${tmp}`);
}

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
