import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 应用内目录浏览器(DSH ui-directory-picker-browse 的 V1 精简版)。
 *
 * 后端 API 驱动:POST /api/fs/list(列一级;空 dir=盘符)/ POST /api/fs/mkdir。
 * 返回的是后端确认的真实绝对路径——管线可直接写入。
 * 相比系统对话框:不依赖服务进程桌面环境,必定能弹;相比浏览器句柄:拿得到路径。
 */
interface DirEntry {
  name: string;
  kind: 'dir';
}

interface DirectoryBrowserProps {
  open: boolean;
  /** 确认选择(真实绝对路径) */
  onPick: (path: string) => void;
  onClose: () => void;
}

interface ListResult {
  current: string;
  entries: DirEntry[];
  parent?: string | null;
  isDriveList?: boolean;
  error?: string;
}

export function DirectoryBrowser({ open, onPick, onClose }: DirectoryBrowserProps) {
  const [current, setCurrent] = useState<string>('');
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [parent, setParent] = useState<string | null>(null);
  const [isDriveList, setIsDriveList] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [mkdirOpen, setMkdirOpen] = useState(false);
  const [mkdirName, setMkdirName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const list = useCallback(async (dir: string) => {
    setLoading(true);
    setError('');
    try {
      const resp = await fetch('/api/fs/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dir }),
      });
      const data = (await resp.json()) as ListResult;
      setCurrent(data.current ?? dir);
      setEntries(data.entries ?? []);
      setParent(data.parent ?? null);
      setIsDriveList(!!data.isDriveList);
      if (data.error) setError(data.error);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void list('');
  }, [open, list]);

  useEffect(() => {
    if (mkdirOpen) inputRef.current?.focus();
  }, [mkdirOpen]);

  if (!open) return null;

  const crumbs = current
    ? current.split(/[\\/]+/).filter(Boolean)
    : [];

  const enter = (name: string) => {
    if (isDriveList) return void list(name); // 盘符条目本身就是根路径
    void list(current.endsWith('\\') || current.endsWith('/') ? current + name : `${current}\\${name}`);
  };

  const mkdir = async () => {
    if (!mkdirName.trim() || !current) return;
    try {
      const resp = await fetch('/api/fs/mkdir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parent: current, name: mkdirName.trim() }),
      });
      if (!resp.ok) {
        setError(await resp.text());
        return;
      }
      setMkdirOpen(false);
      const { path } = (await resp.json()) as { path: string };
      setMkdirName('');
      await list(path); // 进入新建的目录
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 560, maxHeight: 480, background: '#fff', borderRadius: 10,
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column',
          overflow: 'hidden', color: '#1f2937',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部:标题 + 面包屑路径 */}
        <div style={{ padding: '10px 14px 8px', borderBottom: '1px solid #e5e7eb' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <strong style={{ fontSize: 13 }}>选择工作目录</strong>
            <button
              style={{ cursor: 'pointer', border: 'none', background: 'none', fontSize: 16, lineHeight: 1 }}
              onClick={onClose}
            >
              ✕
            </button>
          </div>
          {/* 面包屑(点击逐级上跳) */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, fontSize: 12, color: '#374151' }}>
            {!isDriveList && parent !== null && (
              <button
                style={{ cursor: 'pointer', border: 'none', background: 'none', color: '#1b6fd1', padding: '0 4px' }}
                onClick={() => void list(parent)}
              >
                ↰ 上级
              </button>
            )}
            {isDriveList ? (
              <span>本机磁盘</span>
            ) : (
              crumbs.map((c, i) => {
                const partial = crumbs.slice(0, i + 1).join('\\');
                const path = /^[A-Za-z]:$/.test(c) ? `${c}\\` : partial;
                return (
                  <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    {i > 0 && <span style={{ color: '#9ca3af' }}>›</span>}
                    <button
                      style={{ cursor: 'pointer', border: 'none', background: 'none', color: i === crumbs.length - 1 ? '#111827' : '#1b6fd1', padding: '0 2px' }}
                      onClick={() => void list(path)}
                    >
                      {c}
                    </button>
                  </span>
                );
              })
            )}
          </div>
        </div>

        {/* 目录列表 */}
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 220 }}>
          {loading && <div style={{ padding: 14, color: '#6b7280', fontSize: 13 }}>读取中…</div>}
          {!loading && error && <div style={{ padding: 14, color: '#b91c1c', fontSize: 13 }}>{error}</div>}
          {!loading && !error && entries.length === 0 && (
            <div style={{ padding: 14, color: '#9ca3af', fontSize: 13 }}>空目录</div>
          )}
          {!loading &&
            entries.map((e) => (
              <div
                key={e.name}
                style={{ padding: '6px 14px', cursor: 'pointer', fontSize: 13 }}
                onClick={() => enter(e.name)}
                onMouseEnter={(ev) => (ev.currentTarget.style.background = '#f3f4f6')}
                onMouseLeave={(ev) => (ev.currentTarget.style.background = 'transparent')}
              >
                📁 {e.name}
              </div>
            ))}
        </div>

        {/* 底部:新建文件夹 + 选择此目录 */}
        <div style={{ padding: '10px 14px', borderTop: '1px solid #e5e7eb', display: 'flex', gap: 8, alignItems: 'center' }}>
          {mkdirOpen ? (
            <>
              <input
                ref={inputRef}
                style={{ flex: 1, fontSize: 12, border: '1px solid #d1d5db', borderRadius: 4, padding: '4px 8px' }}
                placeholder="新文件夹名称"
                value={mkdirName}
                onChange={(e) => setMkdirName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void mkdir();
                  if (e.key === 'Escape') setMkdirOpen(false);
                }}
              />
              <button style={{ cursor: 'pointer' }} onClick={() => void mkdir()}>创建</button>
              <button style={{ cursor: 'pointer' }} onClick={() => setMkdirOpen(false)}>取消</button>
            </>
          ) : (
            <>
              <button
                style={{ cursor: 'pointer', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 4, padding: '4px 10px', background: '#fff' }}
                disabled={!current || isDriveList}
                onClick={() => setMkdirOpen(true)}
              >
                ＋ 新建文件夹
              </button>
              <div style={{ flex: 1 }} />
              <button
                style={{
                  cursor: current && !isDriveList ? 'pointer' : 'not-allowed',
                  fontSize: 13, border: 'none', borderRadius: 6, padding: '6px 16px',
                  background: current && !isDriveList ? '#1b6fd1' : '#9ca3af', color: '#fff',
                }}
                disabled={!current || isDriveList}
                onClick={() => current && onPick(current)}
              >
                选择此目录
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
