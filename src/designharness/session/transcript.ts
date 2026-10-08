/**
 * 会话转录持久化 —— 每会话一个 JSONL 追加文件,只追加、永不改写。
 *
 * 事件流是持久层,内存态(消息列表、标题)是派生物:
 *   - 崩溃安全:半截写入的最后一行加载时被跳过
 *   - 可重放:恢复 = 重放事件流派生消息,不另存快照
 *   - 大内容外置:截图/PNG 存产物目录,事件里只放路径引用(refs.file)
 *
 * 参照 Claude Code 的 transcript 实现(sessions/<sessionId>.jsonl + enqueueWrite)。
 */
import { appendFile, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { ChatMessage, ContentPart } from '../gateway/type/chat';
import { fileToDataUrl, isSupportedImagePath } from '../gateway/util/data-url';
import { withAttachmentPaths } from '../context/chat-context';

/** 会话数据根目录(工作数据与产物同根) */
const SESSIONS_DIR = resolve('test_product/sessions');
const INDEX_PATH = join(SESSIONS_DIR, 'index.json');

export type ArtifactRef = { layout: string; file?: string; element?: string };

export type SessionEvent =
  | {
      seq?: number;
      ts: string;
      kind: 'message';
      id: string;
      role: 'user' | 'assistant';
      text: string;
      refs?: ArtifactRef[];
      /**
       * 随消息上传的图片（**相对 workDir 的路径**）——大内容外置：
       * 图片本体落 workDir/uploads/，事件里只存路径引用（重放时读回）。
       */
      images?: string[];
      /**
       * 与 images 平行对应的 Files API file_id（形如 `file-api-...`）。
       * 有值 → 重放组装 `file` 内容块引用（不再读文件编码 base64）；
       * 无值（旧数据）→ 走 images 路径回读 dataURL 的原逻辑。
       * 两数组按下标一一对应；个别图上传失败时对应位为空字符串。
       */
      fileIds?: string[];
    }
  | {
      seq?: number;
      ts: string;
      kind: 'action';
      action:
        | 'open-layout'
        | 'save-spec'
        | 'render'
        | 'pipeline-start'
        | 'pipeline-done'
        // 子 agent 记账对：以 detail.runId 配对（spawn 输入全文 / result 结构化结果）
        | 'agent-spawn'
        | 'agent-result';
      detail: Record<string, unknown>;
    }
  | { seq?: number; ts: string; kind: 'meta'; title?: string; workDir?: string };

export interface SessionIndexEntry {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
}

function sessionFile(id: string): string {
  return join(SESSIONS_DIR, `${id}.jsonl`);
}

/**
 * 子 agent transcript 落点：agents/<sessionId>/<runId>/transcript.jsonl。
 * 按会话组织（不按 runId 平铺）——子 agent 的生命周期跟会话绑定，
 * 将来 deleteSession 级联清理有明确边界；runId 本身在父账本事件里不会丢。
 */
export function agentTranscriptPath(sessionId: string, runId: string): string {
  return join(SESSIONS_DIR, 'agents', sessionId, runId, 'transcript.jsonl');
}

/** 新会话 id(uuid;带前缀便于在日志/文件名里辨认) */
export function newSessionId(): string {
  return `sess_${crypto.randomUUID().slice(0, 8)}`;
}

/** 追加事件(自动建目录;同步更新索引) */
export function appendEvent(
  sessionId: string,
  event: Omit<SessionEvent, 'seq'> & Record<string, unknown>,
): Promise<void> {
  // 全局串行化：runner 并发池里多个 job 同步落**同一个**父账本文件，
  // 并发 open('a') 同一新建文件在 Windows 上撞 EPERM（2026-10-08 四并发实测，
  // 残留 0 字节文件）。追加顺序在进程内本就不保证跨 job 语义，串行零损失。
  const run = appendQueue.then(() => appendEventInner(sessionId, event));
  appendQueue = run.catch(() => {}); // 单次失败不卡死后续落账
  return run;
}

let appendQueue: Promise<void> = Promise.resolve();

async function appendEventInner(
  sessionId: string,
  event: Omit<SessionEvent, 'seq'> & Record<string, unknown>,
): Promise<void> {
  await mkdir(SESSIONS_DIR, { recursive: true });
  await appendFile(
    sessionFile(sessionId),
    JSON.stringify(event as SessionEvent) + '\n',
    'utf8',
  );
  await touchIndex(sessionId, event as SessionEvent);
}

/** 读取事件流(按行序赋 seq;坏行——半截写入——跳过) */
export async function loadTranscript(sessionId: string): Promise<SessionEvent[]> {
  let raw = '';
  try {
    raw = await readFile(sessionFile(sessionId), 'utf8');
  } catch {
    return [];
  }
  const events: SessionEvent[] = [];
  let seq = 0;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const ev = JSON.parse(line) as SessionEvent;
      ev.seq = ++seq;
      events.push(ev);
    } catch {
      // 半截写入(进程中断)——跳过该行,不影响之前的事件
    }
  }
  return events;
}

/** 会话索引(列表页快,免重放全部转录) */
export async function listSessions(): Promise<SessionIndexEntry[]> {
  try {
    const raw = await readFile(INDEX_PATH, 'utf8');
    const arr = JSON.parse(raw) as SessionIndexEntry[];
    return Array.isArray(arr) ? arr.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) : [];
  } catch {
    return [];
  }
}

export async function deleteSession(sessionId: string): Promise<void> {
  try {
    await unlink(sessionFile(sessionId));
  } catch {
    /* 文件不存在——视为已删 */
  }
  const list = await listSessions();
  await writeFile(
    INDEX_PATH,
    JSON.stringify(list.filter((s) => s.id !== sessionId), null, 2) + '\n',
    'utf8',
  );
}

/**
 * 事件流 → ChatMessage[]（不含 system——由 ChatSession 的 systemPrompt 承担）。
 *
 * 带图消息重放，两代数据并存：
 * - 新数据（有 fileIds）：组装 Files API `file` 块引用——不读文件、零 base64，
 *   与发送时同源；本地文件只留作存档。
 * - 旧数据（只有 images）：读回 workDir 下的图片文件转 dataURL 组成 content parts
 *   （与发送时的形状一致——重启后模型仍能看到历史图）。图片读不到时退化为
 *   文本占位符（文件被移动/删除不阻塞会话恢复）。workDir 缺省时同样退化。
 */
export async function deriveMessages(
  events: SessionEvent[],
  workDir?: string,
): Promise<Array<ChatMessage & { id: string }>> {
  const out: Array<ChatMessage & { id: string }> = [];
  for (const e of events) {
    if (e.kind !== 'message') continue;
    if (e.role === 'user' && e.images?.length) {
      const fileIds = e.fileIds ?? [];
      // 附图路径文本化（withAttachmentPaths）：旧事件存的 text 没有路径行，
      // 重放统一补——否则重启后的会话模型照样说不出贴图路径
      const parts: ContentPart[] = [
        { type: 'text', text: withAttachmentPaths(e.text, e.images) },
      ];
      const lost: string[] = [];
      for (const [i, rel] of e.images.entries()) {
        // 新数据：fileId 在手，直接引用（不碰文件系统）。
        // as 断言——{type:'file', file_id} 是 DeepSeek Files API 块形状（DeepSeekFileRefPart），
        // 经 VendorPart 透传给 provider
        const fid = fileIds[i];
        if (fid) {
          parts.push({ type: 'file', file_id: fid } as ContentPart);
          continue;
        }
        // 旧数据 / 上传失败位：回读本地文件编码 dataURL
        try {
          if (!workDir) throw new Error('no workDir');
          const abs = resolve(workDir, rel);
          if (!isSupportedImagePath(abs)) throw new Error('unsupported ext');
          // 复用 gateway 的统一编码器（同一份 MIME 表与格式校验，compile.ts 同源）
          parts.push({ type: 'image_url', image_url: { url: fileToDataUrl(abs) } });
        } catch {
          lost.push(rel);
        }
      }
      // 有图 → parts 形状（与发送时一致）；全丢 → 退化纯文本占位
      out.push(
        lost.length < e.images.length
          ? { id: e.id, role: e.role, content: parts }
          : {
              id: e.id,
              role: e.role,
              content:
                withAttachmentPaths(e.text, e.images) +
                lost.map((r) => `\n[图片丢失: ${r}]`).join(''),
            },
      );
      continue;
    }
    out.push({ id: e.id, role: e.role, content: e.text });
  }
  return out;
}

export function deriveTitle(events: SessionEvent[]): string {
  const first = events.find((e) => e.kind === 'message' && e.role === 'user');
  const text = first && first.kind === 'message' ? first.text : '';
  return (text.trim().slice(0, 20) || '新会话') + (text.trim().length > 20 ? '…' : '');
}

/** 未选工作目录时的缺省落点(旧约定,保持兼容) */
export const DEFAULT_WORK_DIR = resolve('test_product');

/**
 * 会话的工作目录:取**最后一条**带 workDir 的 meta 事件;
 * 未设置过 → 缺省 test_product(旧数据零迁移,平滑过渡)
 */
export async function getWorkDir(sessionId: string): Promise<string> {
  const events = await loadTranscript(sessionId);
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.kind === 'meta' && 'workDir' in e && typeof (e as { workDir?: unknown }).workDir === 'string') {
      return (e as { workDir: string }).workDir;
    }
  }
  return DEFAULT_WORK_DIR;
}

/** 设置工作目录(meta 事件追加 + 目录就绪)。返回归一化的绝对路径 */
export async function setWorkDir(sessionId: string, dir: string): Promise<string> {
  const abs = resolve(dir);
  await mkdir(abs, { recursive: true });
  await appendEvent(sessionId, {
    ts: new Date().toISOString(),
    kind: 'meta',
    workDir: abs,
  } as SessionEvent);
  return abs;
}

function countMessages(events: SessionEvent[]): number {
  return events.filter((e) => e.kind === 'message').length;
}

/** 索引条目 upsert:title/messageCount/updatedAt 以最新事件流为准 */
async function touchIndex(sessionId: string, latest: SessionEvent): Promise<void> {
  const events = await loadTranscript(sessionId);
  const list = await listSessions();
  const entry: SessionIndexEntry = {
    id: sessionId,
    title: deriveTitle(events),
    updatedAt: latest.ts,
    messageCount: countMessages(events),
  };
  const idx = list.findIndex((s) => s.id === sessionId);
  if (idx >= 0) list[idx] = entry;
  else list.unshift(entry);
  await mkdir(SESSIONS_DIR, { recursive: true });
  await writeFile(
    INDEX_PATH,
    JSON.stringify(list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), null, 2) + '\n',
    'utf8',
  );
}

/** 新建会话(空转录 + 索引条目) */
export async function createSession(): Promise<string> {
  const id = newSessionId();
  const ts = new Date().toISOString();
  await mkdir(SESSIONS_DIR, { recursive: true });
  await appendFile(sessionFile(id), '', 'utf8'); // 建空文件
  await writeFile(
    INDEX_PATH,
    JSON.stringify(
      [
        { id, title: '新会话', updatedAt: ts, messageCount: 0 },
        ...(await listSessions()),
      ],
      null,
      2,
    ) + '\n',
    'utf8',
  );
  return id;
}
