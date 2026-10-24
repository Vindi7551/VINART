/**
 * Skill registry —— 三层来源合并：
 * - bundled：随产品发布（`<repo>/src/designharness/skills/bundled/<name>/SKILL.md`）
 * - project：<workDir>/skills/<name>/SKILL.md（项目级定制，按工作目录隔离）
 * - user   ：~/.vinart/skills/<name>/SKILL.md（用户全局，跨所有工作目录可用）
 *
 * **同名优先级：bundled > project > user**（决策 2026-10-11）：
 * - bundled 最高 = 只读锁定层。产品能力说明书是「产品事实」，不该被用户/项目用一份
 *   写错的版本覆盖 → 防止误导模型。它随代码发布、放在仓库里，打包后用户改不到。
 * - project > user = 就近优先。越靠近当前任务（具体项目）越优先，符合「我专门为这个项目
 *   写的就该生效」；user 是全局兜底，同名时让位给更具体的 project。
 * - 不同名时三层**全部生效**，互不干扰；「覆盖」仅在同名时发生。
 *
 * 消费方：
 * - chat-store 的 systemNote：renderSkillCatalog() 渲染 <available_skills> 目录
 *   （内容稳定 → prompt cache 前缀命中，skill 集合变化才变字节）
 * - skill 工具（同目录 skill-tool.ts）：getSkill() 按名加载全文
 *
 * ⚠️ 三层都是**现场扫目录**（每轮 chat 重扫），改/加/删 skill 文件**下一轮生效**，
 *    不需要重启 API。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import type { SkillDefinition, SkillFrontmatter, SkillSummary } from './types';

// ── 文件系统来源 ──

const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** 行式 frontmatter 解析（key: value 标量；V1 不支持多行/嵌套） */
function parseFrontmatter(raw: string): { data: SkillFrontmatter; content: string } | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!m) return null;
  const data: SkillFrontmatter = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = /^([a-zA-Z-]+):\s*(.*)$/.exec(line.trim());
    if (!kv) continue;
    const [, key, value] = kv as unknown as [string, string, string];
    if (value === 'true') (data as Record<string, unknown>)[key!] = true;
    else if (value === 'false') (data as Record<string, unknown>)[key!] = false;
    else (data as Record<string, unknown>)[key!] = value;
  }
  return { data, content: m[2] ?? '' };
}

/**
 * 扫描一个 skills 根目录（<root>/<name>/SKILL.md）。
 * bundled / project / user 三层共用本函数，只有根目录与 source 标记不同。
 */
function scanSkillsRoot(root: string, source: SkillDefinition['source']): SkillDefinition[] {
  if (!existsSync(root)) return [];
  const out: SkillDefinition[] = [];
  try {
    for (const d of readdirSync(root, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const mdPath = join(root, d.name, 'SKILL.md');
      if (!existsSync(mdPath)) continue;
      const parsed = parseFrontmatter(readFileSync(mdPath, 'utf8'));
      if (!parsed) {
        console.warn(`[skills] ${mdPath} 缺少 frontmatter，已跳过`);
        continue;
      }
      const { data, content } = parsed;
      const name = data.name ?? d.name;
      if (!SKILL_NAME_RE.test(name) || !data.description) {
        console.warn(`[skills] ${mdPath} 的 name/description 不合法，已跳过`);
        continue;
      }
      out.push({
        name,
        description: data.description,
        whenToUse: data.whenToUse,
        source,
        path: mdPath,
        content,
      });
    }
  } catch (e) {
    console.warn(`[skills] 读取 ${root} 失败：${(e as Error).message}`);
  }
  return out;
}

/**
 * 产品内置：`<repo>/src/designharness/skills/bundled/<name>/SKILL.md`。
 * 随代码发布，不放在用户目录——打包后目录只读，用户覆盖不了。
 */
const BUNDLED_ROOT = resolve('src/designharness/skills/bundled');

function listBundledSkills(): SkillDefinition[] {
  return scanSkillsRoot(BUNDLED_ROOT, 'bundled');
}

/** 项目级：<workDir>/skills/<name>/SKILL.md（按工作目录隔离） */
function listProjectSkills(workDir: string): SkillDefinition[] {
  return scanSkillsRoot(join(resolve(workDir), 'skills'), 'project');
}

/** 用户全局级：~/.vinart/skills/<name>/SKILL.md（跨所有工作目录可用） */
function listUserSkills(): SkillDefinition[] {
  return scanSkillsRoot(join(homedir(), '.vinart', 'skills'), 'user');
}

// ── 合并读取 ──

/**
 * 全部可用 skill。同名时按 **bundled > project > user** 取高优先级者
 * （按优先级从高到低依次占位，低优先级遇重名直接跳过）。
 */
export function listSkills(workDir: string): SkillSummary[] {
  const merged: SkillSummary[] = [];
  const seen = new Set<string>();
  for (const s of [...listBundledSkills(), ...listProjectSkills(workDir), ...listUserSkills()]) {
    if (seen.has(s.name)) continue;
    seen.add(s.name);
    merged.push(s);
  }
  return merged;
}

/** 按名加载完整定义；优先级同 listSkills（bundled > project > user）；不存在返回 null */
export function getSkill(workDir: string, name: string): SkillDefinition | null {
  return (
    listBundledSkills().find((s) => s.name === name) ??
    listProjectSkills(workDir).find((s) => s.name === name) ??
    listUserSkills().find((s) => s.name === name) ??
    null
  );
}

// ── 目录内文件读取（file 参数）──

/**
 * 单个文件读取上限（超出报错，避免撑爆上下文）。
 * 注意：**不预设 skill 目录的结构、也不自动枚举文件**——目录里怎么组织、有哪些文件，
 * 由 SKILL.md 正文自行说明（用相对路径指向），模型按需来取。
 */
const FILE_MAX_BYTES = 64 * 1024;

/** skill 目录（SKILL.md 所在目录）；没有 path（理论上不会出现）→ null */
function skillDirOf(skill: SkillDefinition): string | null {
  return skill.path ? dirname(skill.path) : null;
}

/**
 * 读取 skill 目录内的某个文件。`rel` 是**相对 SKILL.md 所在目录**的路径，
 * 可含子目录（如 `contracts/production-contract.md`）——目录结构完全自由，不做枚举/分类。
 * **路径必须落在该 skill 目录内**（防 `../` 穿越）；不存在 / 非普通文件 / 超上限均报错。
 */
export function readSkillFile(
  skill: SkillDefinition,
  rel: string,
): { ok: true; content: string } | { ok: false; error: string } {
  const dir = skillDirOf(skill);
  if (!dir) return { ok: false, error: '该 skill 无目录' };
  const base = resolve(dir);
  const abs = resolve(base, rel);
  if (abs !== base && !abs.startsWith(base + sep)) {
    return { ok: false, error: `路径越界（只允许读取本 skill 目录内的文件）：${rel}` };
  }
  let st;
  try {
    st = statSync(abs);
  } catch {
    return { ok: false, error: `文件不存在：${rel}` };
  }
  if (!st.isFile()) return { ok: false, error: `不是文件：${rel}` };
  if (st.size > FILE_MAX_BYTES) {
    return { ok: false, error: `文件过大（${st.size} 字节，上限 ${FILE_MAX_BYTES}）：${rel}` };
  }
  return { ok: true, content: readFileSync(abs, 'utf8') };
}

// ── 目录渲染（systemNote 注入）──

/**
 * <available_skills> 目录块。skill 集合不变 → 字节不变 → prompt cache 前缀命中。
 * 无任何 skill 时返回空串（不注入空目录）。
 */
export function renderSkillCatalog(workDir: string): string {
  const skills = listSkills(workDir);
  if (skills.length === 0) return '';
  return [
    '<system-reminder>',
    'A skill is a reusable set of task-specific instructions. The following skills are available:',
    '',
    '<available_skills>',
    ...skills.map((s) => `- \`${s.name}\`: ${s.description}${s.whenToUse ? `（${s.whenToUse}）` : ''}`),
    '</available_skills>',
    '',
    "If the user's task clearly matches a skill's description, call the `skill` tool with the exact skill name before taking task actions, then follow its full instructions. This catalog contains summaries only.",
    '</system-reminder>',
  ].join('\n');
}
