import { useMemo, useState } from 'react';
import type { SessionItem } from './types';

/**
 * 左侧对话列表 —— **一级分组：一个工作目录就是一个项目**。
 *
 * - 组 = 工作目录（分组键 = session.home，老数据回退 workDir）；组名 = 目录末段
 * - 组头点击折叠/展开；组序按组内最新活动（新→旧）
 * - 会话项 = 首条消息前 20 字（title），当前项高亮，hover 出 🗑
 * - 组头 ✎ = 在该工作目录下**新建对话**（惰性：预填环境 + 清空到新对话态，发消息才建）
 * - 删除只清对话记录与账本，产物保留（confirm 文案在 App 的 onDelete 里）
 * - 收起态由外层控制（width→0 + .main 上的贴边开关按钮，镜像右栏那套）
 *
 * 2026-10-10：原来是「工作目录 → 项目」两层，项目层已整体拆除
 * （project.json 索引、set_project 工具、会话 meta 的 project 字段全删）。
 */
interface SessionListPanelProps {
  sessions: SessionItem[];
  activeSessionId: string | null;
  collapsed: boolean;
  /** 栏宽(px)——由 App 的拖拽状态驱动 */
  width: number;
  /** 当前待用环境的工作目录——清单里还没有会话的目录补成空组头 */
  envWorkDir: string | null;
  onSwitch: (id: string) => void;
  onDelete: (id: string, title: string) => void;
  /** 新对话：无参 = 沿用当前环境；带参 = 预填该目录（组头 ✎） */
  onNew: (env?: { workDir?: string }) => void;
  /** 右缘拖拽手柄 mousedown（App 侧接管 mousemove 调宽） */
  onResizeStart: (e: React.MouseEvent) => void;
}

const UNCATEGORIZED_DIR = '（未指定目录）';

/** 路径末段（Windows/Unix 通吃），组头只显示 basename */
function basename(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p;
}

/**
 * 分组键归一：Windows 上 `D:/a/b` 与 `D:\a\b`、大小写不同是**同一个目录**。
 * 不归一的话前端缓存的待用环境（用户手输时可能写正斜杠）会和会话实际的
 * home（服务端 resolve 后是反斜杠）分到两个组头——实测同屏出现两个 test_product。
 */
function normKey(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

interface DirGroup {
  /** 归一后的分组键（仅用于比较/折叠状态） */
  key: string;
  /** 原始路径（tooltip 与「在此目录下新建对话」用真路径） */
  raw: string;
  label: string;
  items: SessionItem[];
  latest: string;
}

/** 铅笔图标（新建） */
function PencilIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  );
}

/**
 * 文件夹图标（组头）——展开 = 打开的文件夹，收起 = 合上的文件夹。
 * 用形状而不是三角箭头表达折叠状态，去掉列表里满屏的 ▸/▾。
 */
function FolderIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {open ? (
        <path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
      ) : (
        <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
      )}
    </svg>
  );
}

export function SessionListPanel({
  sessions,
  activeSessionId,
  collapsed,
  width,
  envWorkDir,
  onSwitch,
  onDelete,
  onNew,
  onResizeStart,
}: SessionListPanelProps) {
  // 折叠状态记在组件内（key = 目录）——切会话不重置
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(new Set());
  const toggleGroup = (key: string) => {
    setCollapsedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const dirGroups = useMemo<DirGroup[]>(() => {
    const byDir = new Map<string, DirGroup>();
    for (const s of sessions) {
      // 分组键 = 数据实际落点（home）——老数据（还没迁移）回退它自己记的 workDir
      const raw = s.home ?? s.workDir ?? UNCATEGORIZED_DIR;
      const key = raw === UNCATEGORIZED_DIR ? raw : normKey(raw);
      let g = byDir.get(key);
      if (!g) {
        g = { key, raw, label: raw === UNCATEGORIZED_DIR ? raw : basename(raw), items: [], latest: '' };
        byDir.set(key, g);
      }
      g.items.push(s);
    }
    const groups = [...byDir.values()];
    for (const g of groups) {
      g.items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      g.latest = g.items[0]?.updatedAt ?? '';
    }
    groups.sort((a, b) => b.latest.localeCompare(a.latest));
    // 已选目录但还没有会话 → 补一个空组头（「＋ 新对话」的落点看得见）。
    // 归一后比较——用户手输的正斜杠路径不能长出第二个同名组头。
    if (envWorkDir && !byDir.has(normKey(envWorkDir))) {
      groups.unshift({
        key: normKey(envWorkDir),
        raw: envWorkDir,
        label: basename(envWorkDir),
        items: [],
        latest: '',
      });
    }
    return groups;
  }, [sessions, envWorkDir]);

  if (collapsed) return null;

  return (
    <aside className="session-list" style={{ width }}>
      {/* 右缘拖拽手柄:向右拖 = 变宽(镜像右栏) */}
      {!collapsed && (
        <div className="left-resizer" onMouseDown={onResizeStart} title="拖拽调整宽度" />
      )}
      <div className="session-list-head">
        <button className="session-new-btn" onClick={() => onNew()} title="新建对话（沿用当前目录）">
          ＋ 新对话
        </button>
      </div>
      <div className="session-list-body">
        {dirGroups.length === 0 && <div className="session-list-empty">还没有会话</div>}
        {dirGroups.map((dirG) => {
          const dirCollapsed = collapsedKeys.has(dirG.key);
          const uncat = dirG.raw === UNCATEGORIZED_DIR;
          return (
            <div key={dirG.key} className="session-group">
              {/* 目录组头：点击折叠；hover ✎ = 在此目录下新建对话。
                  组头用 div+role 而非 button——里面要嵌真 button（HTML 禁止 button 嵌 button） */}
              <div
                className={`session-group-head dir${dirCollapsed ? ' closed' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => toggleGroup(dirG.key)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') toggleGroup(dirG.key);
                }}
                title={uncat ? dirG.raw : `工作目录:${dirG.raw}（一个工作目录就是一个项目）`}
              >
                <span className="group-mark">
                  <FolderIcon open={!dirCollapsed} />
                </span>
                <span className="group-label">{dirG.label}</span>
                <span className="group-count">{dirG.items.length}</span>
                {!uncat && (
                  <button
                    className="group-new"
                    title="在此工作目录下新建对话"
                    onClick={(e) => {
                      e.stopPropagation();
                      onNew({ workDir: dirG.raw });
                    }}
                  >
                    <PencilIcon />
                  </button>
                )}
              </div>
              {!dirCollapsed &&
                dirG.items.map((s) => (
                  <div
                    key={s.id}
                    className={`session-item${s.id === activeSessionId ? ' active' : ''}`}
                    onClick={() => onSwitch(s.id)}
                  >
                    <span className="session-item-title">{s.title}</span>
                    <button
                      className="session-item-del"
                      title="删除会话（产物保留）"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(s.id, s.title);
                      }}
                    >
                      🗑
                    </button>
                  </div>
                ))}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
