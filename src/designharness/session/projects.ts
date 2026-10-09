/**
 * 项目索引 —— workDir 下的项目清单（<workDir>/.vinart/project.json）。
 *
 * 项目 = 产物的一级分组目录（<workDir>/<项目名>/designs/…、briefs/、uploads/）。
 * 一个工作文件夹里通常有多个项目（一个店铺的多个 listing），会话通过
 * meta 事件记住「当前项目」（transcript.getProject/setProject）。
 *
 * 为什么显式索引而不是 readdir 猜：空项目壳子 readdir 看不见、目录名
 * 当显示名太将就、sessions/uploads 等非项目目录要靠启发式排除——
 * 注册制 + 元数据（displayName 可中文）三个问题一起解决。
 * 幽灵条目（目录被手动删）读取时 existsSync 过滤，不主动清理。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface ProjectEntry {
  /** 目录名（文件系统安全：英文/数字/点/下划线/连字符），唯一键 */
  name: string;
  /** 展示名（可中文），缺省 = name */
  displayName?: string;
  createdAt: string;
  updatedAt: string;
}

/** 项目名 = 目录名，防路径注入（与版式名 NAME_RE 同规则） */
export const PROJECT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function indexFile(workDir: string): string {
  return join(resolve(workDir), '.vinart', 'project.json');
}

function readIndex(workDir: string): ProjectEntry[] {
  const p = indexFile(workDir);
  if (!existsSync(p)) return [];
  try {
    const arr = JSON.parse(readFileSync(p, 'utf8')) as ProjectEntry[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return []; // 半截写入/手改坏——当空清单，下次注册重建
  }
}

function writeIndex(workDir: string, list: ProjectEntry[]): void {
  const p = indexFile(workDir);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, JSON.stringify(list, null, 2) + '\n', 'utf8');
}

/**
 * 项目清单（含幽灵过滤）：索引条目按 updatedAt 新→旧，
 * 目录已不存在的手动删掉的条目不显示也不删除（下次注册同名自动复用条目）。
 */
export function listProjects(workDir: string): ProjectEntry[] {
  return readIndex(workDir).filter((e) => existsSync(join(resolve(workDir), e.name)));
}

/** 项目是否已注册（不看目录，看索引——注册即建目录，正常两者同步） */
export function hasProject(workDir: string, name: string): boolean {
  return readIndex(workDir).some((e) => e.name === name);
}

/** 项目目录绝对路径（不检查存在性——调用方决定 mkdir 还是读回退） */
export function projectDir(workDir: string, name: string): string {
  return join(resolve(workDir), name);
}

/**
 * 注册项目（不存在则创建目录 + 写索引；**已存在只切换，displayName 不覆盖**——
 * 展示名是用户建项目时定的，主 AI 切换时不许顺手改（实测被覆盖过一次）。
 * name 非法由调用方先挡（错误消息里带规则）。
 */
export function registerProject(workDir: string, name: string, displayName?: string): string {
  if (!PROJECT_NAME_RE.test(name)) {
    throw new Error(`项目名 ${JSON.stringify(name)} 非法。只能用英文、数字、点、下划线、连字符（展示名可以是中文，走 displayName）。`);
  }
  const dir = projectDir(workDir, name);
  const now = new Date().toISOString();
  const list = readIndex(workDir);
  const i = list.findIndex((e) => e.name === name);
  if (i >= 0) {
    list[i] = { ...list[i], updatedAt: now }; // 已存在：只刷新时间，displayName 不动
  } else {
    list.unshift({
      name,
      ...(displayName ? { displayName } : {}),
      createdAt: now,
      updatedAt: now,
    });
  }
  mkdirSync(dir, { recursive: true });
  writeIndex(workDir, list);
  return dir;
}
