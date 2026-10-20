import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Header } from './Header';
import { PreviewPanel } from './PreviewPanel';
import { ConversationPanel } from './ConversationPanel';
import { ArtifactGallery, artifactDataUrl } from './ArtifactGallery';
import { applyPatches, type DocPatch } from '../document/patch';
import { SessionListPanel } from './SessionListPanel';
import { DirectoryBrowser } from './DirectoryBrowser';
import { EditPanel } from './EditPanel';
import { ToolBar } from './ToolBar';
import { shouldFollowSelection, toolForLayer, type ToolId } from './tools';
import type { Message, DelegationRecord, ChatReference, MentionItem } from './types';
import type { PreviewData, HostSignal, SessionItem } from './types';
import { iterElements } from '../document/vocabulary';
import { fieldsFor, type SelectionSnapshot } from '../editor/inspector';
import { findElement, findLayer, type DesignDocument } from '../document/vocabulary';
import { createEditorStack, historyEntries, type EditorStack } from '../editor/editor-stack';

// ══════════════════════════════════════════════════════════
// ⚠️ Agent 层已清空，等待重新设计
// ══════════════════════════════════════════════════════════
//
// 旧的 agent 层（design-director / runner / worker + 结构化那套）
// 已整体移到 .backup/ 下，不在源码树中。
//
// 清空原因：
//   - Manager-Subagent 对话式协作依赖自然语言转述，设计意图每跳一次有损压缩
//   - @name 正则把控制流藏在散文里，任务文本 <10 字会被静默丢弃
//   - 多个 agent 共用同一个 chatContext，并行时 token 预算状态互撞
//
// 重建方向（待定）：代码编排的扁平管线，每步输入输出都是结构化对象，
// 可单独调用、单独验证。
//
// src/schema/（旧设计的合同产物，704 行纯类型）也已移入 .backup/：
//   - schema-*/copy-deck.ts / creative-brief.ts / image-asset.ts
//   - schema-*/slot-spec.ts / visual-direction.ts
//   删除理由：agent 层清空后全项目零引用；与当前「Listing 图方案」这一步无关。
//
// 参考 .backup/：
//   - agent-*/shared/prompt-builder.ts  → assemblePrompt（KV-cache 前缀复用）
//   - agent-*/art-director/prompt.ts    → 视觉方向 prompt（135 行，有复用价值）
//   - agent-*/designer/prompt.ts        → 结构化字段注入 prompt 的正确范式
//   - test-agent-*/                     → 各 agent 的输入输出契约
//   - run-scripts-*/                    → 单步验证脚本（可改造为验证工具）
//
// ══════════════════════════════════════════════════════════

/** agent 层清空后，这里暂时没有可用的生成能力 */
const AGENT_LAYER_EMPTY = true;

/**
 * 本浏览器用过的工作目录（最近 8 个）。**这是启动自愈的燃料**：
 * 会话数据住在工作目录里（删目录即删会话，零清理），但「机器上有哪些目录」
 * 只能靠一个中央指针文件（`~/.vinart/workdirs.json`）——它丢了/换机器，
 * 数据还在盘上、侧栏却是空的。所以每次选目录都记一笔，下次打开页面时
 * 逐个报给后端认领，把会话自动找回来（不用一个个手动重选）。
 */
const RECENT_WORKDIRS_KEY = 'vinart.recentWorkDirs';
function rememberWorkDir(dir: string): void {
  try {
    const list = (JSON.parse(localStorage.getItem(RECENT_WORKDIRS_KEY) ?? '[]') as string[]).filter(
      (d) => d !== dir,
    );
    list.unshift(dir);
    localStorage.setItem(RECENT_WORKDIRS_KEY, JSON.stringify(list.slice(0, 8)));
  } catch {
    /* 隐私模式/配额——记不住就算了，不影响正常使用 */
  }
}
function rememberedWorkDirs(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_WORKDIRS_KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** 工具调用账本事件 → 一行摘要（实时 SSE 与刷新重放共用同一格式，前后一致） */
function formatToolLine(d: { name?: unknown; ok?: unknown; ms?: unknown; result?: unknown }): string {
  const name = String(d.name ?? '?');
  const mark = d.ok ? '✓' : '✗';
  const ms = typeof d.ms === 'number' ? ` ${d.ms >= 1000 ? (d.ms / 1000).toFixed(1) + 's' : d.ms + 'ms'}` : '';
  const res = String(d.result ?? '');
  const brief = res ? ' → ' + res.slice(0, 120) + (res.length > 120 ? '…' : '') : '';
  return `🔧 ${name} ${mark}${ms}${brief}`;
}

/**
 * 版式 API 的 URL。**保存/重渲必须带 session**——服务端靠它定位
 * `<workDir>/designs/<name>`；缺失就会退回仓库硬编码 `test_product/layout/<name>`，
 * 表现为「改了、保存了、工作目录里的图没变」。客户端拼 URL 统一走这里。
 * （2026-10-10 项目层拆除：不再需要 &project=。）
 */
function layoutApiUrl(
  cur: { name: string },
  action: 'save' | 'render' | 'data',
  sessionId: string | null,
): string {
  const q = new URLSearchParams();
  if (sessionId) q.set('session', sessionId);
  const s = q.toString();
  return `/api/layout/${cur.name}/${action}${s ? `?${s}` : ''}`;
}

export function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  // 生成中标记：SSE 流的真实开合状态（handleSend 里置起、流结束/异常置回）。
  // ⚠️ 改造前这里是写死的 `useState(false)` —— 连 spinner 都不可能出现。
  const [isGenerating, setIsGenerating] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  /** 产物可能有新图时 +1,画廊据此重新拉清单 */
  const [galleryKey, setGalleryKey] = useState(0);
  /**
   * ⭐ **当前工具**（左栏选中的那个）—— 决定右侧检查器显示哪一页字段。
   *
   * 与"选中了哪个节点"是两件独立的维度：工具定"改哪一类"，选中定"改谁"。
   */
  const [tool, setTool] = useState<ToolId>('select');

  // ── 会话层(多会话 + 持久化;id 贯穿前端/API/转录文件)──
  const [sessionId, setSessionId] = useState<string | null>(() =>
    localStorage.getItem('vinart.sessionId'),
  );
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  /** 当前会话的工作目录(📂 设置;null=未设置,落缺省 test_product) */
  const [workDir, setWorkDir] = useState<string | null>(null);
  /** 已注册的 chat 模型名（服务端 /api/models）——工具条上显示"当前模型"，不硬编码 */
  const [chatModels, setChatModels] = useState<string[]>([]);

  async function refreshSessions() {
    try {
      setSessions((await (await fetch('/api/sessions')).json()) as SessionItem[]);
    } catch {
      /* API 没跑——忽略,会话条显示空 */
    }
  }

  /**
   * **认领工作目录** = 「选目录」这个动作的完整语义（后端：登记注册表 + 对账目录索引）。
   * 登记只影响「列表能不能看见」，不参与聊天链路 —— 失败不阻塞，只记一笔。
   */
  async function claimWorkDir(dir: string) {
    rememberWorkDir(dir);
    try {
      await fetch('/api/workdirs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dir }),
      });
    } catch {
      /* API 没跑——忽略 */
    }
    await refreshSessions();
  }

  /**
   * 启动自愈：把本浏览器记得的工作目录逐个报给后端认领。
   * 必须在**取列表之前**跑完——否则注册表丢失时，存档的 sessionId 不在列表里，
   * 会被当成「会话已不存在」而丢掉（用户看到的是"我的对话全没了"）。
   */
  async function reclaimRememberedDirs() {
    const dirs = rememberedWorkDirs();
    if (dirs.length === 0) return;
    await Promise.all(
      dirs.map((d) =>
        fetch('/api/workdirs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dir: d }),
        }).catch(() => undefined),
      ),
    );
  }

  /**
   * 拉某会话的持久事件流并合成 UI 消息（log 类内存消息丢弃——换会话=换上下文）。
   * agent-spawn / agent-result 事件聚成「委派卡片」消息，按时间轴插在对话流里：
   * 首个 spawn 开卡片（id 取其 runId），同批次后续 result 归入同卡片。
   */
  async function loadSessionMessages(id: string) {
    try {
      const data = (await (await fetch(`/api/sessions/${id}`)).json()) as {
        events: Array<{
          kind: string;
          id?: string;
          role?: string;
          text?: string;
          action?: string;
          detail?: Record<string, unknown>;
          /** 助手消息的整轮耗时（含工具）；老数据无此字段 → 不渲染计时 */
          durationMs?: number;
        }>;
        /** 服务端 session meta 记录的当前版式（set-active / 上一轮 chat） */
        activeLayout?: string | null;
      };
      const out: Message[] = [];
      let card: Message | null = null;
      const flush = () => {
        if (card) out.push(card);
        card = null;
      };
      for (const e of data.events) {
        if (e.kind === 'message') {
          flush();
          out.push({
            id: e.id ?? crypto.randomUUID(),
            role: (e.role as 'user' | 'assistant') ?? 'assistant',
            text: e.text ?? '',
            // 历史回放复原耗时（用户要求刷新/切会话后仍显示「用时 X s」）
            ...(typeof e.durationMs === 'number' ? { durationMs: e.durationMs } : {}),
          });
        } else if (e.kind === 'action' && e.action === 'agent-spawn') {
          flush();
          const d = e.detail ?? {};
          card = {
            id: `delegation_${String(d.runId ?? crypto.randomUUID())}`,
            role: 'assistant',
            text: '',
            delegations: [{
              name: (d.name as string) ?? undefined,
              agent: String(d.label ?? '子 agent'),
              task: String(d.brief ?? ''),
              status: 'running',
            }],
          };
        } else if (e.kind === 'action' && e.action === 'agent-result') {
          const d = e.detail ?? {};
          const rec: DelegationRecord = {
            name: (d.name as string) ?? undefined,
            agent: String(d.label ?? '子 agent'),
            task: '',
            status: d.stopReason === 'completed' ? 'done' : 'failed',
            result:
              d.stopReason === 'completed'
                ? String(d.summary ?? '完成')
                : String(d.diagnostic ?? d.stopReason ?? '失败'),
          };
          if (card) {
            const i = card.delegations!.findIndex((x) => x.agent === rec.agent && x.status === 'running');
            if (i >= 0) card.delegations![i] = rec;
            else card.delegations!.push(rec);
          } else {
            card = {
              id: `delegation_${String(d.runId ?? crypto.randomUUID())}`,
              role: 'assistant',
              text: '',
              delegations: [rec],
            };
          }
        } else if (e.kind === 'action' && e.action === 'tool-call') {
          // 主 AI 工具循环的中间轮：一行 log 摘要（与实时 SSE 'tool' 同格式）
          flush();
          out.push({
            id: `tool_${crypto.randomUUID()}`,
            role: 'assistant',
            kind: 'log',
            text: formatToolLine(e.detail ?? {}),
          });
        }
        // 其他 action（open-layout/save-spec/render/pipeline-*）历史不进对话流
      }
      flush();
      setMessages(out);
      // 恢复服务端记录的 active：有就打开；没有就空预览（不自动开最近/唯一）
      const active = data.activeLayout;
      if (typeof active === 'string' && active) {
        void openLayoutByName(active, id);
      } else {
        commitLayout(null as unknown as PreviewData);
      }
    } catch {
      /* 忽略 */
    }
  }

  // ── 待用环境（harness 的 create 参数模型）：无会话时用户选的 workDir
  // 只缓存在前端（+localStorage），建会话那一刻作为创建参数落成 meta 事件——
  // 「设目录」是写环境变量，不是开对话。环境独立于会话存活。
  // 2026-10-10：项目层拆除，环境里只剩 workDir 一项。
  const PENDING_ENV_KEY = 'vinart.pendingEnv';
  const [pendingEnv, setPendingEnv] = useState<{ workDir?: string }>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(PENDING_ENV_KEY) ?? '{}') as { workDir?: string };
      return raw.workDir ? { workDir: raw.workDir } : {};
    } catch {
      return {};
    }
  });
  const savePendingEnv = (env: { workDir?: string }) => {
    setPendingEnv(env);
    localStorage.setItem(PENDING_ENV_KEY, JSON.stringify(env));
  };

  // 初始化:① 启动自愈（认领记得的目录）② 取列表 ③ 恢复存档会话 / 回到「无会话」态
  useEffect(() => {
    void (async () => {
      try {
        await reclaimRememberedDirs();
        const list = (await (await fetch('/api/sessions')).json()) as SessionItem[];
        setSessions(list);
        const saved = localStorage.getItem('vinart.sessionId');
        if (saved && list.some((s) => s.id === saved)) {
          setSessionId(saved);
          await loadSessionMessages(saved);
          const wd = await fetchWorkDir(saved);
          setWorkDir(wd);
          if (wd) rememberWorkDir(wd); // 自愈燃料：下次注册表丢了也能把它认回来
          return;
        }
        // 惰性会话：恢复不了就保持无会话空态，**不自动创建**——
        // 打开/浏览页面零成本，第一次真的发消息时才建（handleSend）。
        // （此前「打开即建」在 StrictMode 双跑竞态下还会一次建俩）
        localStorage.removeItem('vinart.sessionId');
        setSessionId(null);
        setWorkDir(pendingEnv.workDir ?? null);
      } catch {
        /* API 没跑——会话条空,消息区显示占位 */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 取「当前用的模型」——来自服务端注册表（keys.json），UI 只做展示不做选择
  useEffect(() => {
    void (async () => {
      try {
        const data = (await (await fetch('/api/models')).json()) as { chat?: string[] };
        setChatModels(Array.isArray(data.chat) ? data.chat : []);
      } catch {
        /* API 没跑——工具条不显示模型名 */
      }
    })();
  }, []);

  /** 切换会话：环境跟会话走（清掉待用缓存——它只属于「还没建」的下一个会话） */
  const handleSwitchSession = useCallback(async (id: string) => {
    localStorage.setItem('vinart.sessionId', id);
    sessionIdRef.current = id;
    setSessionId(id);
    setSelectedLayer(null);
    savePendingEnv({});
    // 先清空；active 由 loadSessionMessages 按服务端记录恢复（没有就保持空）
    commitLayout(null as unknown as PreviewData);
    await loadSessionMessages(id);
    const wd = await fetchWorkDir(id);
    setWorkDir(wd);
    if (wd) rememberWorkDir(wd); // 自愈燃料
  }, []);

  /**
   * 新对话（惰性）：只清空到「无会话」空态，不创建。
   * 环境延续：当前显示的 workDir 写入待用缓存，作为下一个新会话的创建参数。
   */
  const handleNewSession = useCallback(
    (envOverride?: { workDir?: string }) => {
      localStorage.removeItem('vinart.sessionId');
      sessionIdRef.current = null;
      setSessionId(null);
      setSelectedLayer(null);
      setMessages([]);
      commitLayout(null as unknown as PreviewData);
      // envOverride（组头 ✎）= 预填该目录；无参 = 沿用当前显示环境
      const env = envOverride ?? (workDir ? { workDir } : {});
      savePendingEnv(env);
      setWorkDir(env.workDir ?? null);
    },
    [workDir],
  );

  /**
   * 惰性会话的创建点：发第一条消息前确保有会话。
   * 此时待用环境（workDir）**成为会话的绑定**并写进诞生 meta——之后不可更改。
   * 没选工作目录直接拒绝：会话跟着目录走，没有目录就没有家（产物也无处可放）。
   */
  const ensureSession = useCallback(async (): Promise<string> => {
    const existing = sessionId;
    if (existing) return existing;
    if (!pendingEnv.workDir) {
      throw new Error('请先选择工作目录——会话跟着目录走，没选目录不允许开始对话');
    }
    rememberWorkDir(pendingEnv.workDir); // 自愈燃料
    const r = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workDir: pendingEnv.workDir }),
    });
    if (!r.ok) throw new Error(`创建会话失败：HTTP ${r.status}`);
    const { id } = (await r.json()) as { id: string };
    localStorage.setItem('vinart.sessionId', id);
    sessionIdRef.current = id;
    setSessionId(id);
    savePendingEnv({});
    await refreshSessions();
    return id;
  }, [sessionId, pendingEnv, refreshSessions]);

  /** 删除会话(列表 🗑):confirm → DELETE → 刷新列表;删的是当前会话则自动新建 */
  const handleDeleteSession = useCallback(
    async (id: string, title: string) => {
      if (
        !confirm(
          `删除会话「${title}」？\n只删除对话记录与工具账本；产物（designs/ 等磁盘文件）全部保留。`,
        )
      )
        return;
      try {
        const resp = await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}:${(await resp.text()).trim()}`);
        await refreshSessions();
        if (id === sessionId) await handleNewSession();
      } catch (e) {
        setMessages((prev) => [
          ...prev,
          { id: crypto.randomUUID(), role: 'assistant', text: `✗ 删除失败:${(e as Error).message}` },
        ]);
      }
    },
    [sessionId, refreshSessions, handleNewSession],
  );

  /** 编辑器操作入会话流(打开版式/保存/重渲——设计历史与对话历史同流) */
  const logSessionAction = useCallback(
    (action: string, detail: Record<string, unknown>) => {
      const sid = localStorage.getItem('vinart.sessionId');
      if (!sid) return;
      void fetch(`/api/sessions/${sid}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'action', action, detail, ts: new Date().toISOString() }),
      }).catch(() => {});
    },
    [],
  );

  // ── 版式编辑状态(产物点击 → 加载 → 逐元素修改 → 保存/重渲)──
  const [layout, setLayout] = useState<PreviewData | null>(null);
  const [layoutBusy, setLayoutBusy] = useState(false);
  /** 选中的图层(检查器与 iframe 双向同步) */
  const [selectedLayer, setSelectedLayer] = useState<string | null>(null);
  /**
   * ⭐ **形状工具当前选的种类**（矩形/椭圆/多边形/路径）。
   *
   * 工具栏**右键**弹出的菜单、和形状页里的**枚举**，改的都是**这一个 state**
   * —— 右键只是快捷方式，不存在"两处不一致"。拖画时宿主用它决定建哪种节点。
   */
  const [shapeKind, setShapeKind] = useState<'rect' | 'ellipse' | 'polygon' | 'path'>('rect');
  /**
   * ⭐ **文字选区快照**（在画面上拖选了几个字）。
   *
   * 由编辑器的 `onSelectionChange` 推上来（编辑器内部做了指纹比对，只在真变了时报）。
   * `null` = 没在选字 ⇒ 面板那一栏收起来。
   */
  const [selection, setSelection] = useState<SelectionSnapshot | null>(null);
  /** 宿主→iframe 的统一信号(面板发起的选中/patch;图上操作不走这里防回环) */
  const [hostSignal, setHostSignal] = useState<HostSignal | null>(null);
  const seqRef = useRef(0);

  /**
   * ⭐ **工具页跟着选中自动跳**（规则 A：只在"当前页跟这个节点**毫无关系**"时才跳）。
   *
   * 这样在「选择」页调位置，选中任何东西都不会被跳走；但在「文字」页误点了一张图片，
   * 会自动跳到「图片」页。`选择` / `图层` 是全局页，**永不**自动跳（见 `tools.ts`）。
   *
   * ⚠️ 用 ref 记住"这次选中已处理过"：否则你**手动**点一个当前节点没字段的页时，
   *    这个 effect 会立刻把你弹走 —— 手动选择就失效了。
   */
  const jumpedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!layout || !selectedLayer) return;
    if (jumpedFor.current === selectedLayer) return;
    jumpedFor.current = selectedLayer;
    // ⚠️ 找的是**元素**：`doc.layers` 现在是图层，元素在 `Layer.elements` 里。
    //    选中的是**图层本身**时这里返回 null ⇒ 跳过（图层的属性面板是第二步的事）。
    const node = findElement(layout.doc, selectedLayer);
    if (!node) return;
    // ⚠️ **「形状」页是"创建页"，永不自动跳走**（用户 2026-10-17 报的问题）。
    //    原因：`GROUP_TOOL` / `FIELD_TOOL` 里**没有任何字段映射到 `'shape'`** ——
    //    对任何节点来说这一页都是"毫无关系的页"，于是一画完（`addElement` 会自动
    //    选中新节点）就判定"该跳走"，跳去 `appearance`（形状第一个字段 fill 属「外观」）
    //    ⇒ 想连着画就得每次都手动点回来。
    //    ⚠️ 不能笼统地"有 `adds` 的页都不跳"：注释里那条反例是**期望行为**
    //      （在「文字」页误点了一张图片 ⇒ 自动跳到「图片」页）。
    if (tool !== 'shape' && shouldFollowSelection(fieldsFor(node, layout.doc.canvas), tool)) {
      setTool(toolForLayer(node));
    }
    // `tool` 故意不进依赖：只在**选中变化**时判断，不然手动换页会被立刻弹回
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLayer, layout]);

  /** 权威数据引用 + 防抖自动保存(1.5s 无操作静默写盘,刷新页面不丢) */
  const layoutRef = useRef<PreviewData | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  /**
   * 当前 sessionId 的**同步镜像**。
   * `setSessionId` 是异步的：新建会话时这一轮 SSE 回调的闭包里还是旧的 null，
   * 用它去拉 /data / 写 set-active / 自动保存都会落到 null 或旧会话。
   * 所有"这一轮就要用"的地方读 ref，state 只负责渲染。
   */
  const sessionIdRef = useRef<string | null>(sessionId);
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  function commitLayout(next: PreviewData) {
    layoutRef.current = next;
    setLayout(next);
  }

  function scheduleAutoSave() {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void autoSaveNow();
    }, 1500);
  }

  async function autoSaveNow() {
    const cur = layoutRef.current;
    const sid = sessionIdRef.current;
    if (!cur || !sid) return;
    try {
      await fetch(layoutApiUrl(cur, 'save', sid), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doc: cur.doc }),
      });
    } catch {
      /* 静默:网络抖动时下次操作会再触发 */
    }
  }

  /**
   * 工具**就地**改当前版式（doc-patch）：
   * - `patches`：应用到当前内存 doc → 保留用户尚未自动保存的改动；
   * - `doc`：整体替换（宿主 / 其他工具；`sketch_plan` 现在只新建，不再走这里）；
   * - 不重挂编辑器；DOM 由 PreviewPanel 的同步 effect 更新；
   * - 这里只换内存 doc + 触发自动保存。
   */
  function applyDocPatch(data: {
    layout?: unknown;
    doc?: unknown;
    patches?: unknown;
    assets?: unknown;
  }) {
    const name = typeof data.layout === 'string' ? data.layout : '';
    const cur = layoutRef.current;
    if (!cur || cur.name !== name) return;

    let nextDoc: PreviewData['doc'] | null = null;
    if (Array.isArray(data.patches)) {
      const r = applyPatches(cur.doc, data.patches as DocPatch[]);
      if (r.errors.length) {
        console.warn('[doc-patch] 应用失败', r.errors);
        return;
      }
      nextDoc = r.doc;
    } else if (data.doc && typeof data.doc === 'object') {
      nextDoc = data.doc as PreviewData['doc'];
    }
    if (!nextDoc) return;

    // 新引用素材的 URL（generate_assets 刚生成的文件）——合并进当前 assets，
    // 否则 PreviewPanel 就地重发图层时拿不到文件地址（刷新 /data 后才对）。
    const newAssets =
      data.assets && typeof data.assets === 'object'
        ? (data.assets as Record<string, string>)
        : null;
    commitLayout({
      ...cur,
      doc: nextDoc,
      ...(newAssets ? { assets: { ...cur.assets, ...newAssets } } : {}),
    });
    scheduleAutoSave();
  }

  /** 当前版式的元素 → 输入框 `@` 候选 */
  const mentionItems = useMemo<MentionItem[]>(() => {
    const doc = layout?.doc;
    const layoutName = layout?.name;
    if (!doc || !layoutName) return [];
    return doc.layers.flatMap((l) =>
      [...iterElements(l)]
        .filter((e) => e.type !== 'group')
        .map((e) => ({
          layout: layoutName,
          id: e.id,
          name: e.name ?? e.id,
          type: e.type,
        })),
    );
  }, [layout]);

  /**
   * ⭐ **编辑动作只更新 doc + 自动保存；DOM 由编辑器 / PreviewPanel 就地同步。**
   *
   * 这里**绝不再 `emitDocument` / 换 `srcdoc`**：整页重渲会换掉 iframe 的 document
   * ⇒ 编辑器必须重建（文字态 / 光标 / 当前图层全丢），与「就地改 DOM + 双写 doc」
   * 的路线直接冲突。
   *
   * 结构性差异（增删 / 排序 / 显隐 / 撤销重做）由 PreviewPanel 的同步 effect 用
   * `emitLayerHtml` / `emitElementHtml` **就地**补 —— 和整页 emit 是同一段代码产的
   * HTML（自包含），所以不会和产物漂。
   */
  const handleLayerChanged = useCallback(
    (_id: string, next: DesignDocument, _label?: string) => {
      const prev = layoutRef.current;
      if (!prev) return;
      setHistTick((n) => n + 1); // 栈变了 ⇒ 历史页要重画（见 setHistTick 的注释）
      commitLayout({ ...prev, doc: next });
      scheduleAutoSave();
    },
    [sessionId],
  );

  /** 打字（就地补 DOM）⇒ 只存 + 自动保存，不重渲 */
  const handleTypingChanged = useCallback(
    (_id: string, next: DesignDocument) => {
      const prev = layoutRef.current;
      if (!prev) return;
      commitLayout({ ...prev, doc: next });
      scheduleAutoSave();
    },
    [],
  );

  /** 参数面板改单字段 ⇒ 发信号给编辑器（数据由编辑器的 onChange 统一回流，防双写） */
  const handleLayerPatch = useCallback((id: string, path: string, value: unknown) => {
    seqRef.current += 1;
    setHostSignal({ seq: seqRef.current, type: 'patch', id, path, value });
  }, []);

  /**
   * ⭐ 给画面上**选中的那几个字**刷样式。
   *
   * 面板给的是 `(path, value)`（`path` 来自 `selectionFields()`）——
   * px → 0–1 换算、装饰线的逐项合并都在编辑器里做，这一层只转发。
   */
  const handleSelectionStyle = useCallback((path: string, value: unknown) => {
    seqRef.current += 1;
    setHostSignal({ seq: seqRef.current, type: 'style-selection', path, value });
  }, []);

  /**
   * ⭐ **当前图层** —— "新增元素进哪一层"，同时也是编辑器里**唯一能被选中的范围**
   * （PS「自动选择：关闭」/ Procreate 那个概念，用户 2026-10-17 定）。
   *
   * ⚠️ **只有"点图层行 / 新建图层"会改它**；点元素**不影响**它 ⇒ 所以它**不能**
   *    从 `selectedLayer` 派生（点元素时 `selectedLayer` 是元素 id）。
   * ⚠️ 权威在**编辑器**里（它拿这个做选中门禁，见 `vocab-editor` 的 `currentLayerId`）。
   *    这一份只用于**面板画阴影**；两边同一条规则（只有点图层才变、失效则回退到
   *    "最上层的可见未锁图层"）⇒ 同进同退。
   */
  const [currentLayerId, setCurrentLayerId] = useState<string | null>(null);

  /**
   * ⭐ **每个产物一份撤销栈**，由宿主持有（2026-10-17）。
   *
   * 为什么放在宿主而不是编辑器里：编辑器是**跟着 iframe 重建**的（换版式、重渲都要重建），
   * 挂在它身上 ⇒ **切到别的产物再切回来，历史就没了** ✗
   * ⇒ 栈按**产物名**存在这里，编辑器创建时**注入**进去（`opts.stack`）。
   *
   * ⚠️ 用 `useRef` 不用 state：栈变化**不需要**触发渲染（它是编辑器内部数据）。
   */
  const stacksRef = useRef(new Map<string, EditorStack>());

  /**
   * ⭐ **历史列表的重渲计数**。
   *
   * ⚠️ 撤销栈在 `stacksRef`（**ref**）里 ⇒ 改它**不会触发渲染** ⇒ 历史页会一直是
   *    打开那一刻的样子 ✗ 所以每次文档变化都 `+1`，逼一次重渲。
   *    （值本身不用，所以解构时丢掉 ✓）
   */
  const [, setHistTick] = useState(0);

  /** 取某个产物的栈（没有就按这份文档新建）—— 传给 `PreviewPanel`，它 `bind()` 时注入编辑器 */
  const getStack = useCallback((name: string, base: DesignDocument): EditorStack => {
    let s = stacksRef.current.get(name);
    if (!s) {
      s = createEditorStack(base);
      stacksRef.current.set(name, s);
    }
    return s;
  }, []);
  const handleLayerSelect = useCallback((id: string) => {
    setSelectedLayer(id);
    // 选中的是**图层** ⇒ 它成为当前图层；选中元素 ⇒ 不动当前图层
    const doc = layoutRef.current?.doc;
    if (id && doc && findLayer(doc, id)) setCurrentLayerId(id);
  }, []);

  /**
   * 面板上要画阴影的那一层 = 当前图层；它若**已不存在**（被删 / 被撤销掉）
   * ⇒ 回退到「最上层的可见未锁图层」（与编辑器的自愈规则**同一条**）。
   * 就这么几行、图层数量很少 ⇒ 直接算，不值得 `useMemo`。
   */
  const effectiveCurrentLayer = (() => {
    const doc = layout?.doc;
    if (!doc) return null;
    if (currentLayerId && findLayer(doc, currentLayerId)) return currentLayerId;
    for (let i = doc.layers.length - 1; i >= 0; i -= 1) {
      const l = doc.layers[i];
      if (l.visible !== false && l.locked !== true) return l.id;
    }
    return doc.layers.length ? doc.layers[doc.layers.length - 1].id : null;
  })();

  /**
   * 当前图层是否**被锁定** —— 新增（拖画 / 按钮）要**提前**反映它，
   * 否则就是"画了/点了但什么都没发生"那种静默失败（锁定的意思就是别改它）。
   */
  const currentLayerLocked = !!(
    layout?.doc &&
    effectiveCurrentLayer &&
    findLayer(layout.doc, effectiveCurrentLayer)?.locked === true
  );

  /** 打开产物:fetch data(会话工作目录模式带 session query) */
  const handleOpenArtifact = useCallback(
    async (url: string, name: string, _dir: string, sidOverride?: string) => {
      const sid = sidOverride ?? sessionIdRef.current;
      if (!sid) return;
      setPreviewUrl(url); // 兜底:数据没到之前先给 PNG
      try {
        const dataUrl = artifactDataUrl(sid, name);
        // 网络失败自动重试一次（覆盖「8787 刚重启」的窗口期——点开瞬间服务未就绪）
        let resp: Response | null = null;
        let lastErr: Error | null = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const r = await fetch(dataUrl);
            if (r.ok || r.status < 500) {
              resp = r;
              break;
            }
            lastErr = new Error(`HTTP ${r.status}`);
          } catch (e) {
            lastErr = e as Error; // 连接失败（服务重启中）→ 等 800ms 重试
          }
          if (attempt === 0) await new Promise((r) => setTimeout(r, 800));
        }
        if (!resp) throw lastErr ?? new Error('fetch failed');
        if (!resp.ok) {
          // 静默失败会让用户困惑「为什么停在图片」——如实说明
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: 'assistant',
              text: `⚠️ 「${name}」没有可编辑的版式数据（HTTP ${resp.status}），预览保持图片。常见原因：还没有生成 doc.json，或项目路径不匹配。`,
            },
          ]);
          return;
        }
        const data = (await resp.json()) as PreviewData;
        if (!data.html) {
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: 'assistant',
              text: `⚠️ 「${name}」的版式数据里没有 html，预览保持图片。`,
            },
          ]);
          return;
        }
        commitLayout(data);
        setSelectedLayer(null);
        logSessionAction('open-layout', { layout: name });
        // 记录 active：session 不存在时服务端返回 noSession（客户端内存已更新，等首条 /chat 落）
        void fetch(`/api/sessions/${sid}/active`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ layout: name }),
        }).catch(() => {});
      } catch (e) {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            text: `✗ 打开「${name}」失败:${(e as Error).message}——API 服务未运行?预览保持图片。`,
          },
        ]);
      }
    },
    [logSessionAction],
  );

  /** 打开/刷新当前会话的版式（来自 AI 工具事件；没有 PNG URL，直接拉 data） */
  const openLayoutByName = useCallback(
    async (name: string, sidOverride?: string) => {
      await handleOpenArtifact('', name, '', sidOverride);
    },
    [handleOpenArtifact],
  );

  /**
   * **常驻事件流**：服务端**主动推**的那些事（现在只有 `artifacts` —— 出图/草图写入
   * ⇒ 画廊重拉 + 预览区打开对应版式）。
   *
   * ⚠️ 在此之前前端**没有任何常驻通道**：`/chat` 那条 SSE 只活一轮对话。
   *    于是"**别人**出了图"（直接 `POST /api/layout/<n>/render`，或别的工具）
   *    前端完全不知道 ⇒ 画廊要等下次对话结束、或者手动 F5。
   *
   * `EventSource` **自带断线重连**（含服务重启），所以这里只管收摊，不用写重试。
   */
  useEffect(() => {
    if (!sessionId) return;
    const es = new EventSource(`/api/sessions/${sessionId}/stream`);
    const onArtifacts = (ev: MessageEvent) => {
      setGalleryKey((k) => k + 1);
      try {
        const data = JSON.parse(ev.data) as { layout?: unknown; open?: unknown };
        // open=false（系列里的新图）只刷画廊，不抢预览、不重挂编辑器
        if (data.open !== false && typeof data.layout === 'string' && data.layout) {
          void openLayoutByName(data.layout);
        }
      } catch {
        /* 非 JSON 也照常刷画廊 */
      }
    };
    const onDocPatch = (ev: MessageEvent) => {
      try {
        applyDocPatch(JSON.parse(ev.data) as { layout?: unknown; doc?: unknown });
      } catch {
        /* 忽略坏事件 */
      }
    };
    es.addEventListener('artifacts', onArtifacts);
    es.addEventListener('doc-patch', onDocPatch);
    return () => {
      es.removeEventListener('artifacts', onArtifacts);
      es.removeEventListener('doc-patch', onDocPatch);
      es.close();
    };
  }, [sessionId, openLayoutByName]);

  /**
   * 📂 设置工作目录。
   * - 无会话 = 纯前端缓存环境（建会话时落成 meta 事件），**并立即认领该目录**：
   *   「选目录」这个动作本身就让列表能看见那个目录里已有的会话，不用等你说第一句话。
   * - 有会话 = 只对尚未落盘的惰性会话有效（服务端 409，一旦绑定就不可改）。
   */
  const handleSetWorkDir = useCallback(
    async (dir: string) => {
      if (!sessionId) {
        savePendingEnv({ workDir: dir });
        setWorkDir(dir);
        await claimWorkDir(dir); // 选目录即登记（+ 目录索引对账）
        return;
      }
      try {
        const resp = await fetch(`/api/sessions/${sessionId}/workdir`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workDir: dir }),
        });
        if (!resp.ok) throw new Error((await resp.text()).trim() || `HTTP ${resp.status}`);
        const { workDir: abs } = (await resp.json()) as { workDir: string };
        setWorkDir(abs);
        // 目录变了:当前打开的版式属于旧位置,清掉(回到缩略图重选)
        commitLayout(null as unknown as PreviewData);
        setPreviewUrl(null);
        setGalleryKey((k) => k + 1);
        setMessages((prev) => [
          ...prev,
          { id: crypto.randomUUID(), role: 'assistant', text: `📂 工作目录已设为:${abs}\n产物将保存在这里。` },
        ]);
      } catch (e) {
        setMessages((prev) => [
          ...prev,
          { id: crypto.randomUUID(), role: 'assistant', text: `✗ 设置工作目录失败:${(e as Error).message}` },
        ]);
      }
    },
    [sessionId],
  );

  /** 读取当前会话的工作目录(切会话/初始化时) */
  async function fetchWorkDir(sid: string): Promise<string | null> {
    try {
      const r = (await (await fetch(`/api/sessions/${sid}/workdir`)).json()) as { workDir?: string };
      return r.workDir ?? null;
    } catch {
      return null;
    }
  }

  /** 📂 打开应用内目录浏览器(DSH 式:后端列目录,前端渲染,拿真实路径) */
  const [dirBrowserOpen, setDirBrowserOpen] = useState(false);

  // ── 右栏宽度:拖左缘手柄调整,localStorage 持久化 ──
  // 右栏在右、手柄在左缘:向左拖(clientX 变小)= 变宽。上下限防拖没/拖满屏。
  const RIGHT_COL_MIN = 320;
  const RIGHT_COL_MAX = 720;
  const [rightColWidth, setRightColWidth] = useState<number>(() => {
    const v = Number(localStorage.getItem('vinart.rightColWidth'));
    return Number.isFinite(v) && v >= RIGHT_COL_MIN && v <= RIGHT_COL_MAX ? v : 400;
  });
  // ── 右栏收起/展开:开关贴右栏左缘外,收起时 width→0(带过渡),状态持久化 ──
  const [rightColCollapsed, setRightColCollapsed] = useState<boolean>(() =>
    localStorage.getItem('vinart.rightColCollapsed') === '1',
  );
  const toggleRightCol = useCallback(() => {
    setRightColCollapsed((c) => {
      localStorage.setItem('vinart.rightColCollapsed', c ? '0' : '1');
      return !c;
    });
  }, []);
  // ── 左侧对话列表:宽度可拖拽 + 收起/展开(镜像右栏那套) ──
  const LEFT_COL_MIN = 180;
  const LEFT_COL_MAX = 480;
  const [leftColWidth, setLeftColWidth] = useState<number>(() => {
    const v = Number(localStorage.getItem('vinart.leftColWidth'));
    return Number.isFinite(v) && v >= LEFT_COL_MIN && v <= LEFT_COL_MAX ? v : 230;
  });
  // ⚠️ **默认收起**（只有明确存过 `'0'` = 用户展开过，才展开）——
  //    会话列表是"偶尔切一下"的东西，不该占着最左边一条。
  const [leftColCollapsed, setLeftColCollapsed] = useState<boolean>(() =>
    localStorage.getItem('vinart.leftColCollapsed') !== '0',
  );
  const toggleLeftCol = useCallback(() => {
    setLeftColCollapsed((c) => {
      localStorage.setItem('vinart.leftColCollapsed', c ? '0' : '1');
      return !c;
    });
  }, []);
  // ── 检查器栏（版式编辑器）:独立一栏,贴画布右侧;镜像右栏那套 ──
  // 2026-10-10 从 .right-col 搬出来——编辑器与对话不再同栏。
  // 折叠只有这一层：EditPanel 内部那层「‹ 版式编辑 ›」已随之删除。
  const INSPECTOR_MIN = 240;
  const INSPECTOR_MAX = 560;
  const [inspectorColWidth, setInspectorColWidth] = useState<number>(() => {
    const v = Number(localStorage.getItem('vinart.inspectorColWidth'));
    return Number.isFinite(v) && v >= INSPECTOR_MIN && v <= INSPECTOR_MAX ? v : 320;
  });
  const [inspectorColCollapsed, setInspectorColCollapsed] = useState<boolean>(() =>
    localStorage.getItem('vinart.inspectorColCollapsed') === '1',
  );
  const toggleInspectorCol = useCallback(() => {
    setInspectorColCollapsed((c) => {
      localStorage.setItem('vinart.inspectorColCollapsed', c ? '0' : '1');
      return !c;
    });
  }, []);
  // 拖拽调宽期间关掉宽度/位置过渡(否则拖拽发粘)——state 驱动 .main.resizing
  const [isResizingCol, setIsResizingCol] = useState(false);
  const resizeRef = useRef<{ startX: number; startW: number } | null>(null);
  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsResizingCol(true);
      resizeRef.current = { startX: e.clientX, startW: rightColWidth };
      // 拖拽期间禁文本选中(不然鼠标扫过内容一片蓝),结束恢复
      document.body.style.userSelect = 'none';
      const onMove = (ev: MouseEvent) => {
        const s = resizeRef.current;
        if (!s) return;
        // 右栏在右、手柄在左缘:向左拖(clientX 变小)= 变宽
        setRightColWidth(Math.min(RIGHT_COL_MAX, Math.max(RIGHT_COL_MIN, s.startW + (s.startX - ev.clientX))));
      };
      const onUp = (ev: MouseEvent) => {
        const s = resizeRef.current;
        if (s) {
          const w = Math.min(RIGHT_COL_MAX, Math.max(RIGHT_COL_MIN, s.startW + (s.startX - ev.clientX)));
          localStorage.setItem('vinart.rightColWidth', String(w));
        }
        resizeRef.current = null;
        setIsResizingCol(false);
        document.body.style.userSelect = '';
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [rightColWidth],
  );

  /** 左栏拖拽(镜像右栏):手柄贴左栏右缘,向右拖(clientX 变大)= 变宽 */
  const handleResizeStartLeft = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsResizingCol(true);
      resizeRef.current = { startX: e.clientX, startW: leftColWidth };
      document.body.style.userSelect = 'none';
      const onMove = (ev: MouseEvent) => {
        const s = resizeRef.current;
        if (!s) return;
        setLeftColWidth(Math.min(LEFT_COL_MAX, Math.max(LEFT_COL_MIN, s.startW + (ev.clientX - s.startX))));
      };
      const onUp = (ev: MouseEvent) => {
        const s = resizeRef.current;
        if (s) {
          const w = Math.min(LEFT_COL_MAX, Math.max(LEFT_COL_MIN, s.startW + (ev.clientX - s.startX)));
          localStorage.setItem('vinart.leftColWidth', String(w));
        }
        resizeRef.current = null;
        setIsResizingCol(false);
        document.body.style.userSelect = '';
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [leftColWidth],
  );

  /** 检查器栏拖拽(镜像右栏):手柄贴它左缘,向左拖(clientX 变小)= 变宽 */
  const handleResizeStartInspector = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsResizingCol(true);
      resizeRef.current = { startX: e.clientX, startW: inspectorColWidth };
      document.body.style.userSelect = 'none';
      const onMove = (ev: MouseEvent) => {
        const s = resizeRef.current;
        if (!s) return;
        setInspectorColWidth(
          Math.min(INSPECTOR_MAX, Math.max(INSPECTOR_MIN, s.startW + (s.startX - ev.clientX))),
        );
      };
      const onUp = (ev: MouseEvent) => {
        const s = resizeRef.current;
        if (s) {
          const w = Math.min(INSPECTOR_MAX, Math.max(INSPECTOR_MIN, s.startW + (s.startX - ev.clientX)));
          localStorage.setItem('vinart.inspectorColWidth', String(w));
        }
        resizeRef.current = null;
        setIsResizingCol(false);
        document.body.style.userSelect = '';
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [inspectorColWidth],
  );

  const handlePickDir = useCallback(() => {
    setDirBrowserOpen(true);
  }, []);
  const handleDirPicked = useCallback(
    async (path: string) => {
      setDirBrowserOpen(false);
      await handleSetWorkDir(path);
    },
    [handleSetWorkDir],
  );

  /** 保存编辑改动落盘(spec/appearance)——手动按钮触发 */
  const handleSaveLayoutLive = useCallback(async () => {
    const cur = layoutRef.current;
    if (!cur) return;
    setLayoutBusy(true);
    try {
      const resp = await fetch(layoutApiUrl(cur, 'save', sessionId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doc: cur.doc }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      logSessionAction('save-doc', { layout: cur.name });
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: 'assistant', text: `💾 已保存 ${cur.name} 的版式文档` },
      ]);
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: 'assistant', text: `✗ 保存失败:${(e as Error).message}` },
      ]);
    } finally {
      setLayoutBusy(false);
    }
  }, [sessionId]);

  /** 触发 final 重渲(几秒,零 API),完成后刷新画廊与 PNG 预览 */
  const handleRenderLayoutLive = useCallback(async () => {
    const cur = layoutRef.current;
    if (!cur) return;
    setLayoutBusy(true);
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: 'assistant', text: `⟳ 重渲 ${cur.name} → final…` },
    ]);
    try {
      const resp = await fetch(layoutApiUrl(cur, 'render', sessionId), { method: 'POST' });
      const result = (await resp.json()) as { ok: boolean; log?: string };
      if (result.ok) {
        setGalleryKey((k) => k + 1);
        // 成品落在版式目录里，走会话文件 API 取（一个工作目录就是一个项目）
        setPreviewUrl(
          sessionId
            ? `/api/sessions/${sessionId}/file/designs/${cur.name}/final.png?t=${Date.now()}`
            : `/files/test_product/layout/${cur.name}/final.png?t=${Date.now()}`,
        );
        logSessionAction('render', { layout: cur.name });
        setMessages((prev) => [
          ...prev,
          { id: crypto.randomUUID(), role: 'assistant', text: '✓ 重渲完成,成品已更新' },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            kind: 'log',
            text: `✗ 重渲失败\n${result.log ?? ''}`,
          },
        ]);
      }
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: 'assistant', text: `✗ 重渲请求失败:${(e as Error).message}` },
      ]);
    } finally {
      setLayoutBusy(false);
    }
  }, [layout, sessionId]);

  /** 发消息:走会话层 LLM 对话(SSE 流式),消息持久化在服务端转录里 */
  /**
   * 贴图 → 发给模型用的 dataURL。大图先压缩：截图是常态（高分屏全屏 PNG 常 >10MB），
   * 而 VLM 看图不需要原始分辨率——长边压到 2048px / JPEG 0.85，body 从十几 MB 降到 <1MB。
   * 小图（≤3MB 且长边 ≤2048）原样传，保留 PNG 透明度与原始质量；
   * 解码失败（不支持的格式）也原样传，交给后端校验报错。
   */
  const toChatImageDataURL = useCallback(async (file: File): Promise<string> => {
    const raw = await new Promise<string>((ok, err) => {
      const r = new FileReader();
      r.onload = () => ok(String(r.result));
      r.onerror = () => err(r.error ?? new Error('读取图片失败'));
      r.readAsDataURL(file);
    });
    try {
      const bmp = await createImageBitmap(file);
      const long = Math.max(bmp.width, bmp.height);
      if (long > 2048 || file.size > 3 * 1024 * 1024) {
        const scale = Math.min(1, 2048 / long);
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(bmp.width * scale));
        c.height = Math.max(1, Math.round(bmp.height * scale));
        const ctx = c.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#ffffff'; // JPEG 无透明通道，先铺白底
          ctx.fillRect(0, 0, c.width, c.height);
          ctx.drawImage(bmp, 0, 0, c.width, c.height);
          const out = c.toDataURL('image/jpeg', 0.85);
          if (out.length < raw.length) return out;
        }
      }
    } catch {
      /* 原样上传 */
    }
    return raw;
  }, []);

  const handleSend = useCallback(
    async (text: string, files?: File[], references?: ChatReference[]) => {
      if (!text.trim() && !files?.length) return;
      // 惰性会话的创建点：无会话时此刻建一个（打开/浏览页面从不产生会话）
      let sid: string;
      try {
        sid = await ensureSession();
        // ensureSession 里 setSessionId 是异步的；这一轮 SSE 回调要用同步 ref。
        sessionIdRef.current = sid;
      } catch (e) {
        setMessages((prev) => [
          ...prev,
          { id: crypto.randomUUID(), role: 'assistant', text: `⚠️ ${(e as Error).message}——API 服务未运行?` },
        ]);
        return;
      }
      const attachments = (files ?? []).map((f) => URL.createObjectURL(f));
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'user',
          // 纯贴图（无文字）时气泡也要有内容可显示；图片本体用附件缩略图展示
          text: text || `📎 图片×${files?.length ?? 0}`,
          ...(attachments.length ? { attachments } : {}),
          ...(references?.length ? { references } : {}),
        },
      ]);
      const replyId = crypto.randomUUID();
      // startedAt 用于生成中的实时计时；流结束由 'done' 事件的 durationMs 定格
      setMessages((prev) => [
        ...prev,
        { id: replyId, role: 'assistant', text: '', reasoning: '', startedAt: Date.now(), streaming: true },
      ]);
      setIsGenerating(true);
      const setReply = (fn: (t: string) => string) =>
        setMessages((prev) => prev.map((m) => (m.id === replyId ? { ...m, text: fn(m.text) } : m)));
      // 委派进度卡片：SSE 'agent' 事件（子 agent spawn/result）实时更新本条回复的 delegations
      const applyAgentEvent = (data: {
        kind?: string;
        label?: string;
        name?: string;
        brief?: string;
        stopReason?: string;
        summary?: string | null;
        diagnostic?: string | null;
      }) => {
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== replyId) return m;
            const delegations = [...(m.delegations ?? [])];
            if (data.kind === 'agent-spawn') {
              delegations.push({
                name: data.name,
                agent: data.label ?? '子 agent',
                task: data.brief ?? '',
                status: 'running',
              });
            } else if (data.kind === 'agent-result') {
              const rec: DelegationRecord = {
                name: data.name,
                agent: data.label ?? '子 agent',
                task: delegations.find((d) => d.agent === data.label && d.status === 'running')?.task ?? '',
                status: data.stopReason === 'completed' ? 'done' : 'failed',
                result:
                  data.stopReason === 'completed'
                    ? data.summary ?? '完成'
                    : data.diagnostic ?? data.stopReason ?? '失败',
              };
              const i = delegations.findIndex((d) => d.agent === rec.agent && d.status === 'running');
              if (i >= 0) delegations[i] = rec;
              else delegations.push(rec);
            }
            return { ...m, delegations };
          }),
        );
      };
      try {
        // 图片压缩后转 dataURL——与后端 chat 端点的 images 契约对应
        const images: string[] = [];
        for (const f of files ?? []) {
          images.push(await toChatImageDataURL(f));
        }
        const resp = await fetch(`/api/sessions/${sid}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            ...(images.length ? { images } : {}),
            activeLayout: layout?.name ?? null,
            ...(references?.length ? { references } : {}),
          }),
        });
        if (!resp.ok || !resp.body) {
          // 后端 400 的具体原因（如"超过 20MB"）直接展示给用户，不吞
          const detail = await resp.text().catch(() => '');
          throw new Error(`HTTP ${resp.status}${detail ? `：${detail.trim()}` : ''}`);
        }
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buf.indexOf('\n\n')) >= 0) {
            const frame = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const lines = frame.split('\n');
            const evLine = lines.find((l) => l.startsWith('event: '));
            const dataLine = lines.find((l) => l.startsWith('data: '));
            if (!dataLine) continue;
            const ev = evLine?.slice(7) ?? '';
            const data = JSON.parse(dataLine.slice(6)) as {
              content?: string;
              message?: string;
              full?: boolean;
              durationMs?: number;
            };
            if (ev === 'chunk' && data.content) setReply((t) => t + data.content);
            // 思考链：流式期逐段追加；终章（full=true）整段覆盖成权威全文
            if (ev === 'reasoning' && data.content) {
              const text = data.content;
              const isFull = data.full === true;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === replyId
                    ? { ...m, reasoning: isFull ? text : (m.reasoning ?? '') + text }
                    : m,
                ),
              );
            }
            // 收尾：定格耗时、解除"生成中"（计时器停表、显示「用时 X s」）
            if (ev === 'done') {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === replyId
                    ? { ...m, streaming: false, durationMs: data.durationMs ?? (Date.now() - (m.startedAt ?? Date.now())) }
                    : m,
                ),
              );
            }
            if (ev === 'agent') applyAgentEvent(data as Parameters<typeof applyAgentEvent>[0]);
            // 主 AI 工具调用中间轮：实时插一行 log 摘要（刷新后由账本重放同格式）
            if (ev === 'tool') {
              setMessages((prev) => [
                ...prev,
                {
                  id: `tool_${crypto.randomUUID()}`,
                  role: 'assistant',
                  kind: 'log',
                  text: formatToolLine(data as Record<string, unknown>),
                },
              ]);
            }
            // 工具产出新图/草图 → 实时刷画廊；只有 open!==false 才打开/刷新预览
            if (ev === 'artifacts') {
              setGalleryKey((k) => k + 1);
              const a = data as { layout?: unknown; open?: unknown };
              if (a.open !== false && typeof a.layout === 'string' && a.layout) {
                void openLayoutByName(a.layout, sid);
              }
            }
            // 工具就地改当前版式 → 不重挂编辑器
            if (ev === 'doc-patch') {
              applyDocPatch(data as { layout?: unknown; doc?: unknown });
            }
            if (ev === 'error') throw new Error(data.message ?? 'unknown');
          }
        }
        void refreshSessions(); // 标题可能已随首条消息更新
        setGalleryKey((k) => k + 1); // 兜底：流结束后无论如何刷一次（事件丢失也不漏图）
      } catch (e) {
        setReply((t) => t + `\n\n✗ ${(e as Error).message}`);
        setGalleryKey((k) => k + 1); // 异常收尾同样兜底（工具可能已落了部分产物）
        // 异常路径下 'done' 不会来 → 计时器必须手动停表，否则永远走表
        setMessages((prev) =>
          prev.map((m) =>
            m.id === replyId
              ? { ...m, streaming: false, durationMs: Date.now() - (m.startedAt ?? Date.now()) }
              : m,
          ),
        );
      } finally {
        // 无论正常/异常收尾都要解除生成中——否则输入区永久 spinner + 按钮禁用
        setIsGenerating(false);
      }
    },
    [sessionId, ensureSession, layout, refreshSessions, toChatImageDataURL, openLayoutByName],
  );

  // 供 UI 判断：agent 层(对话式生成)是否可用
  void AGENT_LAYER_EMPTY;

  return (
    <div className="app">
      <Header />
      <ArtifactGallery
            refreshKey={galleryKey}
            sessionId={sessionId}
            onOpen={handleOpenArtifact}
          />
      <div className={`main${isResizingCol ? ' resizing' : ''}`}>
        {/* ⭐ 主工具栏：**最左一栏**（44px 固定宽）。上面 6 个是工具（单选，决定检查器显示哪一页），
            下面 4 个是动作（撤销/重做/保存/出图）—— 动作只此一处入口。 */}
        <ToolBar
          tool={tool}
          onTool={setTool}
          busy={layoutBusy}
          onSignal={(sig) => {
            seqRef.current += 1;
            setHostSignal({ seq: seqRef.current, ...sig });
          }}
          onSave={handleSaveLayoutLive}
          onRender={handleRenderLayoutLive}
          shapeKind={shapeKind}
          onShapeKind={setShapeKind}
        />
        {/* 左侧对话列表:宽度可拖拽(localStorage 持久化),收起时 width→0,开关贴屏左缘;图标竖线靠左=侧栏在左 */}
        <button
          type="button"
          className={`left-toggle${leftColCollapsed ? ' collapsed' : ''}`}
          // ⚠️ 要**让开工具栏**（最左 `--toolbar-w` 那一条），否则收起时会正好压在第一格工具上
          style={{ left: `calc(var(--toolbar-w, 44px) + ${leftColCollapsed ? 10 : leftColWidth + 10}px)` }}
          onClick={toggleLeftCol}
          title={leftColCollapsed ? '展开对话列表' : '收起对话列表'}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="1.5" y="2.5" width="13" height="11" rx="2.5" stroke="currentColor" strokeWidth="1.5" />
            <line x1="5.5" y1="4" x2="5.5" y2="12" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
        <SessionListPanel
          width={leftColWidth}
          sessions={sessions}
          activeSessionId={sessionId}
          collapsed={leftColCollapsed}
          envWorkDir={workDir}
          onSwitch={handleSwitchSession}
          onDelete={handleDeleteSession}
          onNew={handleNewSession}
          onResizeStart={handleResizeStartLeft}
        />
        <PreviewPanel
          previewUrl={previewUrl}
          layoutData={layout}
          sessionId={sessionId}
          fontFamilies={layout?.fontFamilies}
          fontLabels={layout?.fontLabels}
          onLayerChange={handleLayerChanged}
          onTypingChange={handleTypingChanged}
          onLayerSelect={handleLayerSelect}
          onSelectionChange={setSelection}
          hostSignal={hostSignal}
          // ⭐ 面板高亮的那层 = 编辑器的当前图层。**必须传**：iframe 重渲会新建编辑器，
          //    不带过去的话新实例默认回最上层，而面板还高亮着旧那层（"选了图层点不动"）。
          currentLayerId={effectiveCurrentLayer}
          // ⭐ 形状工具 = **绘制模式**（工具即模式，PS 同款）：画布上盖一层绘制层，
          //    拖一个框就画出来；这一层同时挡住"选元素/拖元素"（故意的，避免误触）。
          // ⚠️ **当前图层被锁定 ⇒ 不挂载绘制层**：变成"画布上没有十字光标、拖不动"，
          //    而不是"能拖、松手后什么都没有"（后者最迷惑）。
          drawMode={tool === 'shape' && !currentLayerLocked}
          shapeKind={shapeKind}
          // ⭐ 撤销栈按产物名由宿主持有（切走再切回，历史还在）
          getStack={getStack}
        />
        {/* 检查器栏（版式编辑器）—— **独立一栏**，贴画布右侧；无版式时不占位。
            2026-10-10 从 .right-col 里搬出来：编辑器与对话不再同栏。
            开关贴在检查器左缘外（+36 是收起时躲开右栏开关的偏移）。 */}
        {layout && (
          <>
            <button
              type="button"
              className={`inspector-toggle${inspectorColCollapsed ? ' collapsed' : ''}`}
              style={{
                right:
                  (rightColCollapsed ? 10 : rightColWidth + 10) +
                  (inspectorColCollapsed ? 36 : inspectorColWidth + 10),
              }}
              onClick={toggleInspectorCol}
              title={inspectorColCollapsed ? '展开版式编辑' : '收起版式编辑'}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <rect x="1.5" y="2.5" width="13" height="11" rx="2.5" stroke="currentColor" strokeWidth="1.5" />
                <line x1="10.5" y1="4" x2="10.5" y2="12" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </button>
            <div
              className={`inspector-col${inspectorColCollapsed ? ' collapsed' : ''}`}
              style={{ width: inspectorColCollapsed ? 0 : inspectorColWidth }}
            >
              {/* 拖拽手柄:贴左缘的窄条,按住左右拖调检查器宽度 */}
              {!inspectorColCollapsed && (
                <div className="inspector-resizer" onMouseDown={handleResizeStartInspector} title="拖拽调整检查器宽度" />
              )}
              <EditPanel
                layout={layout}
                selectedLayer={selectedLayer}
                currentLayerId={effectiveCurrentLayer}
                // ⭐ 历史页的数据（栈在 ref 里 ⇒ 靠 histTick 的重渲刷新）
                // ⚠️ 栈可能是**还没创建**（编辑器还没 bind）⇒ 必须守卫，
                //    否则 `historyEntries(undefined)` 会抛异常把整个页面弄崩 ✗（实测踩过）
                history={(() => {
                  const s = layout?.name ? stacksRef.current.get(layout.name) : undefined;
                  return s ? historyEntries(s) : [];
                })()}
                onGotoStep={(i) => {
                  seqRef.current += 1;
                  setHostSignal({ seq: seqRef.current, type: 'goto-step', index: i });
                }}
                onRemoveHistoryStep={(i) => {
                  seqRef.current += 1;
                  setHostSignal({ seq: seqRef.current, type: 'remove-history', index: i });
                }}
                shapeKind={shapeKind}
                onShapeKind={setShapeKind}
                selection={selection}
                busy={layoutBusy}
                tool={tool}
                onSelectLayer={(id) => {
                  setSelectedLayer(id);
                  seqRef.current += 1;
                  setHostSignal({ seq: seqRef.current, type: 'select', id });
                }}
                onLayerPatch={handleLayerPatch}
                onSelectionStyle={handleSelectionStyle}
                onSignal={(sig) => {
                  seqRef.current += 1;
                  setHostSignal({ seq: seqRef.current, ...sig });
                }}
              />
            </div>
          </>
        )}
        {/* 右栏开关:贴右栏左缘外悬浮,收起时滑到屏幕右缘;图标竖线靠右=侧栏在右,收起时镜像 */}
        <button
          type="button"
          className={`right-toggle${rightColCollapsed ? ' collapsed' : ''}`}
          style={{ right: rightColCollapsed ? 10 : rightColWidth + 10 }}
          onClick={toggleRightCol}
          title={rightColCollapsed ? '展开侧栏' : '收起侧栏'}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="1.5" y="2.5" width="13" height="11" rx="2.5" stroke="currentColor" strokeWidth="1.5" />
            <line x1="10.5" y1="4" x2="10.5" y2="12" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
        <div className="right-col" style={{ width: rightColCollapsed ? 0 : rightColWidth }}>
          {/* 拖拽手柄:贴左缘的窄条,hover 高亮;按住左右拖调右栏宽度 */}
          {!rightColCollapsed && (
          <div className="right-resizer" onMouseDown={handleResizeStart} title="拖拽调整右栏宽度" />
          )}
          <DirectoryBrowser
            open={dirBrowserOpen}
            onPick={handleDirPicked}
            onClose={() => setDirBrowserOpen(false)}
          />
          <ConversationPanel
            messages={messages}
            isGenerating={isGenerating}
            onSend={handleSend}
            mentions={mentionItems}
            workDir={workDir}
            dirLocked={sessionId !== null}
            modelName={chatModels[0] ?? null}
            onPickDir={handlePickDir}
            onSetWorkDir={handleSetWorkDir}
          />
        </div>
      </div>
    </div>
  );
}
