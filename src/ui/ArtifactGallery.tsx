import { useEffect, useState } from 'react';

/**
 * 产物清单:GET /api/sessions/<sid>/artifacts（唯一的产物来源）。
 * 形状: [{ name, layoutsRoot, pngs, htmls }] —— 全部来自 <workDir>/designs/
 *
 * ⚠️ **无会话 = 不渲染**（也不再请求）:画廊语义是「当前工作目录的产物」，
 * 而 workDir 由会话承载。无会话 → 无目录 → 没有该显示的东西。
 *
 * 2026-10-10：项目层拆除，产物一律落 <workDir>/designs/<name>/，不再有分组。
 *
 * legacy 通路(无会话 → GET /api/artifacts → `/files/<dir>/<file>`)已于
 * 2026-10-09 整体删除:它扫硬编码 `<仓库>/test_product/layout`(忽略 workDir),
 * 且漏拼 `<name>` 段导致缩略图必然 404。
 */
interface ArtifactItem {
  name: string;
  /** 版式所属的 layouts 根(绝对路径)——仅用于给卡片生成稳定 key */
  layoutsRoot: string;
  pngs: string[];
  htmls: string[];
}

interface ArtifactGalleryProps {
  /** 变化时重新拉产物清单(管线跑完可能有新图) */
  refreshKey?: number;
  /** 会话 id:有值 = 列该会话工作目录的产物;**无值 = 不渲染画廊** */
  sessionId?: string | null;
  onOpen: (url: string, name: string, dir: string) => void;
}

/** file 路由 rel：版式的家 = designs/<name>/<file>（一个工作目录就是一个项目） */
function itemUrl(item: ArtifactItem, file: string, sessionId: string): string {
  return `/api/sessions/${sessionId}/file/designs/${item.name}/${file}`;
}

/** 供 App 在打开产物时解析 data API(会话工作目录模式带 session query) */
export function artifactDataUrl(sessionId: string | null | undefined, name: string): string {
  if (!sessionId) return `/api/layout/${name}/data`;
  return `/api/layout/${name}/data?session=${sessionId}`;
}

export function ArtifactGallery({
  refreshKey = 0,
  sessionId,
  onOpen,
}: ArtifactGalleryProps) {
  const [items, setItems] = useState<ArtifactItem[]>([]);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    // 无会话：不请求任何端点，直接置空
    if (!sessionId) {
      setItems([]);
      return;
    }
    fetch(`/api/sessions/${sessionId}/artifacts`)
      .then((r) => r.json())
      .then((data: ArtifactItem[]) => setItems(Array.isArray(data) ? data : []))
      .catch(() => setItems([]));
  }, [refreshKey, sessionId]);

  // 无会话不渲染（也在 sessionId → null 的当帧拦住，避免上一条会话的卡片闪过一帧）
  if (!sessionId || items.length === 0) return null;

  return (
    <div className="artifact-gallery">
      <div className="artifact-gallery-title">产物库 · {items.length} 套版式</div>
      <div className="artifact-strip">
        {items.map((it) => {
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
                onOpen(url, it.name, key);
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
