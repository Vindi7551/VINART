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
import { useEffect, useState } from 'react';
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
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

/** 面板正文（唯一的滚动区）。`className` 给"整页只有一个长列表"的页面（如图层页）撑满用。 */
export function PanelBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={`ui-panel-body${className ? ` ${className}` : ''}`}>{children}</div>;
}

/**
 * 小节：**图标 + 标题 + 字段数 + 可折叠**，下面是内容。
 *
 * ⚠️ 折叠是**本地 state**、不持久化：它是"我现在要看哪一块"的临时状态。
 * ⚠️ `collapsible` 默认**跟着 `title` 走**（有标题就能折）；`defaultOpen` 默认展开 ——
 *    常用分类（位置 / 变换 / 内容）保持展开，长尾分类（字体 / 排版 / 字形…）传 `false`。
 */
export function Section({
  title,
  icon,
  count,
  collapsible,
  defaultOpen = true,
  divider,
  hint,
  children,
}: {
  title?: ReactNode;
  /** 标题左边的图标（图形由调用方给，基元不认识业务） */
  icon?: ReactNode;
  /** 标题右边的字段数之类的小徽标 */
  count?: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  /** 上方画一条虚线分隔（用于把属性划分组） */
  divider?: boolean;
  children: ReactNode;
  hint?: ReactNode;
}) {
  const canFold = collapsible ?? title !== undefined;
  const [open, setOpen] = useState(defaultOpen);
  const shown = canFold ? open : true;

  return (
    <div className={`ui-section${divider ? ' divider' : ''}`}>
      {title !== undefined ? (
        <div
          className={`ui-section-head${canFold ? ' foldable' : ''}`}
          onClick={canFold ? () => setOpen((v) => !v) : undefined}
          role={canFold ? 'button' : undefined}
          aria-expanded={canFold ? open : undefined}
          title={canFold ? (open ? '收起' : '展开') : undefined}
        >
          {canFold ? (
            <span className={`ui-caret${open ? ' open' : ''}`}>
              <CaretGlyph />
            </span>
          ) : null}
          {icon ? <span className="ui-section-icon">{icon}</span> : null}
          <span className="ui-section-title">{title}</span>
          {count !== undefined ? <span className="ui-section-count">{count}</span> : null}
        </div>
      ) : null}
      {shown ? children : null}
      {shown && hint ? <div className="ui-hint">{hint}</div> : null}
    </div>
  );
}

/** 折叠箭头（基元内部用，不对外 —— 免得每个调用方各画一个） */
function CaretGlyph() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 3.5 10.5 8 6 12.5" />
    </svg>
  );
}

/**
 * 字段网格：**两列**，需要宽的直接 `span 2`。
 *
 * 窄栏里一行一个字段太浪费（文字节点 36 个字段 ⇒ 36 行），两列刚好。
 */
export function FieldGrid({ children }: { children: ReactNode }) {
  return <div className="ui-fields">{children}</div>;
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

/** 字段：标签在上、控件在下；可选尾部提示。`className` 用于网格里跨列（`wide` / `check`）*/
export function Field({
  label,
  hint,
  className,
  children,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`ui-field${className ? ` ${className}` : ''}`}>
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

/** 下拉（枚举字段）—— 原生 select + `.ui-input` 口径 */
export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`ui-input ui-select${className ? ` ${className}` : ''}`} {...rest}>
      {children}
    </select>
  );
}

/**
 * 复选框（**三态**字段：`true` 要 / `false` 明确不要 / `undefined` 跟随）。
 *
 * ⚠️ 只能是复选框：做成文本框的话它读回来是 `undefined`（"没写"）、
 *    写回去是字符串 `"false"` —— 经 `!!v` 变成 `true`，**永远关不掉**。
 */
export function Checkbox({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input type="checkbox" className={`ui-check${className ? ` ${className}` : ''}`} {...rest} />;
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
  onContextMenu,
  className,
  children,
}: {
  active?: boolean;
  onClick?: () => void;
  onContextMenu?: (e: React.MouseEvent<HTMLDivElement>) => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`ui-list-item${active ? ' active' : ''}${className ? ` ${className}` : ''}`}
      onClick={onClick}
      onContextMenu={onContextMenu}
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
/**
 * **右键浮层** —— 贴着鼠标点弹出的一小列选项。
 *
 * ⚠️ 项目约定「弹窗一律用 `Dialog`」，但 `Dialog` 是**模态**的（遮罩 + 拦交互）。
 *    这个不阻塞页面、贴着鼠标点、点外面/Esc/选一项自己关 ⇒ **必须单独一个基元**。
 *    （别为了"统一"把它折进 `Dialog`：那会让右键菜单盖出一层遮罩。）
 */
export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: Array<{ key: string; label: string; active?: boolean; onPick: () => void }>;
  onClose: () => void;
}) {
  useEffect(() => {
    // ⚠️ 捕获阶段：要赶在别人的 `pointerdown` 之前关掉，否则点菜单外面时
    //    那一下点击会被下面的元素吃掉（菜单关了、动作也触发了）
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t?.closest?.('.ui-ctxmenu')) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div className="ui-ctxmenu" style={{ left: x, top: y }} role="menu">
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          role="menuitem"
          className={`ui-ctxmenu-item${it.active ? ' is-active' : ''}`}
          onClick={() => {
            it.onPick();
            onClose();
          }}
        >
          <span className="ui-ctxmenu-check">{it.active ? '✓' : ''}</span>
          {it.label}
        </button>
      ))}
    </div>
  );
}

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
