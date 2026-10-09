import { useMemo, useState } from 'react';
import type { SessionItem } from './types';

/**
 * 左侧对话列表 —— Codex 式：两层折叠分组（工作目录 → 项目）+ 会话项。
 *
 * - 组头点击折叠/展开；组序按组内最新活动（新→旧）
 * - 会话项 = 首条消息前 20 字（title），当前项高亮，hover 出 🗑
 * - 组头 hover 出 ✎：
 *   · 目录组头 ✎ = 在该工作目录下**新建项目**（行内输入目录名/展示名，惰性注册）
 *   · 项目组头 ✎ = 在该项目下**新建会话**（惰性：环境预填 + 清空到新对话态，发消息才建）
 * - 删除只清对话记录与账本，产物保留（confirm 文案在 App 的 onDelete 里）
 * - 收起态由外层控制（width→0 + .main 上的贴边开关按钮，镜像右栏那套）
 */
interface NewSessionEnv {
  workDir?: string;
  project?: string;
  projectDisplayName?: string;
}

interface SessionListPanelProps {
  sessions: SessionItem[];
  activeSessionId: string | null;
  collapsed: boolean;
  /** 当前环境的工作目录——projects 清单所属目录；清单里还没有会话的项目补成空组头 */
  envWorkDir: string | null;
  /** 项目清单（当前环境的；会话项 🗑 同款显隐） */
  projects: Array<{ name: string; displayName: string }>;
  onSwitch: (id: string) => void;
  onDelete: (id: string, title: string) => void;
  /** 新对话：无参 = 沿用当前环境；带参 = 预填该组环境（组头 ✎） */
  onNew: (env?: NewSessionEnv) => void;
  /** 目录组头 ✎：在工作目录下新建项目（App 侧 append 清单 + 预填 + 新对话态） */
  onNewProject: (workDir: string, name: string, displayName?: string) => void;
}

const UNCATEGORIZED_DIR = '（未指定目录）';
const UNCATEGORIZED_PROJ = '未分组';

/** 路径末段（Windows/Unix 通吃），组头只显示 basename */
function basename(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p;
}

interface ProjGroup {
  key: string;
  /** project name（未分组 = UNCATEGORIZED_PROJ） */
  name: string;
  label: string;
  items: SessionItem[];
}
interface DirGroup {
  key: string;
  label: string;
  projects: ProjGroup[];
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

export function SessionListPanel({
  sessions,
  activeSessionId,
  collapsed,
  envWorkDir,
  projects,
  onSwitch,
  onDelete,
  onNew,
  onNewProject,
}: SessionListPanelProps) {
  // 折叠状态记在组件内（key = dir||project）——切会话不重置
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(new Set());
  const toggleGroup = (key: string) => {
    setCollapsedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  // 目录组头 ✎ → 弹窗新建项目（modal 而非行内输入：不挤占列表）
  const [projModal, setProjModal] = useState<{ dirKey: string; dirLabel: string } | null>(null);
  const [projNameDraft, setProjNameDraft] = useState('');
  const [projDisplayDraft, setProjDisplayDraft] = useState('');
  const closeProjModal = () => {
    setProjModal(null);
    setProjNameDraft('');
    setProjDisplayDraft('');
  };
  const submitNewProject = () => {
    if (!projModal) return;
    const name = projNameDraft.trim();
    if (!name) return;
    onNewProject(projModal.dirKey, name, projDisplayDraft.trim() || undefined);
    closeProjModal();
  };

  const dirGroups = useMemo<DirGroup[]>(() => {
    const byDir = new Map<string, Map<string, SessionItem[]>>();
    for (const s of sessions) {
      const dirKey = s.workDir ?? UNCATEGORIZED_DIR;
      const projKey = s.project ?? UNCATEGORIZED_PROJ;
      let byProj = byDir.get(dirKey);
      if (!byProj) byProj = new Map();
      if (!byProj.has(projKey)) byProj.set(projKey, []);
      byProj.get(projKey)!.push(s);
      byDir.set(dirKey, byProj);
    }
    const groups: DirGroup[] = [];
    for (const [dirKey, byProj] of byDir) {
      const projects: ProjGroup[] = [];
      let latest = '';
      for (const [projKey, items] of byProj) {
        items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        latest = items[0]?.updatedAt ?? latest;
        const displayName =
          (projKey !== UNCATEGORIZED_PROJ && (items[0]?.projectDisplayName || projKey)) || projKey;
        projects.push({ key: `${dirKey}||${projKey}`, name: projKey, label: displayName, items });
      }
      projects.sort((a, b) => b.items[0]!.updatedAt.localeCompare(a.items[0]!.updatedAt));
      groups.push({
        key: dirKey,
        label: dirKey === UNCATEGORIZED_DIR ? dirKey : basename(dirKey),
        projects,
        latest,
      });
    }
    groups.sort((a, b) => b.latest.localeCompare(a.latest));
    // 新建项目立即可见：当前环境目录下、清单里有但还没有会话的项目 → 补成空组头
    // （组注册在发消息后才落盘，这里纯 UI 补全——刷新后没会话的组随清单在/不在）
    if (envWorkDir) {
      let dirG = groups.find((g) => g.key === envWorkDir);
      if (!dirG) {
        dirG = { key: envWorkDir, label: basename(envWorkDir), projects: [], latest: '' };
        groups.push(dirG);
      }
      for (const p of projects) {
        if (!dirG.projects.some((pg) => pg.name === p.name)) {
          dirG.projects.push({
            key: `${envWorkDir}||${p.name}`,
            name: p.name,
            label: p.displayName,
            items: [],
          });
        }
      }
      // 空组（新项目无会话）沉底——items[0] 可能是 undefined，不能参与 updatedAt 比较
      dirG.projects.sort((a, b) => (b.items[0]?.updatedAt ?? '').localeCompare(a.items[0]?.updatedAt ?? ''));
    }
    return groups;
  }, [sessions, projects, envWorkDir]);

  if (collapsed) return null;

  return (
    <aside className="session-list">
      <div className="session-list-head">
        <button className="session-new-btn" onClick={() => onNew()} title="新建对话（沿用当前环境）">
          ＋ 新对话
        </button>
      </div>
      <div className="session-list-body">
        {dirGroups.length === 0 && <div className="session-list-empty">还没有会话</div>}
        {dirGroups.map((dirG) => {
          const dirCollapsed = collapsedKeys.has(dirG.key);
          return (
            <div key={dirG.key} className="session-group">
              {/* 目录组头：点击折叠；hover ✎ = 弹窗新建项目。
                  组头用 div+role 而非 button——里面要嵌真 button（HTML 禁止 button 嵌 button） */}
              <div
                className={`session-group-head dir${dirCollapsed ? ' closed' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => toggleGroup(dirG.key)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') toggleGroup(dirG.key);
                }}
                title={dirG.key === UNCATEGORIZED_DIR ? dirG.key : `工作目录:${dirG.key}`}
              >
                <span className="group-mark">▸</span>
                <span className="group-label">{dirG.label}</span>
                <span className="group-count">{dirG.projects.reduce((n, p) => n + p.items.length, 0)}</span>
                {dirG.key !== UNCATEGORIZED_DIR && (
                  <button
                    className="group-new"
                    title="在此工作目录下新建项目"
                    onClick={(e) => {
                      e.stopPropagation();
                      setProjModal({ dirKey: dirG.key, dirLabel: dirG.label });
                      setProjNameDraft('');
                      setProjDisplayDraft('');
                    }}
                  >
                    <PencilIcon />
                  </button>
                )}
              </div>
              {!dirCollapsed &&
                dirG.projects.map((projG) => {
                  const projCollapsed = collapsedKeys.has(projG.key);
                  const uncat = projG.name === UNCATEGORIZED_PROJ;
                  return (
                    <div key={projG.key} className="session-subgroup">
                      {dirG.projects.length > 1 && (
                        <div
                          className={`session-group-head proj${projCollapsed ? ' closed' : ''}`}
                          role="button"
                          tabIndex={0}
                          onClick={() => toggleGroup(projG.key)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') toggleGroup(projG.key);
                          }}
                        >
                          <span className="group-mark">▸</span>
                          <span className="group-label">{projG.label}</span>
                          <span className="group-count">{projG.items.length}</span>
                          {!uncat && (
                            <button
                              className="group-new"
                              title="在此项目下新建会话"
                              onClick={(e) => {
                                e.stopPropagation();
                                onNew({ workDir: dirG.key, project: projG.name, projectDisplayName: projG.label });
                              }}
                            >
                              <PencilIcon />
                            </button>
                          )}
                        </div>
                      )}
                      {!projCollapsed &&
                        projG.items.map((s) => (
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
          );
        })}
      </div>
      {/* 新建项目弹窗（fixed overlay，风格对齐 DirectoryBrowser） */}
      {projModal && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onClick={closeProjModal}
        >
          <div
            style={{
              width: 360, background: '#fff', borderRadius: 10,
              boxShadow: '0 20px 60px rgba(0,0,0,0.3)', color: '#1f2937', padding: '14px 16px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <strong style={{ fontSize: 13 }}>新建项目</strong>
              <button
                style={{ cursor: 'pointer', border: 'none', background: 'none', fontSize: 16, lineHeight: 1 }}
                onClick={closeProjModal}
              >
                ✕
              </button>
            </div>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>
              工作目录：{projModal.dirLabel}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
              <input
                autoFocus
                style={{ fontSize: 13, border: '1px solid #d1d5db', borderRadius: 4, padding: '6px 8px' }}
                placeholder="目录名（如 tshirt-black）"
                value={projNameDraft}
                onChange={(e) => setProjNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && projNameDraft.trim()) submitNewProject();
                  if (e.key === 'Escape') closeProjModal();
                }}
              />
              <input
                style={{ fontSize: 13, border: '1px solid #d1d5db', borderRadius: 4, padding: '6px 8px' }}
                placeholder="展示名（可选，如 黑T恤）"
                value={projDisplayDraft}
                onChange={(e) => setProjDisplayDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && projNameDraft.trim()) submitNewProject();
                  if (e.key === 'Escape') closeProjModal();
                }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                style={{ cursor: 'pointer', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 4, padding: '5px 14px', background: '#fff' }}
                onClick={closeProjModal}
              >
                取消
              </button>
              <button
                style={{
                  cursor: projNameDraft.trim() ? 'pointer' : 'not-allowed',
                  fontSize: 13, border: 'none', borderRadius: 6, padding: '5px 16px',
                  background: projNameDraft.trim() ? '#1b6fd1' : '#9ca3af', color: '#fff',
                }}
                disabled={!projNameDraft.trim()}
                onClick={submitNewProject}
              >
                创建项目
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
