import { useState, useCallback, useRef, useEffect } from 'react';
import { Header } from './Header';
import { PreviewPanel } from './PreviewPanel';
import { ConversationPanel } from './ConversationPanel';
import { ArtifactGallery, artifactDataUrl } from './ArtifactGallery';
import { SessionListPanel } from './SessionListPanel';
import { DirectoryBrowser } from './DirectoryBrowser';
import { EditPanel } from './EditPanel';
import type { Message, DelegationRecord } from './types';
import type { LayoutData, HostSignal, LayerAppearance, SessionItem } from './types';

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
 * 版式 API 的 URL。**保存/重渲必须带 session+project**——服务端靠它定位
 * `<workDir>/<project>/designs/<name>`；缺失就会退回硬编码 `test_product/layout/<name>`，
 * 表现为「改了、保存了、项目里的图没变」，同名版式还会覆盖仓库里的副本（实测事故）。
 */
function layoutApiUrl(
  cur: { name: string; project: string | null },
  action: 'save' | 'render',
  sessionId: string | null,
): string {
  const q = new URLSearchParams();
  if (sessionId) q.set('session', sessionId);
  if (cur.project) q.set('project', cur.project);
  const s = q.toString();
  return `/api/layout/${cur.name}/${action}${s ? `?${s}` : ''}`;
}

export function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedElements, setSelectedElements] = useState<Set<string>>(new Set());
  // 旧 run/pipeline 的生成中标记。聊天发送暂不互斥（SSE 流由后端会话锁保护）。
  const [isGenerating] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [htmlCode] = useState<string | undefined>(undefined);
  /** 产物可能有新图时 +1,画廊据此重新拉清单 */
  const [galleryKey, setGalleryKey] = useState(0);

  // ── 会话层(多会话 + 持久化;id 贯穿前端/API/转录文件)──
  const [sessionId, setSessionId] = useState<string | null>(() =>
    localStorage.getItem('vinart.sessionId'),
  );
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  /** 当前会话的工作目录(📂 设置;null=未设置,落缺省 test_product) */
  const [workDir, setWorkDir] = useState<string | null>(null);

  async function refreshSessions() {
    try {
      setSessions((await (await fetch('/api/sessions')).json()) as SessionItem[]);
    } catch {
      /* API 没跑——忽略,会话条显示空 */
    }
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
        }>;
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
    } catch {
      /* 忽略 */
    }
  }

  // ── 项目层:工作目录下按项目分组产物(切换 = 会话 meta,聚合展示) ──
  const [projects, setProjects] = useState<Array<{ name: string; displayName: string }>>([]);
  const [currentProject, setCurrentProject] = useState<string | null>(null);

  // ── 待用环境（harness 的 create 参数模型）：无会话时用户设置的 workDir/project
  // 只缓存在前端（+localStorage），建会话那一刻作为创建参数落成 meta 事件——
  // 「设目录」是写环境变量，不是开对话。环境独立于会话存活。
  const PENDING_ENV_KEY = 'vinart.pendingEnv';
  const [pendingEnv, setPendingEnv] = useState<{ workDir?: string; project?: string; projectDisplayName?: string }>(() => {
    try {
      return JSON.parse(localStorage.getItem(PENDING_ENV_KEY) ?? '{}');
    } catch {
      return {};
    }
  });
  const savePendingEnv = (env: { workDir?: string; project?: string; projectDisplayName?: string }) => {
    setPendingEnv(env);
    localStorage.setItem(PENDING_ENV_KEY, JSON.stringify(env));
  };

  // 初始化:有存档 id 且在列表里 → 恢复;否则新建
  useEffect(() => {
    void (async () => {
      try {
        const list = (await (await fetch('/api/sessions')).json()) as SessionItem[];
        setSessions(list);
        const saved = localStorage.getItem('vinart.sessionId');
        if (saved && list.some((s) => s.id === saved)) {
          setSessionId(saved);
          await loadSessionMessages(saved);
          setWorkDir(await fetchWorkDir(saved));
          void fetchProjects(saved);
          return;
        }
        // 惰性会话：恢复不了就保持无会话空态，**不自动创建**——
        // 打开/浏览页面零成本，第一次真的发消息时才建（handleSend）。
        // （此前「打开即建」在 StrictMode 双跑竞态下还会一次建俩）
        localStorage.removeItem('vinart.sessionId');
        setSessionId(null);
        setSessions(list);
        // 环境是前端缓存的（pendingEnv），无会话时照常显示——目录/项目不随会话消失
        const env = pendingEnv;
        if (env.workDir) {
          setWorkDir(env.workDir);
          if (env.project) setCurrentProject(env.project);
          try {
            const pr = (await (await fetch(`/api/projects?dir=${encodeURIComponent(env.workDir)}`)).json()) as {
              projects?: Array<{ name: string; displayName: string }>;
            };
            setProjects(pr.projects ?? []);
          } catch {
            /* 清单拉不到不阻塞 */
          }
        }
      } catch {
        /* API 没跑——会话条空,消息区显示占位 */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 切换会话：环境跟会话走（清掉待用缓存——它只属于「还没建」的下一个会话） */
  const handleSwitchSession = useCallback(async (id: string) => {
    localStorage.setItem('vinart.sessionId', id);
    setSessionId(id);
    setSelectedLayer(null);
    setActiveWord(null);
    savePendingEnv({});
    await loadSessionMessages(id);
    setWorkDir(await fetchWorkDir(id));
    void fetchProjects(id);
    commitLayout(null as unknown as LayoutData);
  }, []);

  /**
   * 新对话（惰性）：只清空到「无会话」空态，不创建。
   * 环境延续：当前显示的 workDir/project 写入待用缓存，作为下一个新会话的创建参数。
   */
  const handleNewSession = useCallback(
    (envOverride?: { workDir?: string; project?: string; projectDisplayName?: string }) => {
      localStorage.removeItem('vinart.sessionId');
      setSessionId(null);
      setSelectedLayer(null);
      setActiveWord(null);
      setMessages([]);
      commitLayout(null as unknown as LayoutData);
      // envOverride（组头 ✎）= 预填该组环境；无参 = 沿用当前显示环境
      const env =
        envOverride ?? {
          ...(workDir ? { workDir } : {}),
          ...(currentProject
            ? {
                project: currentProject,
                projectDisplayName: projects.find((p) => p.name === currentProject)?.displayName,
              }
            : {}),
        };
      savePendingEnv(env);
      setWorkDir(env.workDir ?? null);
      setCurrentProject(env.project ?? null);
      // 预填的 workDir 与当前显示不同 → 项目清单按新目录重拉（sessionless）。
      // 环境里携带的新项目（目录组 ✎ 刚建、还没注册）必须并回去——
      // 新目录在服务端查出来是空清单，直接覆盖会把刚 append 的组抹掉
      if (env.workDir && env.workDir !== workDir) {
        fetch(`/api/projects?dir=${encodeURIComponent(env.workDir)}`)
          .then((r) => r.json())
          .then((d: { projects?: Array<{ name: string; displayName: string }> }) => {
            const list = d.projects ?? [];
            const proj = env.project;
            if (proj && !list.some((x) => x.name === proj)) {
              list.push({ name: proj, displayName: env.projectDisplayName ?? proj });
            }
            setProjects(list);
          })
          .catch(() => {});
      }
      // workDir/currentProject/projects 同步为预填环境——新对话延续显示
    },
    [workDir, currentProject, projects],
  );

  /** 目录组头 ✎：在工作目录下新建项目——**提交即注册**（文件夹+索引立即落盘，
   *  用户在文件管理器里可先看到/先放素材），然后清单 append + 环境预填 + 新对话态。 */
  const handleNewProject = useCallback(
    async (dir: string, name: string, displayName?: string) => {
      try {
        const resp = await fetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dir, name, displayName }),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}:${(await resp.text()).trim()}`);
      } catch (e) {
        setMessages((prev) => [
          ...prev,
          { id: crypto.randomUUID(), role: 'assistant', text: `✗ 新建项目失败:${(e as Error).message}` },
        ]);
        return;
      }
      setProjects((prev) => [
        ...prev.filter((p) => p.name !== name),
        { name, displayName: displayName ?? name },
      ]);
      handleNewSession({ workDir: dir, project: name, projectDisplayName: displayName ?? name });
    },
    [handleNewSession],
  );

  /** 惰性会话的创建点：发第一条消息前确保有会话；待用环境此刻落成 meta。返回可用的 sessionId */
  const ensureSession = useCallback(async (): Promise<string> => {
    const existing = sessionId;
    if (existing) return existing;
    const r = await fetch('/api/sessions', { method: 'POST' });
    if (!r.ok) throw new Error(`创建会话失败：HTTP ${r.status}`);
    const { id } = (await r.json()) as { id: string };
    localStorage.setItem('vinart.sessionId', id);
    setSessionId(id);
    // 无会话时用户设置的环境（前端缓存）此刻正式归档到会话
    if (pendingEnv.workDir) {
      await fetch(`/api/sessions/${id}/workdir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workDir: pendingEnv.workDir }),
      }).catch(() => {});
    }
    if (pendingEnv.project) {
      await fetch(`/api/sessions/${id}/project`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: pendingEnv.project, displayName: pendingEnv.projectDisplayName }),
      }).catch(() => {});
    }
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
  const [layout, setLayout] = useState<LayoutData | null>(null);
  const [layoutBusy, setLayoutBusy] = useState(false);
  /** 选中的图层(检查器与 iframe 双向同步) */
  const [selectedLayer, setSelectedLayer] = useState<string | null>(null);
  /** 当前激活的染色词(点图上染色片段切换;面板单行颜色跟随它) */
  const [activeWord, setActiveWord] = useState<string | null>(null);
  /** 宿主→iframe 的统一信号(面板发起的选中/patch;图上操作不走这里防回环) */
  const [hostSignal, setHostSignal] = useState<HostSignal | null>(null);
  const seqRef = useRef(0);

  /** 权威数据引用 + 防抖自动保存(1.5s 无操作静默写盘,刷新页面不丢) */
  const layoutRef = useRef<LayoutData | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);

  function commitLayout(next: LayoutData) {
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
    if (!cur) return;
    try {
      await fetch(layoutApiUrl(cur, 'save', sessionId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spec: cur.spec, appearance: cur.appearance }),
      });
    } catch {
      /* 静默:网络抖动时下次操作会再触发 */
    }
  }

  function mergePatch(prev: LayoutData, id: string, patch: Record<string, unknown>): LayoutData {
    const spec = { ...prev.spec, layers: prev.spec.layers.slice() };
    const li = spec.layers.findIndex((x) => x.id === id);
    if (li < 0) return prev;
    const merged = { ...spec.layers[li] } as Record<string, unknown>;
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'rect' && typeof v === 'object' && v)
        merged.rect = { ...(merged.rect as object), ...(v as object) };
      else merged[k] = v;
    }
    spec.layers[li] = merged as (typeof prev.spec.layers)[number];
    const appearance = { ...prev.appearance, layers: { ...prev.appearance.layers } };
    const cur = { ...(appearance.layers[id] ?? {}) } as LayerAppearance & Record<string, unknown>;
    if ('color' in patch) cur.color = patch.color as string;
    if ('fill' in patch) cur.fill = patch.fill as string;
    if ('accent' in patch) {
      // accent 归外观层(与 color/fill 同层);空 words = 取消强调
      const a = patch.accent as { words?: string[]; color?: string } | undefined;
      if (a && a.words && a.words.length)
        cur.accent = {
          words: a.words,
          color: a.color ?? cur.accent?.color ?? 'accent',
        } as LayerAppearance['accent'];
      else if ('accent' in patch) delete cur.accent;
    }
    if ('opacity' in patch) {
      const o = patch.opacity as number;
      if (o >= 1) delete cur.opacity;
      else cur.opacity = o;
    }
    appearance.layers[id] = cur;
    return { ...prev, spec, appearance };
  }

  /** 统一的 patch 入口:合并进持久数据 + 通知 iframe(参数面板发起) */
  const handleLayerPatch = useCallback((id: string, patch: Record<string, unknown>) => {
    const prev = layoutRef.current;
    if (!prev) return;
    commitLayout(mergePatch(prev, id, patch));
    seqRef.current += 1;
    setHostSignal({ seq: seqRef.current, type: 'patch', id, patch });
    scheduleAutoSave();
  }, []);

  /** 图上操作(iframe 内)→ 只合并数据,不经 hostSignal(iframe 已自应用,防回环) */
  const handleLayerChanged = useCallback((id: string, patch: Record<string, unknown>) => {
    const prev = layoutRef.current;
    if (!prev) return;
    commitLayout(mergePatch(prev, id, patch));
    scheduleAutoSave();
  }, []);

  const handleLayerSelect = useCallback((id: string) => {
    setSelectedLayer(id);
    setActiveWord(null); // 点元素其他部分 → 回到基色上下文
  }, []);

  /** 产物条点击:拉取版式数据(可交互编辑的来源) */
  /** 打开产物:fetch data(会话工作目录模式带 session query) */
  const handleOpenArtifact = useCallback(
    async (url: string, name: string, _dir: string, project: string | null) => {
      setPreviewUrl(url); // 兜底:数据没到之前先给 PNG
      try {
        const dataUrl = artifactDataUrl(sessionId, name, project);
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
              text: `⚠️ 「${name}」没有可编辑的版式数据（HTTP ${resp.status}），预览保持图片。常见原因：旧格式产物（缺 design-sketch.json）或项目路径不匹配。`,
            },
          ]);
          return;
        }
        const data = (await resp.json()) as LayoutData;
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
    [sessionId, logSessionAction],
  );

  /** 📂 设置工作目录：无会话 = 纯前端缓存环境（建会话时落 meta）；有会话 = meta 事件改环境 */
  const handleSetWorkDir = useCallback(
    async (dir: string) => {
      if (!sessionId) {
        savePendingEnv({ workDir: dir }); // 换目录 = 项目无效，重新选
        setWorkDir(dir);
        setCurrentProject(null);
        try {
          const pr = (await (await fetch(`/api/projects?dir=${encodeURIComponent(dir)}`)).json()) as {
            projects?: Array<{ name: string; displayName: string }>;
          };
          setProjects(pr.projects ?? []);
        } catch {
          setProjects([]);
        }
        return;
      }
      try {
        const resp = await fetch(`/api/sessions/${sessionId}/workdir`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workDir: dir }),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const { workDir: abs } = (await resp.json()) as { workDir: string };
        setWorkDir(abs);
        // 目录变了:当前打开的版式属于旧位置,清掉(回到缩略图重选);项目清单也跟着变
        commitLayout(null as unknown as LayoutData);
        setPreviewUrl(null);
        setGalleryKey((k) => k + 1);
        void fetchProjects(sessionId);
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
    // fetchProjects 为 useCallback([]) 稳定引用,省略无害
    [sessionId, pendingEnv],
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

  /** 拉项目清单 + 当前项目(切会话/初始化时) */
  const fetchProjects = useCallback(async (sid: string) => {
    try {
      const r = (await (await fetch(`/api/sessions/${sid}/projects`)).json()) as {
        projects?: Array<{ name: string; displayName: string }>;
        current?: string | null;
      };
      setProjects(r.projects ?? []);
      setCurrentProject(r.current ?? null);
    } catch {
      /* API 没跑——保持现状 */
    }
  }, []);

  /** 切换/新建项目(已存在只切换,新名字自动注册) */
  const handleSetProject = useCallback(
    async (name: string, displayName?: string) => {
      if (!sessionId) {
        // 无会话：切项目 = 纯前端缓存环境
        const dir = pendingEnv.workDir ?? workDir ?? undefined;
        savePendingEnv({
          ...(dir ? { workDir: dir } : {}),
          project: name,
          ...(displayName ? { projectDisplayName: displayName } : {}),
        });
        setCurrentProject(name);
        return;
      }
      try {
        const resp = await fetch(`/api/sessions/${sessionId}/project`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, displayName }),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${(await resp.text()).trim()}`);
        const r = (await resp.json()) as { project: string; displayName: string };
        setCurrentProject(r.project);
        await fetchProjects(sessionId);
        setGalleryKey((k) => k + 1); // 项目变了,产物清单跟着变
        setMessages((prev) => [
          ...prev,
          { id: crypto.randomUUID(), role: 'assistant', text: `📁 当前项目:${r.displayName}（产物落 <工作目录>/${r.project}/）` },
        ]);
      } catch (e) {
        setMessages((prev) => [
          ...prev,
          { id: crypto.randomUUID(), role: 'assistant', text: `✗ 切换项目失败:${(e as Error).message}` },
        ]);
      }
    },
    [sessionId, fetchProjects],
  );

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
  const [leftColCollapsed, setLeftColCollapsed] = useState<boolean>(() =>
    localStorage.getItem('vinart.leftColCollapsed') === '1',
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
        body: JSON.stringify({ spec: cur.spec, appearance: cur.appearance }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      logSessionAction('save-spec', { layout: cur.name });
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: 'assistant', text: `💾 已保存 ${cur.name} 的 spec/appearance` },
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
        // 成品落在版式目录里，走会话文件 API 取。
        // 此前硬编码 `/files/test_product/layout/<name>/final.png`——项目化后必 404。
        setPreviewUrl(
          sessionId
            ? `/api/sessions/${sessionId}/file/${cur.project ? `${cur.project}/designs` : 'designs'}/${cur.name}/final.png?t=${Date.now()}`
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
    async (text: string, files?: File[]) => {
      if (!text.trim() && !files?.length) return;
      // 惰性会话的创建点：无会话时此刻建一个（打开/浏览页面从不产生会话）
      let sid: string;
      try {
        sid = await ensureSession();
      } catch (e) {
        setMessages((prev) => [
          ...prev,
          { id: crypto.randomUUID(), role: 'assistant', text: `⚠️ ${(e as Error).message}——API 服务未运行?` },
        ]);
        return;
      }
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'user',
          // 纯贴图（无文字）时气泡也要有内容可显示；图片本体暂不在气泡里预览
          text: text || `📎 图片×${files?.length ?? 0}`,
        },
      ]);
      const replyId = crypto.randomUUID();
      setMessages((prev) => [...prev, { id: replyId, role: 'assistant', text: '' }]);
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
            const data = JSON.parse(dataLine.slice(6)) as { content?: string; message?: string };
            if (ev === 'chunk' && data.content) setReply((t) => t + data.content);
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
            // 工具产出新图（render_design / generate_assets / spawn 批次）→ 实时刷画廊
            if (ev === 'artifacts') setGalleryKey((k) => k + 1);
            if (ev === 'error') throw new Error(data.message ?? 'unknown');
          }
        }
        void refreshSessions(); // 标题可能已随首条消息更新
        setGalleryKey((k) => k + 1); // 兜底：流结束后无论如何刷一次（事件丢失也不漏图）
      } catch (e) {
        setReply((t) => t + `\n\n✗ ${(e as Error).message}`);
        setGalleryKey((k) => k + 1); // 异常收尾同样兜底（工具可能已落了部分产物）
      }
    },
    [sessionId, ensureSession, layout, refreshSessions, toChatImageDataURL],
  );

  const handleExport = useCallback(() => {
    if (!htmlCode) return;
    const blob = new Blob([htmlCode], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vinart-${Date.now()}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }, [htmlCode]);

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
        {/* 左侧对话列表:宽度可拖拽(localStorage 持久化),收起时 width→0,开关贴屏左缘;图标竖线靠左=侧栏在左 */}
        <button
          type="button"
          className={`left-toggle${leftColCollapsed ? ' collapsed' : ''}`}
          style={{ left: leftColCollapsed ? 10 : leftColWidth + 10 }}
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
          projects={projects}
          onSwitch={handleSwitchSession}
          onDelete={handleDeleteSession}
          onNew={handleNewSession}
          onNewProject={handleNewProject}
          onResizeStart={handleResizeStartLeft}
        />
        <PreviewPanel
          htmlCode={layout ? undefined : htmlCode}
          previewUrl={previewUrl}
          selectedElements={selectedElements}
          layoutData={layout}
          sessionId={sessionId}
          onLayerChange={handleLayerChanged}
          onLayerSelect={handleLayerSelect}
          onLayerWord={(id, word) => {
            setSelectedLayer(id);
            setActiveWord(word);
          }}
          hostSignal={hostSignal}
          onToggleElement={(id) => {
            setSelectedElements((prev) => {
              const next = new Set(prev);
              next.has(id) ? next.delete(id) : next.add(id);
              return next;
            });
          }}
          onExport={htmlCode ? handleExport : undefined}
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
                activeWord={activeWord}
                busy={layoutBusy}
                onSelectLayer={(id) => {
                  setSelectedLayer(id);
                  seqRef.current += 1;
                  setHostSignal({ seq: seqRef.current, type: 'select', id });
                }}
                onActivateWord={(word) => setActiveWord(word)}
                onLayerPatch={handleLayerPatch}
                onSave={handleSaveLayoutLive}
                onRender={handleRenderLayoutLive}
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
            workDir={workDir}
            projects={projects}
            currentProject={currentProject}
            onSetProject={handleSetProject}
            onPickDir={handlePickDir}
            onSetWorkDir={handleSetWorkDir}
          />
        </div>
      </div>
    </div>
  );
}
