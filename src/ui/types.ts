import type { DesignDocument } from '../document/vocabulary';

/** 思考档位（与 /chat 的 thinking、gateway 的 reasoningEffort 对齐） */
export type ThinkingLevel = 'off' | 'low' | 'high' | 'max';

/** 与 server 的 ChatReference 对齐（目前只有元素引用） */
export interface ChatReference {
  kind: 'element';
  layout: string;
  id: string;
  name: string;
}

/** 输入框 `@` 候选：当前版式的元素 */
export interface MentionItem {
  layout: string;
  id: string;
  name: string;
  type: string;
  /** 所属图层（`@` 弹层按它分组） */
  layerId: string;
  layerName: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  attachments?: string[];
  /** 用户消息里的 @ 元素引用（输入框序列化后带上来） */
  references?: ChatReference[];
  /** 'log' = 管线日志流(等宽字体、终端式渲染),缺省 = 普通对话 */
  kind?: 'chat' | 'log';
  /** 委派记录：哪个子 agent 被调用、结果如何（spawn_design_agents 进度卡片） */
  delegations?: DelegationRecord[];
  /**
   * 思考链（reasoning_content）。assistant 消息专用。
   * 流式期逐段累加；终章 chunk 到达时整段覆盖（服务端给的是权威全文）。
   * 面向用户的呈现 = 默认折叠的「思考块」；缺省 = 该轮模型未产出思考（不渲染）。
   */
  reasoning?: string;
  /**
   * 整轮耗时（毫秒，含工具执行）。两种来源：
   * - 生成中：前端以 `startedAt` 实时走表（见 ConversationPanel 的计时器）
   * - 完成后 / 历史回放：由服务端落盘的 durationMs 提供（刷新不丢）
   */
  durationMs?: number;
  /** 该条回复的起始时刻（仅本次会话内存中，用于生成中实时计时；不持久化） */
  startedAt?: number;
  /** 是否仍在流式接收中——true 时计时器走表、不显示"用时" */
  streaming?: boolean;
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
  /** 会话绑定的工作目录(meta 事件;null=老数据未记录)——单层分组键 */
  workDir?: string | null;
  /** 会话数据的实际落点(= 工作目录 = 项目根)。由文件位置决定,不由 meta 决定 */
  home?: string;
}

// ══════════════════════════════════════════════
// 版式编辑（新协议：DesignDocument 直接过线）
// ══════════════════════════════════════════════

/**
 * ⭐ 新协议（2026-10-15）：**DesignDocument 直接过线**——词汇表文档本身就是
 * 编辑器的输入与持久化单位。旧的 LayoutSpec/LayoutData（spec+appearance 双层、
 * accent 染色）随旧链弃用（见 docs/MIGRATION.md）。
 */
export interface PreviewData {
  name: string;
  /** 词汇表文档 —— 编辑器的输入，也是保存落盘的单位 */
  doc: DesignDocument;
  /** 服务端 `emitDocument` 现场生成的渲染 HTML（srcdoc 用；素材 URL 已解析） */
  html: string;
  /** 素材名 → URL 映射——⭐ 前端结构性变化时**自己 emitDocument** 用（编辑即渲染，无网络往返） */
  assets: Record<string, string>;
  /** 字体库 manifest（编辑器字体下拉用）；服务端 `/data` 下发 */
  fontFamilies?: string[];
  /** family → 下拉显示标签（如 Bitter（仅英文））；没有就不加后缀 */
  fontLabels?: Record<string, string>;
}

/** 宿主 → 编辑器的信号(面板/图层清单发起;seq 防重)。`patch` = 单字段（path + value）。 */
export interface HostSignal {
  seq: number;
  type:
    | 'select'
    | 'patch'
    | 'undo'
    | 'redo'
    | 'add-text'
    // ⚠️ `add-rect` / `add-ellipse` / `add-polygon` / `add-path` **已删**（2026-10-17）：
    //    形状一律**拖画**（`.canvas-draw-layer` + `makeShapeNode`），不再有"一键放一个写死尺寸"的入口。
    | 'remove'
    | 'up'
    | 'down'
    /** ⭐ **新建一个空图层**（追加到最上层并选中它） */
    | 'new-layer'
    /** ⭐ **跳到历史里的第 index 步**（历史面板点击；`index` 字段给出，0 = 最初） */
    | 'goto-step'
    /** ⭐ **删掉历史里的第 index 步**（历史面板右键；`index` 字段给出。不可逆） */
    | 'remove-history'
    /** ⭐ 给**画面上选中的那几个字**刷样式（`path` 来自 `selectionFields()`） */
    | 'style-selection';
  /** select/patch/remove/up/down/style-selection/goto-step 需要 */
  id?: string;
  /** `patch` / `style-selection` 要 */
  path?: string;
  /** `goto-step` 要 */
  index?: number;
  value?: unknown;
}
