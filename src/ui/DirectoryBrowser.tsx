import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Dialog } from './primitives';

/**
 * 应用内目录浏览器(DSH ui-directory-picker-browse 的 V1 精简版)。
 *
 * 后端 API 驱动:POST /api/fs/list(列一级;空 dir=盘符)/ POST /api/fs/mkdir。
 * 返回的是后端确认的真实绝对路径——管线可直接写入。
 * 相比系统对话框:不依赖服务进程桌面环境,必定能弹;相比浏览器句柄:拿得到路径。
 *
 * 表现层走 `primitives.tsx` 的 `Dialog`（遮罩 + 卡片 + 头/体/脚）——
 * 此前遮罩/卡片/圆角/阴影是手写的一份复制品。
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
  /** 弹窗标题（默认「选择工作目录」；出图时传「选择出图保存目录」） */
  title?: string;
  /** 打开时从哪个目录起步；空 = 盘符列表 */
  initialDir?: string;
  /** 确认按钮文案（默认「选择此目录」） */
  pickLabel?: string;
}

interface ListResult {
  current: string;
  entries: DirEntry[];
  parent?: string | null;
  isDriveList?: boolean;
  error?: string;
}

export function DirectoryBrowser({
  open,
  onPick,
  onClose,
  title = '选择工作目录',
  initialDir = '',
  pickLabel = '选择此目录',
}: DirectoryBrowserProps) {
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
    if (open) void list(initialDir);
  }, [open, initialDir, list]);

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
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      width={560}
      maxHeight={480}
      subtitle={
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, fontSize: 12, color: 'var(--text-secondary)' }}>
          {!isDriveList && parent !== null && (
            <button
              style={{ cursor: 'pointer', border: 'none', background: 'none', color: 'var(--accent)', padding: '0 4px' }}
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
                  {i > 0 && <span style={{ color: 'var(--text-muted)' }}>›</span>}
                  <button
                    style={{ cursor: 'pointer', border: 'none', background: 'none', color: i === crumbs.length - 1 ? 'var(--text-primary)' : 'var(--accent)', padding: '0 2px' }}
                    onClick={() => void list(path)}
                  >
                    {c}
                  </button>
                </span>
              );
            })
          )}
        </div>
      }
      footer={
        mkdirOpen ? (
          <>
            <input
              ref={inputRef}
              className="ui-input"
              placeholder="新文件夹名称"
              value={mkdirName}
              onChange={(e) => setMkdirName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void mkdir();
                if (e.key === 'Escape') setMkdirOpen(false);
              }}
            />
            <Button onClick={() => void mkdir()}>创建</Button>
            <Button variant="ghost" onClick={() => setMkdirOpen(false)}>
              取消
            </Button>
          </>
        ) : (
          <>
            <Button disabled={!current || isDriveList} onClick={() => setMkdirOpen(true)}>
              ＋ 新建文件夹
            </Button>
            <div style={{ flex: 1 }} />
            <Button variant="primary" disabled={!current || isDriveList} onClick={() => current && onPick(current)}>
              {pickLabel}
            </Button>
          </>
        )
      }
    >
      <div style={{ minHeight: 220 }}>
        {loading && <div style={{ padding: 14, color: 'var(--text-secondary)', fontSize: 13 }}>读取中…</div>}
        {!loading && error && <div style={{ padding: 14, color: 'var(--danger)', fontSize: 13 }}>{error}</div>}
        {!loading && !error && entries.length === 0 && (
          <div style={{ padding: 14, color: 'var(--text-muted)', fontSize: 13 }}>空目录</div>
        )}
        {!loading &&
          entries.map((e) => (
            <div key={e.name} className="ui-dir-row" onClick={() => enter(e.name)}>
              📁 {e.name}
            </div>
          ))}
      </div>
    </Dialog>
  );
}
