import { useRef, useState } from 'react';

export interface PipelineFormValues {
  imageFile: File;
  bullets: string;
  name: string;
  lang: string;
  slot: string;
  depth: string;
}

interface NewPipelineFormProps {
  running: boolean;
  onSubmit: (v: PipelineFormValues) => void;
}

/**
 * 一键生成表单 —— 「输入图 + 卖点 → 自动跑完整链」的前端入口。
 * 提交后走 POST /api/pipeline + SSE 执行流,与单步按钮同一套日志体验。
 */
export function NewPipelineForm({ running, onSubmit }: NewPipelineFormProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [bullets, setBullets] = useState('');
  const [name, setName] = useState('');
  const [lang, setLang] = useState('en');
  const [slot, setSlot] = useState('PT01');
  const [depth, setDepth] = useState('sketch');
  const [error, setError] = useState<string | null>(null);
  /** 折叠持久化:刷新保持;提交后自动收起,把侧栏让给日志流 */
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('vinart.formCollapsed') === '1',
  );

  const toggleCollapsed = () => {
    const next = !collapsed;
    localStorage.setItem('vinart.formCollapsed', next ? '1' : '0');
    setCollapsed(next);
  };

  const pickImage = (f: File | null) => {
    setImageFile(f);
    if (f && !name) {
      // 默认产品名 = 图文件名(去扩展名、消毒,与 dev-server 同规则)
      setName(
        f.name
          .replace(/\.[^.]+$/, '')
          .replace(/[^A-Za-z0-9._-]/g, '-')
          .slice(0, 40) || 'product',
      );
    }
  };

  const submit = () => {
    if (!imageFile) return setError('先选产品图');
    if (!bullets.trim()) return setError('卖点文本不能为空');
    setError(null);
    localStorage.setItem('vinart.formCollapsed', '1');
    setCollapsed(true);
    onSubmit({ imageFile, bullets, name: name || 'product', lang, slot, depth });
  };

  return (
    <div className={`pipeline-form${collapsed ? ' collapsed' : ''}`}>
      <button className="pipeline-form-header" onClick={toggleCollapsed}>
        <span className="pipeline-form-title">一键生成套图</span>
        <span className="pipeline-form-chevron">{collapsed ? '▸' : '▾'}</span>
      </button>
      {!collapsed && (
        <>
      <button className="pipeline-file" onClick={() => fileRef.current?.click()} title={imageFile?.name}>
        {imageFile ? `✓ ${imageFile.name}` : '📁 选择产品图'}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(e) => {
          pickImage(e.target.files?.[0] ?? null);
          e.target.value = '';
        }}
      />

      <textarea
        className="pipeline-bullets"
        rows={5}
        placeholder="把 listing 卖点整段粘贴到这里…"
        value={bullets}
        onChange={(e) => setBullets(e.target.value)}
      />

      <div className="pipeline-row">
        <label className="pipeline-field">
          <span>产品名</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="product" />
        </label>
        <label className="pipeline-field">
          <span>语言</span>
          <select value={lang} onChange={(e) => setLang(e.target.value)}>
            <option value="en">en</option>
            <option value="de">de</option>
          </select>
        </label>
      </div>
      <div className="pipeline-row">
        <label className="pipeline-field">
          <span>槽位</span>
          <select value={slot} onChange={(e) => setSlot(e.target.value)}>
            <option value="PT01">先跑 PT01(便宜)</option>
            <option value="all">全部槽位(较贵)</option>
          </select>
        </label>
        <label className="pipeline-field">
          <span>深度</span>
          <select value={depth} onChange={(e) => setDepth(e.target.value)}>
            <option value="sketch">到草图(零 API)</option>
            <option value="final">到成品(含生图)</option>
          </select>
        </label>
      </div>

      {error && <div className="pipeline-error">{error}</div>}

      <button className="pipeline-submit" disabled={running} onClick={submit}>
        {running ? '管线运行中…' : '🚀 开始生成'}
      </button>
        </>
      )}
    </div>
  );
}
