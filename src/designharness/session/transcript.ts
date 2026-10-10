/**
 * 会话转录持久化 —— 每个会话一个 JSONL 追加文件，落在**它的工作目录**里：
 *
 *   <工作目录>/.vinart/sessions/
 *   ├── index.json                        # 该目录的会话索引（列表页快，免重放；缓存，可对账重建）
 *   ├── <sessionId>.jsonl                 # 每会话一个追加文件
 *   └── agents/<sessionId>/<runId>/transcript.jsonl
 *
 * 「会话跟着工作目录走」：数据与归属同处一地 —— 删掉那个目录 = 删掉它的会话（含子 agent
 * 账本），不需要任何清理逻辑、也不会出现"目录没了对话还在"。
 *
 * 跨目录的列表靠中央注册表 `~/.vinart/workdirs.json`（**只存目录路径**，不含会话数据）。
 * ⚠️ 因此它是列表的**单点**：它丢了/换机器，数据还在盘上但列表看不见。两个补救入口：
 *   - `claimWorkDir(dir)` —— 「选目录」这个动作的后端语义（登记 + 目录索引对账）
 *   - 前端启动自愈：localStorage 里记得的目录逐个认领回来
 * 「机器上有哪些目录」没有任何可枚举之处，所以注册表是必需的，缺的只是认领动作。
 *
 * 惰性会话（2026-10-10）：createSession 只分配 id + 登记落点，**不落盘、不写索引**；
 * 第一个事件真正追加时才建文件（并先写 meta 把 workDir 绑定进去）。空会话因此不存在。
 * 工作目录**在创建时绑定、之后不可更改**——换目录 = 新开会话。
 *
 * 事件流是持久层，索引/内存态（消息列表、标题）是派生物：
 *   - 崩溃安全：半截写入的最后一行加载时被跳过
 *   - 可重放：恢复 = 重放事件流派生消息，不另存快照
 *   - 大内容外置：截图/PNG 存产物目录，事件里只放路径引用(refs.file)
 *
 * 参照 Claude Code 的 transcript 实现（enqueueWrite 串行追加）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { appendFile, mkdir, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { ChatMessage, ContentPart } from '../gateway/type/chat';
import { fileToDataUrl, isSupportedImagePath } from '../gateway/util/data-url';
import { withAttachmentPaths } from '../context/chat-context';

/** 会话在工作目录内的落点：<工作目录>/.vinart/sessions/ */
const SESSIONS_SUBDIR = join('.vinart', 'sessions');
/** 中央注册表：已知工作目录的路径列表（**只是指针**，会话数据一律不进来） */
const REGISTRY_FILE = join(homedir(), '.vinart', 'workdirs.json');

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
        | 'agent-result'
        // 主 AI 工具循环的中间轮记账（一行摘要：工具名/参数/结果/耗时）——
        // 审计用，deriveMessages 不消费（不喂模型，防大 JSON 烧上下文）
        | 'tool-call';
      detail: Record<string, unknown>;
    }
  // project 字段仅老数据仍带（2026-10-10 拆除项目层后的读取兼容）——新写入不再产生
  | { seq?: number; ts: string; kind: 'meta'; title?: string; workDir?: string; project?: string };

export interface SessionIndexEntry {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
  /** 会话最后一次设置的 workDir（meta 事件；null = 未设置过）——对话列表一级分组 */
  workDir: string | null;
  /** 会话数据的实际落点（= 工作目录 = 项目根）。由 file 位置决定，不由 meta 决定 */
  home: string;
}

// ── 落点：项目目录 = 会话的家 ────────────────────────────────────────────

function sessionsDirOf(root: string): string {
  return join(resolve(root), SESSIONS_SUBDIR);
}
function sessionFileOf(root: string, id: string): string {
  return join(sessionsDirOf(root), `${id}.jsonl`);
}
function indexFileOf(root: string): string {
  return join(sessionsDirOf(root), 'index.json');
}

/** 路径归一（Windows 盘符/大小写不一致时同一个目录会算两个 root） */
function rootKey(p: string): string {
  const abs = resolve(p);
  return process.platform === 'win32' ? abs.toLowerCase() : abs;
}

let rootsCache: string[] | null = null;
let registryLock: Promise<void> = Promise.resolve();

/** 已知项目目录列表（注册表；内存缓存） */
export async function listRoots(): Promise<string[]> {
  if (rootsCache) return rootsCache;
  try {
    const raw = JSON.parse(await readFile(REGISTRY_FILE, 'utf8')) as unknown;
    rootsCache = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    rootsCache = [];
  }
  return rootsCache;
}

/** 同步读注册表（子 agent 落点解析用；不在热路径上，直接读文件） */
function listRootsSync(): string[] {
  if (rootsCache) return rootsCache;
  try {
    const raw = JSON.parse(readFileSync(REGISTRY_FILE, 'utf8')) as unknown;
    rootsCache = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    rootsCache = [];
  }
  return rootsCache;
}

/**
 * 登记工作目录（幂等）。**必须登记**，否则跨目录列表找不到这个目录里的会话。
 *
 * **写前先跟注册表对账**：同一目录的不同写法（`D:/a` vs `D:\a`、大小写、尾斜杠）
 * 只留**规范形式**一条——否则列表遍历两遍、前端还会长出两个同名组头（实测过）。
 * 认领动作请用 `claimWorkDir`（= 登记 + 目录索引对账）。
 */
export async function registerRoot(dir: string): Promise<string> {
  const abs = resolve(dir);
  const roots = await listRoots();
  if (roots.includes(abs)) return abs; // 已是规范形式且已登记 → 零写盘
  const run = registryLock.then(async () => {
    const cur = await listRoots();
    // 对账：剔掉同一目录的其它写法，再补规范形式
    const next = cur.filter((r) => rootKey(r) !== rootKey(abs));
    next.push(abs);
    rootsCache = next;
    await mkdir(dirname(REGISTRY_FILE), { recursive: true });
    await writeFile(REGISTRY_FILE, JSON.stringify(next, null, 2) + '\n', 'utf8');
  });
  registryLock = run.catch(() => {});
  await run;
  return abs;
}

/** 会话 id → 落点文件（含旧落点兼容） */
interface SessionLocation {
  file: string;
  root: string;
  /** 该落点对应的索引文件 */
  index: string;
}

/** 惰性会话的预订落点：id → 工作目录（文件尚未创建） */
interface PendingSession {
  root: string;
}
const pending = new Map<string, PendingSession>();
/** id → 落点解析缓存（失效点：创建、删除、迁移） */
const locCache = new Map<string, SessionLocation>();

/**
 * 解析会话的落点：先在已登记的项目目录里挨个试，再退到旧落点。
 * 解析不到 = 这个会话不存在（惰性会话没落盘、或所在目录已被删）。
 */
export async function resolveSessionLocation(id: string): Promise<SessionLocation | null> {
  const cached = locCache.get(id);
  if (cached && existsSync(cached.file)) return cached;
  for (const root of await listRoots()) {
    const file = sessionFileOf(root, id);
    if (existsSync(file)) {
      const loc: SessionLocation = { file, root, index: indexFileOf(root) };
      locCache.set(id, loc);
      return loc;
    }
  }
  return null;
}

/** 同步版（子 agent 落点；此时的会话必然已落盘或在预订里） */
function resolveSessionLocationSync(id: string): SessionLocation | null {
  const cached = locCache.get(id);
  if (cached && existsSync(cached.file)) return cached;
  for (const root of listRootsSync()) {
    const file = sessionFileOf(root, id);
    if (existsSync(file)) {
      const loc: SessionLocation = { file, root, index: indexFileOf(root) };
      locCache.set(id, loc);
      return loc;
    }
  }
  return null;
}

/** 会话是否可用（已落盘，或是尚未落盘的惰性会话） */
export async function sessionResolvable(id: string): Promise<boolean> {
  if (pending.has(id)) return true;
  return (await resolveSessionLocation(id)) !== null;
}

/**
 * 子 agent transcript 落点：<项目目录>/.vinart/sessions/agents/<sessionId>/<runId>/transcript.jsonl。
 * 按会话组织（不按 runId 平铺）——子 agent 的生命周期跟会话绑定，deleteSession 级联清理有明确边界。
 */
export function agentTranscriptPath(sessionId: string, runId: string): string {
  const loc = resolveSessionLocationSync(sessionId);
  if (!loc) throw new Error(`找不到会话 ${sessionId} 的落点——无法写子 agent 账本`);
  return join(dirname(loc.file), 'agents', sessionId, runId, 'transcript.jsonl');
}

/** 新会话 id(uuid;带前缀便于在日志/文件名里辨认) */
export function newSessionId(): string {
  return `sess_${crypto.randomUUID().slice(0, 8)}`;
}

// ── 写 ──────────────────────────────────────────────────────────────────

/**
 * 新建会话（**惰性**）：只分配 id 并登记落点，不写盘、不写索引——
 * 第一个事件落盘时才真正建文件，「空会话」因此在磁盘上不存在。
 * workDir 必填：一个会话的家就是它的工作目录（会话跟着目录走）。
 *
 * ⚠️ 这里**不 mkdir**：落点目录由 `appendEventInner` 在真正要写时才建。
 * 「选目录/建会话」都不得在用户目录里留下空文件夹（惰性会话的底线）。
 */
export async function createSession(workDir: string): Promise<string> {
  const id = newSessionId();
  const abs = await registerRoot(workDir);
  pending.set(id, { root: abs });
  return id;
}

/** 追加事件(自动建目录;同步更新索引;惰性会话在此落地) */
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
  const pend = pending.get(sessionId);
  const loc = pend
    ? {
        file: sessionFileOf(pend.root, sessionId),
        root: pend.root,
        index: indexFileOf(pend.root),
      }
    : await resolveSessionLocation(sessionId);
  if (!loc) {
    throw new Error(`找不到会话 ${sessionId} 的落点（未创建，或所在项目目录已被删除）`);
  }
  await mkdir(dirname(loc.file), { recursive: true });
  if (!existsSync(loc.file)) {
    // 诞生即绑：落盘的第一行是 meta（workDir 在这里固化成事件）
    await writeFile(
      loc.file,
      JSON.stringify({
        ts: new Date().toISOString(),
        kind: 'meta',
        workDir: loc.root,
      }) + '\n',
      'utf8',
    );
    pending.delete(sessionId);
    locCache.set(sessionId, loc);
  }
  await appendFile(loc.file, JSON.stringify(event as SessionEvent) + '\n', 'utf8');
  await touchIndex(loc, sessionId, event as SessionEvent);
}

// ── 读 ──────────────────────────────────────────────────────────────────

/** 读取事件流(按行序赋 seq;坏行——半截写入——跳过) */
export async function loadTranscript(sessionId: string): Promise<SessionEvent[]> {
  const loc = await resolveSessionLocation(sessionId);
  if (!loc) return [];
  return readEvents(loc.file);
}

/**
 * 按**文件路径**读事件流 —— reconcile / 迁移用：不经过 id→落点解析，
 * 因为「索引本身」就是待修正的对象，不能再依赖它去定位。
 */
async function readEvents(file: string): Promise<SessionEvent[]> {
  let raw = '';
  try {
    raw = await readFile(file, 'utf8');
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
      // 坏行（半截写入 / 进程中断）——跳过，不影响之前的事件
    }
  }
  return events;
}

async function readIndexFile(file: string): Promise<SessionIndexEntry[]> {
  try {
    const raw = JSON.parse(await readFile(file, 'utf8')) as unknown;
    return Array.isArray(raw) ? (raw as SessionIndexEntry[]) : [];
  } catch {
    return []; // 半截写入/手改坏——当空清单，下次落事件重建
  }
}

/**
 * **目录索引对账** —— 以事件流为准，把 `<root>/.vinart/sessions/index.json` 修正到一致。
 *
 * 索引是**缓存**（列表免重放），事件流才是持久层。缓存会漂：手拷目录、外部改动、
 * 早于 touchIndex 的历史数据、索引被截断……实测就撞到过 2 条会话的 `index.workDir`
 * 与 meta 不符（列表把它们显示在了错误的组下）。
 *
 * 三件事：补登（有文件没条目）、删幽灵（有条目没文件）、修正（字段与事件流不符）。
 * 不需要改动就不写盘（避免无谓地动 mtime）。
 */
export async function reconcileDirIndex(root: string): Promise<ReconcileReport> {
  const abs = resolve(root);
  const dir = sessionsDirOf(abs);
  const index = indexFileOf(abs);
  const report: ReconcileReport = { root: abs, added: [], dropped: [], fixed: [], total: 0 };
  // ⚠️ 认领**不建目录**：目录里还没有任何会话时，认领必须零副作用（惰性会话的底线）——
  // 否则「选一下目录」就在用户目录里留下一个空 `.vinart/sessions/`。
  // 没有落点目录 = 没有会话可对账，直接给空报告。
  if (!existsSync(dir)) return report;

  const old = await readIndexFile(index);
  const oldById = new Map(old.map((e) => [e.id, e]));
  const files = (await readdir(dir)).filter((f) => f.endsWith('.jsonl'));
  const next: SessionIndexEntry[] = [];

  for (const f of files) {
    const id = f.slice(0, -'.jsonl'.length);
    const events = await readEvents(join(dir, f));
    const latest = events.length > 0 ? events[events.length - 1] : null;
    const entry: SessionIndexEntry = {
      id,
      title: deriveTitle(events),
      updatedAt: latest?.ts ?? new Date(0).toISOString(),
      messageCount: countMessages(events),
      workDir: lastMetaField(events),
      home: abs,
    };
    const prev = oldById.get(id);
    if (!prev) report.added.push(id);
    else if (indexEntryDiffers(prev, entry)) report.fixed.push(id);
    oldById.delete(id);
    next.push(entry);
  }
  report.dropped = [...oldById.keys()];
  report.total = next.length;

  if (report.added.length === 0 && report.dropped.length === 0 && report.fixed.length === 0) {
    return report; // 已一致，零写盘
  }
  await withIndexLock(async () => {
    await mkdir(dirname(index), { recursive: true });
    await writeFile(
      index,
      JSON.stringify(next.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), null, 2) + '\n',
      'utf8',
    );
  });
  return report;
}

/** 索引条目是否与事件流不一致（只比会漂的字段；home 由落点决定，比它无意义） */
function indexEntryDiffers(a: SessionIndexEntry, b: SessionIndexEntry): boolean {
  return (
    a.title !== b.title ||
    a.messageCount !== b.messageCount ||
    a.updatedAt !== b.updatedAt ||
    (a.workDir ?? null) !== (b.workDir ?? null) ||
    (a.home ?? null) !== (b.home ?? null)
  );
}

export interface ReconcileReport {
  root: string;
  /** 磁盘上有文件、索引里没有 → 已补登 */
  added: string[];
  /** 索引里有、磁盘上已没有 → 已摘掉（幽灵） */
  dropped: string[];
  /** 两边都有但字段（标题/消息数/时间/workDir）与事件流不符 → 已按事件流修正 */
  fixed: string[];
  /** 对账后的会话总数 */
  total: number;
}

/**
 * **认领一个工作目录** —— 「选目录」这个动作的后端语义，两步：
 *   1. 登记进注册表（写前先和注册表对账，见 registerRoot）
 *   2. 对账该目录的会话索引（`reconcileDirIndex`）—— 打开一个已有数据的目录，
 *      立刻能看到里面真实存在的会话，而不是等你在那儿说第一句话才认回来。
 */
export async function claimWorkDir(dir: string): Promise<ReconcileReport> {
  const abs = await registerRoot(dir);
  return reconcileDirIndex(abs);
}

/**
 * 会话列表 = 遍历注册表里各目录的索引合并。
 * 只返回**有消息**的会话：惰性机制下无消息 = 还处于"新对话态"，不该占列表。
 */
export async function listSessions(): Promise<SessionIndexEntry[]> {
  const out: SessionIndexEntry[] = [];
  for (const root of await listRoots()) {
    for (const e of await readIndexFile(indexFileOf(root))) {
      if (e.messageCount > 0) out.push({ ...e, home: root });
    }
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** 删除会话：删文件 + 级联删子 agent 账本 + 从**它所在目录**的索引里摘掉 */
export async function deleteSession(sessionId: string): Promise<void> {
  const loc = await resolveSessionLocation(sessionId);
  pending.delete(sessionId);
  locCache.delete(sessionId);
  if (!loc) return; // 已经没有这个会话——视为已删
  try {
    await unlink(loc.file);
  } catch {
    /* 文件不存在——视为已删 */
  }
  // 级联：子 agent 账本目录与会话同生命周期（产物在 designs/ 不受影响）
  await rm(join(dirname(loc.file), 'agents', sessionId), { recursive: true, force: true });
  await withIndexLock(async () => {
    const list = await readIndexFile(loc.index);
    await mkdir(dirname(loc.index), { recursive: true });
    await writeFile(
      loc.index,
      JSON.stringify(list.filter((s) => s.id !== sessionId), null, 2) + '\n',
      'utf8',
    );
  });
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
          // 复用 gateway 的统一编码器（同一份 MIME 表与格式校验）
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

// ── 环境（workDir）──────────────────────────────────────────────────────

/** 未选工作目录时的缺省落点（旧约定,保持兼容——仅服务尚未绑定目录的老数据） */
export const DEFAULT_WORK_DIR = resolve('test_product');

/**
 * 会话的工作目录：**先看它实际落在哪个项目目录里**（这才是绑定的事实来源），
 * 老数据（文件还在旧落点）才退到"最后一条 workDir meta"→ 缺省 test_product。
 */
export async function getWorkDir(sessionId: string): Promise<string> {
  const loc = await resolveSessionLocation(sessionId);
  return loc?.root ?? DEFAULT_WORK_DIR;
}

/**
 * 设置工作目录 —— **只对尚未落盘的惰性会话有效**（创建时没传目录的兜底路径）。
 * 会话工作目录在创建时绑定、之后不可更改：换目录 = 新开会话。
 */
export async function setWorkDir(sessionId: string, dir: string): Promise<string> {
  const pend = pending.get(sessionId);
  if (!pend) {
    throw new Error('该会话的工作目录在创建时就已绑定，不可更改——要换目录请新建会话');
  }
  const abs = await registerRoot(dir);
  pending.set(sessionId, { root: abs });
  return abs;
}

// ── 索引 ────────────────────────────────────────────────────────────────

function countMessages(events: SessionEvent[]): number {
  return events.filter((e) => e.kind === 'message').length;
}

/** 事件流里最后一条 meta 的 workDir（会话环境的事实来源） */
function lastMetaField(events: SessionEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.kind === 'meta' && 'workDir' in e) {
      const v = (e as Record<string, unknown>).workDir;
      if (typeof v === 'string') return v;
    }
  }
  return null;
}

/** 索引条目 upsert:title/messageCount/workDir/home/updatedAt 以最新事件流为准 */
async function touchIndex(
  loc: SessionLocation,
  sessionId: string,
  latest: SessionEvent,
): Promise<void> {
  await withIndexLock(async () => {
    const events = await loadTranscript(sessionId);
    const list = await readIndexFile(loc.index);
    const entry: SessionIndexEntry = {
      id: sessionId,
      title: deriveTitle(events),
      updatedAt: latest.ts,
      messageCount: countMessages(events),
      workDir: lastMetaField(events),
      home: loc.root,
    };
    const idx = list.findIndex((s) => s.id === sessionId);
    if (idx >= 0) list[idx] = entry;
    else list.unshift(entry);
    await mkdir(dirname(loc.index), { recursive: true });
    await writeFile(
      loc.index,
      JSON.stringify(list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), null, 2) + '\n',
      'utf8',
    );
  });
}

/** 索引写互斥锁：index.json 的所有 read-modify-write 必须串行——
 *  否则并发 createSession/touchIndex/deleteSession 会互相覆盖条目（last-writer-wins，
 *  实测孤儿 jsonl 群的来源：打开页面自动建会话时代 StrictMode 双跑必触发）。 */
let indexLock: Promise<void> = Promise.resolve();
function withIndexLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = indexLock.then(fn);
  indexLock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
