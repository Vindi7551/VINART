const ELEMENTS = [
  { id: 'bg', label: '背景' },
  { id: 'hero', label: '主视觉' },
  { id: 'title', label: '标题' },
  { id: 'subtitle', label: '副标题' },
  { id: 'price-tag', label: '价格标签' },
  { id: 'cta', label: 'CTA 按钮' },
];

interface PreviewPanelProps {
  previewUrl: string | null;
  selectedElements: Set<string>;
  onToggleElement: (id: string) => void;
  onRegenerateSelected: () => void;
}

export function PreviewPanel({
  previewUrl,
  selectedElements,
  onToggleElement,
  onRegenerateSelected,
}: PreviewPanelProps) {
  const hasSelection = selectedElements.size > 0;

  return (
    <section className="preview-panel">
      <div className="preview-canvas">
        {previewUrl ? (
          <img className="preview-image" src={previewUrl} alt="设计预览" />
        ) : (
          <div className="preview-placeholder">
            <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="3" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="m21 15-5-5L5 21" />
            </svg>
            <span className="preview-placeholder-text">设计预览将在此展示</span>
            <span className="preview-placeholder-hint">输入设计描述，开始生成</span>
          </div>
        )}
      </div>

      <div className="element-list">
        <div className="element-list-header">
          <span className="element-list-title">图像元素</span>
          {hasSelection && (
            <button className="btn btn-sm" onClick={onRegenerateSelected}>
              重新生成 ({selectedElements.size})
            </button>
          )}
        </div>
        <div className="element-items">
          {ELEMENTS.map((el) => (
            <label
              key={el.id}
              className={`element-tag${selectedElements.has(el.id) ? ' selected' : ''}`}
            >
              <input
                type="checkbox"
                checked={selectedElements.has(el.id)}
                onChange={() => onToggleElement(el.id)}
              />
              {el.label}
            </label>
          ))}
        </div>
      </div>
    </section>
  );
}
