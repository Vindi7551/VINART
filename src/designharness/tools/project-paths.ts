/**
 * 版式落点解析 —— 聊天链工具统一从这里解析「版式的家」。
 *
 * 目录规则（2026-10-10 定案，一级化）：
 *   <workDir>/designs/<版式名>/
 *
 * 「一个工作目录就是一个项目」——会话跟着目录走，<workDir> 自己就是项目根，
 * 不再有 <workDir>/<project>/ 这一层（两层结构已拆除：project.json 索引、
 * set_project 工具、会话 meta 里的 project 字段全部删除）。
 * 版式的家（dir）一旦确定，spec/appearance/素材/成品全部落那里——一个版式一个目录看全。
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getWorkDir } from '../session/transcript';

export interface DesignDirResolution {
  workDir: string;
  /** 版式的家：存在则真实位置；不存在则是「应当新建的位置」 */
  dir: string;
  /** 版式目录是否真实存在（false = 新建场景，dir 是预期写位置） */
  exists: boolean;
}

export async function resolveDesignDir(sessionId: string, name: string): Promise<DesignDirResolution> {
  const workDir = resolve(await getWorkDir(sessionId));
  const dir = join(workDir, 'designs', name);
  return { workDir, dir, exists: existsSync(dir) };
}
