import { useEffect, useState } from 'react';
import type { DesignDocument } from '../document/vocabulary';
import { DesignThumb } from './DesignThumb';

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
  /** 当前 doc（画廊缩略图用；服务端 scanArtifactRoot 读 doc.json） */
  doc: DesignDocument | null;
  /** 素材名 → URL（服务端 resolveAssets） */
  assets: Record<string, string>;
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
  /** 鼠标是否在画廊上（折叠时= false：不挂 iframe；调出来才全部加载） */
  const [hover, setHover] = useState(false);
  /**
   * **钉住**：钉住后面板不再跟着鼠标走，一直展开；再点一次解除。
   *
   * ⚠️ 按钮**就放在画廊里面**（标题行右端）—— 所以"得先把它滑下来才够得着"是天然的：
   *    鼠标在面板里时 `.gallery-dock:hover` 成立，面板不会在点的过程中缩回去。
   *
   * ⚠️ **不持久化**（刷新回到收起态）：它是"我现在要挑一张图"的临时状态，
   *    不是布局偏好。要跨刷新记住的话，照 `leftColCollapsed` 那样写 localStorage 即可。
   */
  const [pinned, setPinned] = useState(false);

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

  const open = pinned || hover;

  return (
    // ⚠️ `.gallery-dock` **自己就是顶部热区**（高度 = header 高度）：
    //    平时只有它露在屏幕里（透明，看不见），鼠标进来把面板滑下来。
    //    面板是它的绝对定位**子元素** ⇒ 鼠标在面板里时 `:hover` 仍然成立。
    <div
      className={`gallery-dock${pinned ? ' pinned' : ''}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="artifact-gallery">
        <div className="artifact-gallery-title">
          {/* ⚠️ 钉住按钮在**左边**（标题之前）—— 靠左放，不要靠右 */}
          <button
            type="button"
            className={`gallery-pin${pinned ? ' on' : ''}`}
            onClick={() => setPinned((v) => !v)}
            title={pinned ? '解除钉住（恢复"鼠标移到顶端才展开"）' : '钉住（鼠标移开也保持展开）'}
            aria-pressed={pinned}
          >
            {/* 图钉：杆 + 头。钉住时头填实 */}
            <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M8 1.6c2.1 0 3.8 1.7 3.8 3.8 0 2.6-3.8 8-3.8 8s-3.8-5.4-3.8-8C4.2 3.3 5.9 1.6 8 1.6Z"
                fill={pinned ? 'currentColor' : 'none'}
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />
              <circle cx="8" cy="5.4" r="1.5" fill={pinned ? 'var(--bg-surface)' : 'none'} stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </button>
          <span>产物库 · {items.length} 套版式</span>
        </div>
        <div className="artifact-strip">
          {open &&
            items.map((it) => {
              // final.png 只用于“点开时的兜底预览”；缩略图用 doc iframe（doc-only 也显示）
              const best = it.pngs.includes('final.png') ? 'final.png' : it.pngs[0];
              const url = best ? itemUrl(it, best, sessionId) : '';
              const key = it.layoutsRoot + it.name;
              return (
                <button
                  key={key}
                  className={`artifact-card${active === key ? ' active' : ''}`}
                  onClick={() => {
                    setActive(key);
                    onOpen(url, it.name, key);
                  }}
                  title={it.name}
                >
                  {it.doc ? (
                    <DesignThumb doc={it.doc} assets={it.assets} />
                  ) : (
                    <span className="design-thumb" />
                  )}
                  <span className="artifact-name">{it.name}</span>
                </button>
              );
            })}
        </div>
      </div>
    </div>
  );
}
