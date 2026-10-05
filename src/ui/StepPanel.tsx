import { useEffect, useState } from 'react';

/** 形状 = scripts/dev-server.ts 的 GET /api/steps 返回值(单一数据源在那边) */
interface StepInfo {
  id: string;
  label: string;
  description: string;
  argsHint: string;
}

interface StepPanelProps {
  running: boolean;
  /** query = 参数框内容(URL 编码后),服务端原样透传给 step 脚本 */
  onRun: (id: string, label: string, query?: string) => void;
}

/**
 * 管线步骤面板 —— 每步一个按钮 + 一个参数框。
 * 参数框里写的就是终端里 `--` 后面敲的东西,原样透传,不做任何翻译:
 * 服务端 spawn 的是 scripts/ 下的 CLI 薄壳,管线逻辑零改动、零旁路。
 */
export function StepPanel({ running, onRun }: StepPanelProps) {
  const [steps, setSteps] = useState<StepInfo[]>([]);
  /** 每步各自记住参数,互不串扰(01 的图路径不该漏进 02 的卖点参数) */
  const [argsMap, setArgsMap] = useState<Record<string, string>>({});
  /** 折叠状态持久化:刷新后保持上次的选择 */
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('vinart.stepsCollapsed') === '1',
  );

  const toggleCollapsed = () => {
    const next = !collapsed;
    localStorage.setItem('vinart.stepsCollapsed', next ? '1' : '0');
    setCollapsed(next);
  };

  useEffect(() => {
    fetch('/api/steps')
      .then((r) => r.json())
      .then((data) => Array.isArray(data) && setSteps(data))
      .catch(() => setSteps([]));
  }, []);

  if (steps.length === 0) return null;

  return (
    <div className={`step-panel${collapsed ? ' collapsed' : ''}`}>
      <button className="step-panel-header" onClick={toggleCollapsed}>
        <span className="step-panel-title">单步调试 · {steps.length} 步</span>
        <span className="step-panel-chevron">{collapsed ? '▸' : '▾'}</span>
      </button>
      {!collapsed && (
        <div className="step-list">
        {steps.map((s) => {
          const args = (argsMap[s.id] ?? '').trim();
          const query = args ? `args=${encodeURIComponent(args)}` : undefined;
          return (
            <div key={s.id} className="step-item">
              <button
                className="step-btn"
                disabled={running}
                onClick={() => onRun(s.id, s.label, query)}
                title={s.description}
              >
                <span className="step-btn-label">{s.label}</span>
                <span className="step-btn-desc">{s.description}</span>
              </button>
              <input
                className="step-args"
                placeholder={s.argsHint}
                title={s.argsHint}
                value={argsMap[s.id] ?? ''}
                disabled={running}
                onChange={(e) =>
                  setArgsMap((prev) => ({ ...prev, [s.id]: e.target.value }))
                }
                onKeyDown={(e) => {
                  // 输入框里按回车 = 直接跑这一步
                  if (e.key === 'Enter' && !running) onRun(s.id, s.label, query);
                }}
              />
            </div>
          );
        })}
        </div>
      )}
    </div>
  );
}
