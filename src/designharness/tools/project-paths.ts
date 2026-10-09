/**
 * 项目路径辅助 —— 聊天链工具统一从这里解析「版式的家」。
 *
 * 目录规则（2026-10-08 定案）：
 *   写：<workDir>/<project>/designs/<版式名>/   （project 未设置 → 调用方 fail-loud）
 *   读：先新位置，不存在 → 回退 <workDir>/designs/<name>（旧数据原地可用，不迁移）
 *
 * 版式的家（dir）一旦找到，spec/appearance/素材/成品全部落那里——
 * 一个版式一个目录看全，不因回退而把一份版式拆两处。
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getProject, getWorkDir } from '../session/transcript';

export interface DesignDirResolution {
  workDir: string;
  /** 会话当前项目；null = 未设置（写产物前调用方必须 fail-loud 提示 set_project） */
  project: string | null;
  /** 版式的家：实际存在则回退后的位置；不存在则是「应当新建的位置」 */
  dir: string;
  /** 版式目录是否真实存在（false = 新建场景，dir 是预期写位置） */
  exists: boolean;
}

export async function resolveDesignDir(sessionId: string, name: string): Promise<DesignDirResolution> {
  const workDir = resolve(await getWorkDir(sessionId));
  const project = await getProject(sessionId);
  const newDir = project ? join(workDir, project, 'designs', name) : null;
  const legacyDir = join(workDir, 'designs', name);

  if (newDir && existsSync(newDir)) return { workDir, project, dir: newDir, exists: true };
  if (existsSync(legacyDir)) return { workDir, project, dir: legacyDir, exists: true };
  // 都不存在 = 新建场景：项目已设置 → 新位置；未设置 → 旧约定位置（调用方决定拦不拦）
  return { workDir, project, dir: newDir ?? legacyDir, exists: false };
}

/** 未设置项目时的标准提示（可行动：两条路都给全） */
export const NO_PROJECT_HINT =
  '当前会话还没设置项目。告诉我项目名（如「项目叫 tshirt-black」）我会用 set_project 建好并切换；' +
  '或在前端 📂 旁的项目下拉里选择/新建。';
