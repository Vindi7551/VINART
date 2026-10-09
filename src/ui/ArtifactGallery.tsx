import { useEffect, useState } from 'react';

/**
 * 产物清单:GET /api/sessions/<sid>/artifacts(会话工作目录)
 * 或 GET /api/artifacts(legacy,无会话)。
 * 形状: [{ name, dir, root: 'session'|'legacy', layoutsRoot, pngs, htmls }]
 * 产物 URL 按 root 拼:legacy → /files/<dir>/<file>;session → file API(路径式)。
 */
interface ArtifactItem {
  name: string;
  project?: string | null; // 所属项目；null/缺省 = 旧数据未分组
  dir: string;
  root?: 'session' | 'legacy';
  layoutsRoot: string;
  pngs: string[];
  htmls: string[];
}

interface ArtifactGalleryProps {
  /** 变化时重新拉产物清单(管线跑完可能有新图) */
  refreshKey?: number;
  /** 会话 id:有值 = 列该会话工作目录的产物 */
  sessionId?: string | null;
  onOpen: (url: string, name: string, dir: string, project: string | null) => void;
}

/** file 路由 rel：项目版式 = <project>/designs/<name>/<file>；旧数据 = designs/<name>/<file> */
function itemUrl(item: ArtifactItem, file: string, sessionId?: string | null): string {
  if (item.root === 'session' && sessionId) {
    const base = item.project ? `${item.project}/designs` : 'designs';
    return `/api/sessions/${sessionId}/file/${base}/${item.name}/${file}`;
  }
  return `/files/${item.dir}/${file}`;
}

/** 供 App 在打开产物时解析 data API(会话工作目录模式带 session query) */
export function artifactDataUrl(
  sessionId: string | null | undefined,
  name: string,
  project?: string | null,
): string {
  if (!sessionId) return `/api/layout/${name}/data`;
  const p = project ? `&project=${encodeURIComponent(project)}` : '';
  return `/api/layout/${name}/data?session=${sessionId}${p}`;
}

export function ArtifactGallery({
  refreshKey = 0,
  sessionId,
  onOpen,
}: ArtifactGalleryProps) {
  const [items, setItems] = useState<ArtifactItem[]>([]);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const url = sessionId ? `/api/sessions/${sessionId}/artifacts` : '/api/artifacts';
    fetch(url)
      .then((r) => r.json())
      .then((data: ArtifactItem[]) => setItems(Array.isArray(data) ? data : []))
      .catch(() => setItems([]));
  }, [refreshKey, sessionId]);

  if (items.length === 0) return null;

  // 聚合清单按项目分组（null = 旧数据「未分组」组放最后），组内保持服务端排序
  const groups: Array<{ label: string; items: ArtifactItem[] }> = [];
  for (const it of items) {
    const label = it.project ?? '未分组（旧数据）';
    const g = groups.find((x) => x.label === label);
    if (g) g.items.push(it);
    else groups.push({ label, items: [it] });
  }
  groups.sort((a, b) => (a.label === '未分组（旧数据）' ? 1 : b.label === '未分组（旧数据）' ? -1 : 0));

  return (
    <div className="artifact-gallery">
      <div className="artifact-gallery-title">产物库 · {items.length} 套版式</div>
      {groups.map((g) => (
        <div key={g.label} className="artifact-group">
          {groups.length > 1 && <div className="artifact-group-title">📁 {g.label}</div>}
          <div className="artifact-strip">
            {g.items.map((it) => {
              // 缩略图优先成品,其次草图;没有 png 的目录跳过
              const best = it.pngs.includes('final.png') ? 'final.png' : it.pngs[0];
              if (!best) return null;
              const url = itemUrl(it, best, sessionId);
              const key = it.layoutsRoot + it.name;
              return (
                <button
                  key={key}
                  className={`artifact-card${active === key ? ' active' : ''}`}
                  onClick={() => {
                    setActive(key);
                    onOpen(url, it.name, key, it.project ?? null);
                  }}
                  title={url}
                >
                  <img src={url} alt={it.name} loading="lazy" />
                  <span className="artifact-name">{it.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
