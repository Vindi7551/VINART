const TEMPLATES = [
  { id: 'poster', icon: '🖼️', label: '促销海报' },
  { id: 'social', icon: '📱', label: '社交媒体' },
  { id: 'banner', icon: '🎯', label: 'Banner' },
  { id: 'logo', icon: '✨', label: 'Logo 设计' },
  { id: 'card', icon: '💳', label: '名片/卡片' },
  { id: 'packaging', icon: '📦', label: '包装设计' },
];

export function TemplateSection() {
  return (
    <div className="template-section">
      <div className="template-section-title">试试这些模板</div>
      <div className="template-grid">
        {TEMPLATES.map((t) => (
          <div key={t.id} className="template-card">
            <div className="template-card-icon">{t.icon}</div>
            <span className="template-card-label">{t.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
