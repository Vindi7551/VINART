import type { PipelineStep } from './types';

interface PipelineDebugProps {
  isGenerating: boolean;
}

const STEPS: { key: PipelineStep; label: string }[] = [
  { key: 'design', label: 'Design' },
  { key: 'translate', label: 'Translate' },
  { key: 'code', label: 'Code' },
  { key: 'render', label: 'Render' },
];

export function PipelineDebug({ isGenerating }: PipelineDebugProps) {
  return (
    <div className="pipeline-debug">
      <div className="pipeline-debug-title">Pipeline</div>
      <div className="pipeline-steps">
        {STEPS.map((step, i) => (
          <span key={step.key}>
            {i > 0 && <span className="pipeline-arrow">→</span>}
            <span className={`pipeline-step ${isGenerating ? 'active' : ''}`}>
              {step.label}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
