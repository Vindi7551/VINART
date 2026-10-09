/**
 * Skill registry —— 两层来源合并：
 * - bundled：代码内置（registerBundledSkill，如 amazon-listing 流程手册）
 * - project：<workDir>/skills/<name>/SKILL.md（用户/项目自建，重名覆盖 bundled）
 *
 * 消费方：
 * - chat-store 的 systemNote：renderSkillCatalog() 渲染 <available_skills> 目录
 *   （内容稳定 → prompt cache 前缀命中，skill 集合变化才变字节）
 * - skill 工具（同目录 skill-tool.ts）：getSkill() 按名加载全文
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { SkillDefinition, SkillFrontmatter, SkillSummary } from './types';

// ── bundled（代码内置）──

const bundled: SkillDefinition[] = [];

/** 内置 skill 注册（模块加载期调用；source 由本函数打上 'bundled'） */
export function registerBundledSkill(skill: Omit<SkillDefinition, 'source'>): void {
  bundled.push({ ...skill, source: 'bundled' });
}

// ── project（<workDir>/skills/ 文件系统）──

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

/** 列出某工作目录下的项目级 skill（<workDir>/skills/<name>/SKILL.md） */
function listProjectSkills(workDir: string): SkillDefinition[] {
  const root = join(resolve(workDir), 'skills');
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
        source: 'project',
        path: mdPath,
        content,
      });
    }
  } catch (e) {
    console.warn(`[skills] 读取 ${root} 失败：${(e as Error).message}`);
  }
  return out;
}

// ── 合并读取 ──

/** 全部可用 skill（project 重名覆盖 bundled——项目级定制优先） */
export function listSkills(workDir: string): SkillSummary[] {
  const project = listProjectSkills(workDir);
  const projectNames = new Set(project.map((p) => p.name));
  const merged: SkillSummary[] = [...project];
  for (const b of bundled) {
    if (!projectNames.has(b.name)) merged.push(b);
  }
  return merged;
}

/** 按名加载完整定义；不存在返回 null */
export function getSkill(workDir: string, name: string): SkillDefinition | null {
  return listProjectSkills(workDir).find((s) => s.name === name) ?? bundled.find((s) => s.name === name) ?? null;
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
