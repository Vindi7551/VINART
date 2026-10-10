/**
 * 检查器栏观测台 —— 把**真实的** `EditPanel` 挂在**真实的** `index.css` 上量几何。
 *
 * 为什么需要：版式编辑器只在「已打开版式 + 选中图层」时才出现，靠会话驱动；
 * 想看它长得松不松、眼睛画得对不对，不该先造一整套会话。这里直接吃
 * `/api/layout/<name>/data` 的真数据，渲染真组件、真样式表 —— **量出来的就是线上那一栏**。
 *
 * 打开： http://localhost:5173/scripts/_probe-inspector/index.html
 *   ?layout=<版式名>     默认 complete_test-PT01（仓库旧约定 test_product/layout/）
 *   &session=<会话id>    版式在某个工作目录里时必须给（走 <workDir>/designs/<name>）
 *   &hidden=a,b          初始隐藏集合（看眼睛两态/隐藏行变淡）
 *
 * 并排放三栏（text / shape / image 各选一个图层），因为不同类型图层的
 * 小节数不同 —— 松紧问题在最长的那一栏最明显。
 *
 * ⚠️ 这个页面**只读**：onPatch / onSave / onRender 全是空函数，不碰磁盘。
 * 眼睛是**真的会动**的（走真 `toggleHidden`），但只改这里的局部 state。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/ui/index.css';
import { EditPanel } from '../../src/ui/EditPanel';
import { toggleHidden } from '../../src/ui/layer-visibility';
import type { LayoutData } from '../../src/ui/types';

const qs = new URLSearchParams(location.search);
const NAME = qs.get('layout') ?? 'complete_test-PT01';
const SESSION = qs.get('session');
/** `selected=none` = 停在图层清单态（看眼睛）；省略 = 按类型自动挑一个进检查器 */
const SELECTED = qs.get('selected');
const TYPES = ['text', 'shape', 'image'] as const;

function Harness() {
  const [layout, setLayout] = useState<LayoutData | null>(null);
  const [err, setErr] = useState('');
  const [hidden, setHidden] = useState<ReadonlySet<string>>(
    () => new Set((qs.get('hidden') ?? '').split(',').filter(Boolean)),
  );

  useEffect(() => {
    const url = `/api/layout/${encodeURIComponent(NAME)}/data${SESSION ? `?session=${SESSION}` : ''}`;
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: LayoutData) => setLayout(d))
      .catch((e: Error) => setErr(e.message));
  }, []);

  const allIds = useMemo(() => (layout ? layout.spec.layers.map((l) => l.id) : []), [layout]);
  const onToggleVisible = useCallback(
    (id: string, solo: boolean) => setHidden((prev) => toggleHidden(prev, id, solo, allIds)),
    [allIds],
  );

  if (err) return <div style={{ padding: 16, font: '13px system-ui' }}>加载失败：{err}</div>;
  if (!layout) return <div style={{ padding: 16, font: '13px system-ui' }}>加载中…</div>;

  return (
    <div style={{ display: 'flex', height: '100vh', gap: 12, padding: 8, background: '#f1f1f5' }}>
      {TYPES.map((t) => {
        const layer = layout.spec.layers.find((l) => l.type === t);
        const selected =
          SELECTED === 'none' ? null : (SELECTED ?? layer?.id ?? null);
        return (
          <div key={t} className="inspector-col" style={{ width: 320 }} data-probe-type={t}>
            <EditPanel
              layout={layout}
              selectedLayer={selected}
              activeWord={null}
              busy={false}
              hiddenLayers={hidden}
              onToggleVisible={onToggleVisible}
              onShowAll={() => setHidden(new Set())}
              onSelectLayer={() => {}}
              onActivateWord={() => {}}
              onLayerPatch={() => {}}
              onSave={() => {}}
              onRender={() => {}}
            />
          </div>
        );
      })}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Harness />);
