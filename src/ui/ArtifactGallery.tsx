import { useEffect, useState } from 'react';

/**
 * 产物清单来源：GET /api/artifacts（vite.config.ts 的 workspaceFiles 插件提供）
 * 形状：[{ name, dir, pngs, htmls }]，dir 是相对工作区路径，URL = /files/<dir>/<file>
 */
interface ArtifactItem {
  name: string;
  dir: string;
  pngs: string[];
  htmls: string[];
}

interface ArtifactGalleryProps {
  /** 变化时重新拉产物清单(管线跑完可能有新图) */
  refreshKey?: number;
  onOpen: (url: string, name: string, dir: string) => void;
}

/**
 * 产物画廊 —— 壳与管线之间的第一条可见纽带:
 * 管线落盘的图,在这里点一下就能进预览区。跑步骤的能力下一步才接。
 */
export function ArtifactGallery({ refreshKey = 0, onOpen }: ArtifactGalleryProps) {
  const [items, setItems] = useState<ArtifactItem[]>([]);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/artifacts')
      .then((r) => r.json())
      .then((data: ArtifactItem[]) => setItems(Array.isArray(data) ? data : []))
      .catch(() => setItems([]));
  }, [refreshKey]);

  if (items.length === 0) return null;

  return (
    <div className="artifact-gallery">
      <div className="artifact-gallery-title">产物库 · {items.length} 套版式</div>
      <div className="artifact-strip">
        {items.map((it) => {
          // 缩略图优先成品，其次草图；没有 png 的目录跳过
          const best = it.pngs.includes('final.png')
            ? 'final.png'
            : it.pngs[0];
          if (!best) return null;
          const url = `/files/${it.dir}/${best}`;
          return (
            <button
              key={it.dir}
              className={`artifact-card${active === it.dir ? ' active' : ''}`}
              onClick={() => {
                setActive(it.dir);
                onOpen(url, it.name, it.dir);
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
  );
}
