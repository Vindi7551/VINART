/**
 * UI 基元 —— 面板与控件的可复用外壳。
 *
 * ## 为什么有这一层（2026-10-10）
 *
 * 编辑器（`EditPanel` / `LayerInspector`）此前是**零 CSS 类、100% 内联硬编码**：
 * 选中态用蓝 `#eef3ff`、链接用 `#1b6fd1`、表头用深海军蓝 `#1e2430` ——
 * 而全站的强调色是紫 `--accent: #6c5ce7`、面板表头都是浅色。于是它与
 * 其它面板（走 `index.css` 的类 + 设计 token）明显不是一套。
 *
 * 这里把「面板 + 控件」抽成基元：**样式全部落 `index.css` 的 `.ui-*` 类、
 * 由 token 驱动**，组件只负责结构与交互 —— 换主题时它们自动跟随，
 * 也不会再冒出第 19 个硬编码色值。
 *
 * ## 约定
 *
 * - 基元**不带业务语义**（不认识 layer / spec / palette），只吃值 + onChange。
 * - 输入类基元基本就是「带对类名的原生 input」，**解析与提交交给调用方**
 *   —— 这样换皮不改变任何既有行为。
 */
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from 'react';

// ══════════════════════════════════════════════════════════════════════
// 面板骨架
// ══════════════════════════════════════════════════════════════════════

export function Panel({ children }: { children: ReactNode }) {
  return <div className="ui-panel">{children}</div>;
}

/** 面板表头：标题 + 次要说明 + 右侧操作区 */
export function PanelHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="ui-panel-header">
      <span className="ui-panel-title">{title}</span>
      {subtitle ? <span className="ui-panel-sub">{subtitle}</span> : null}
      {actions ? <span className="ui-panel-actions">{actions}</span> : null}
    </div>
  );
}

/** 面板正文（唯一的滚动区） */
export function PanelBody({ children }: { children: ReactNode }) {
  return <div className="ui-panel-body">{children}</div>;
}

/** 小节：标题 + 内容 + 尾部提示 */
export function Section({
  title,
  hint,
  divider,
  children,
}: {
  title?: ReactNode;
  hint?: ReactNode;
  /** 上方画一条虚线分隔（用于把属性划分组） */
  divider?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`ui-section${divider ? ' divider' : ''}`}>
      {title !== undefined ? <div className="ui-section-title">{title}</div> : null}
      {children}
      {hint ? <div className="ui-hint">{hint}</div> : null}
    </div>
  );
}

/** 灰色小字说明 */
export function Hint({ children }: { children: ReactNode }) {
  return <div className="ui-hint">{children}</div>;
}

// ══════════════════════════════════════════════════════════════════════
// 字段布局
// ══════════════════════════════════════════════════════════════════════

/** 一组字段横排（如 x/y、w/h、fontScale/weight/curve） */
export function Row({ children }: { children: ReactNode }) {
  return <div className="ui-row">{children}</div>;
}

/** 字段：标签在上、控件在下；可选尾部提示 */
export function Field({
  label,
  hint,
  children,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="ui-field">
      {label !== undefined ? <span className="ui-field-label">{label}</span> : null}
      {children}
      {hint ? <span className="ui-hint">{hint}</span> : null}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 控件
// ══════════════════════════════════════════════════════════════════════

/** 单行文本 */
export function TextInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`ui-input${className ? ` ${className}` : ''}`} {...rest} />;
}

/** 数字（窄宽，配合 Row 排成属性网格） */
export function NumberInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input type="number" className={`ui-input ui-num${className ? ` ${className}` : ''}`} {...rest} />;
}

/** 多行文本 */
export function TextArea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`ui-input ui-textarea${className ? ` ${className}` : ''}`} {...rest} />;
}

/** 色块（原生 color picker，样式化） */
export function ColorSwatch({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input type="color" className={`ui-color-swatch${className ? ` ${className}` : ''}`} {...rest} />;
}

/** 滑块字段：标签 + range + 右侧数值 */
export function SliderField({
  label,
  value,
  display,
  min = 0,
  max = 100,
  onChange,
}: {
  label: ReactNode;
  value: number;
  /** 右端显示的文本，默认 `${value}%` */
  display?: string;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="ui-slider-field">
      <span className="ui-field-label">{label}</span>
      <input
        type="range"
        className="ui-slider"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="ui-slider-value">{display ?? `${value}%`}</span>
    </div>
  );
}

/** 按钮：default / primary / ghost / icon */
export function Button({
  variant = 'default',
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'ghost' | 'icon';
}) {
  return (
    <button
      type="button"
      className={`ui-btn${variant === 'default' ? '' : ` ${variant}`}${className ? ` ${className}` : ''}`}
      {...rest}
    >
      {children}
    </button>
  );
}

/** 列表项（图层清单）。`children` 由调用方组织（如「眼睛 + 名字」横向排布） */
export function ListItem({
  active,
  onClick,
  className,
  children,
}: {
  active?: boolean;
  onClick?: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`ui-list-item${active ? ' active' : ''}${className ? ` ${className}` : ''}`}
      onClick={onClick}
    >
      {children}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 弹窗
// ══════════════════════════════════════════════════════════════════════

/**
 * 弹窗：**遮罩 + 卡片 + 头/体/脚三段**。
 *
 * 目录浏览器与「新建项目」两个弹窗共用（此前各自手写一份 fixed 遮罩 + 卡片，
 * 色值/圆角/阴影各写各的——已全部 token 化，但结构仍是复制品）。
 *
 * - 点**遮罩**触发 onClose；卡片内点击不冒泡
 * - `subtitle` 放在表头第二行（如面包屑、工作目录说明），随表头一起带底边线
 * - `maxHeight` 给「内容很高、需要内部滚动」的弹窗用（如目录列表）
 */
export function Dialog({
  open,
  onClose,
  title,
  subtitle,
  footer,
  width = 560,
  maxHeight,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** 表头第二行（在底边线之上） */
  subtitle?: ReactNode;
  /** 卡片底部操作区（在顶边线之下） */
  footer?: ReactNode;
  /** 卡片宽度（px），默认 560 */
  width?: number;
  /** 卡片最大高度（px）——内容会内部滚动 */
  maxHeight?: number;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="ui-overlay" onClick={onClose}>
      <div
        className="ui-dialog"
        style={{ width, ...(maxHeight ? { maxHeight } : {}) }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ui-dialog-head">
          <div className="ui-dialog-title-row">
            <strong className="ui-dialog-title">{title}</strong>
            <Button variant="icon" className="ui-dialog-close" onClick={onClose} title="关闭">
              ✕
            </Button>
          </div>
          {subtitle ? <div className="ui-dialog-sub">{subtitle}</div> : null}
        </div>
        <div className="ui-dialog-body">{children}</div>
        {footer ? <div className="ui-dialog-foot">{footer}</div> : null}
      </div>
    </div>
  );
}
