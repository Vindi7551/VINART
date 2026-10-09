export interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  attachments?: string[];
  /** 'log' = 管线日志流(等宽字体、终端式渲染),缺省 = 普通对话 */
  kind?: 'chat' | 'log';
  /** 委派记录：哪个子 agent 被调用、结果如何（spawn_design_agents 进度卡片） */
  delegations?: DelegationRecord[];
}

export interface DelegationRecord {
  /** 版式名（如 "PT03"），可选 */
  name?: string;
  /** 展示标签（spawn job 的 label，如「PT03 材质特写」） */
  agent: string;
  task: string;
  status: 'running' | 'done' | 'failed';
  /** 完成后的结果摘要（成功=子 agent 的 summary；失败=diagnostic） */
  result?: string;
}

export interface ElementInfo {
  id: string;
  label: string;
}

export type PipelineStep = 'design' | 'translate' | 'code' | 'render';

/** 会话条目(GET /api/sessions 的元素) */
export interface SessionItem {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
  /** 会话最后设置的 workDir(meta 事件;null=未设置)——列表第一层分组 */
  workDir?: string | null;
  /** 会话当前项目(name;null=未设置)——列表第二层分组 */
  project?: string | null;
  /** 项目展示名(服务端从该 workDir 的 project.json 映射;null=回退用 project) */
  projectDisplayName?: string | null;
}

// ══════════════════════════════════════════════
// 版式编辑(design-sketch / design-appearance 的前端宽松视图)
// ══════════════════════════════════════════════

export interface LayoutRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutLayer {
  id: string;
  type: 'image' | 'text' | 'shape';
  rect: LayoutRect;
  text?: string | string[];
  fontScale?: number;
  weight?: number;
  curve?: number;
  transform?: { rotate?: number; skewX?: number; origin?: { x: number; y: number } };
  [key: string]: unknown;
}

export interface LayoutSpec {
  canvas: { width: number; height: number };
  layers: LayoutLayer[];
  name?: string;
  title?: string;
  [key: string]: unknown;
}

export interface LayerAppearance {
  color?: string;
  fill?: string;
  opacity?: number;
  accent?: { words: string[]; color: string };
  fontFamily?: string;
  stroke?: { color: string; width: number };
  [key: string]: unknown;
}

export interface LayoutAppearance {
  layers?: Record<string, LayerAppearance>;
  [key: string]: unknown;
}

/** GET /api/layout/<name>/data 的返回 */
export interface LayoutData {
  name: string;
  spec: LayoutSpec;
  appearance: LayoutAppearance;
  html: string;
}

/** 宿主 → iframe 的信号(面板发起的选中/patch,seq 防重) */
export interface HostSignal {
  seq: number;
  type: 'select' | 'patch';
  id: string;
  patch?: Record<string, unknown>;
}
