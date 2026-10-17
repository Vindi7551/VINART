/**
 * 面板图标 —— 内联 SVG，`stroke="currentColor"`（跟着文字颜色走）。
 *
 * ⚠️ **为什么手写而不是引图标库**：全站没有图标依赖，而这里只要二十来个 16px 线性图标；
 *    引一个库要多背一份打包体积、还得把它的描边口径拉齐。
 *
 * ⚠️ **口径统一才像一套**：全部 `viewBox="0 0 16 16"` · `strokeWidth 1.4` ·
 *    `linecap/linejoin round` · `fill="none"`。新加图标照抄这个壳，别各写各的。
 *
 * ⚠️ 图标**不带语义**（就是图形）—— 哪个分类用哪个，由 `EditPanel` 的 `GROUP_ICON` 决定。
 */
import type { ReactNode } from 'react';

function Glyph({ size = 14, children }: { size?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export type IconProps = { size?: number };

// ══════════════════════════════════════════════════════════════════════
// 字段分类
// ══════════════════════════════════════════════════════════════════════

/** 位置 / 尺寸 —— 四角括号（"框在这儿"） */
export const IconFrame = ({ size }: IconProps) => (
  <Glyph size={size}>
    <path d="M2.5 6V3.5a1 1 0 0 1 1-1H6M10 2.5h2.5a1 1 0 0 1 1 1V6M13.5 10v2.5a1 1 0 0 1-1 1H10M6 13.5H3.5a1 1 0 0 1-1-1V10" />
  </Glyph>
);

/** 变换 —— 旋转箭头 */
export const IconRotate = ({ size }: IconProps) => (
  <Glyph size={size}>
    <path d="M13 8a5 5 0 1 1-1.6-3.7" />
    <path d="M13.2 2.6v3.2H10" />
  </Glyph>
);

/** 内容 —— 字母 T */
export const IconType = ({ size }: IconProps) => (
  <Glyph size={size}>
    <path d="M3 3.5h10M8 3.5V13" />
  </Glyph>
);

/** 字体 —— 字母 A */
export const IconFont = ({ size }: IconProps) => (
  <Glyph size={size}>
    <path d="M3 13 8 3l5 10M5 9.5h6" />
  </Glyph>
);

/** 描边 —— 双线方框 */
export const IconStroke = ({ size }: IconProps) => (
  <Glyph size={size}>
    <path d="M2.5 2.5h11v11h-11z" />
    <path d="M5.5 5.5h5v5h-5z" />
  </Glyph>
);

/** 排版 —— 三行字 */
export const IconParagraph = ({ size }: IconProps) => (
  <Glyph size={size}>
    <path d="M2.5 4h11M2.5 8h11M2.5 12h6" />
  </Glyph>
);

/** 沿路径 —— 一道弧 */
export const IconCurve = ({ size }: IconProps) => (
  <Glyph size={size}>
    <path d="M2 12.5c2.4-8 9.6-8 12 0" />
  </Glyph>
);

/** 装饰线 —— 下划线 */
export const IconUnderline = ({ size }: IconProps) => (
  <Glyph size={size}>
    <path d="M4 2.5v5a4 4 0 0 0 8 0v-5M3 13.5h10" />
  </Glyph>
);

/** 字形 —— 斜体笔画 */
export const IconGlyph = ({ size }: IconProps) => (
  <Glyph size={size}>
    <path d="M5 3h6M5 13h6M11 3 5 13" />
  </Glyph>
);

/** 外观 —— 颜料滴 */
export const IconSwatch = ({ size }: IconProps) => (
  <Glyph size={size}>
    <path d="M8 2.2s4.2 4.4 4.2 7.1a4.2 4.2 0 0 1-8.4 0C3.8 6.6 8 2.2 8 2.2Z" />
  </Glyph>
);

/** 图片 —— 相框 + 山 + 太阳 */
export const IconImage = ({ size }: IconProps) => (
  <Glyph size={size}>
    <path d="M2.5 4h11v8h-11z" />
    <path d="M2.5 10 6 6.8l2.8 2.6L11 7.6l2.5 2.4" />
    <circle cx="5.6" cy="6.2" r="0.9" />
  </Glyph>
);

/** 图层 —— 叠片 */
export const IconLayers = ({ size }: IconProps) => (
  <Glyph size={size}>
    <path d="M8 2.2 14.2 5.6 8 9 1.8 5.6 8 2.2Z" />
    <path d="M2.6 8.6 8 11.6l5.4-3" />
  </Glyph>
);

/** 历史记录 —— 表盘 + 逆时针箭头（"历史记录"面板那个图标） */
export const IconHistory = ({ size }: IconProps) => (
  <Glyph size={size}>
    <path d="M8 4.2A3.8 3.8 0 1 1 4.2 8" />
    <path d="M4.2 8 2.4 6.2M4.2 8 6 6.2" />
    <path d="M8 6.2V8l1.6 1" />
  </Glyph>
);

/** 显示（眼睛睁开）—— 图层行左侧那个开关 */
export const IconEye = ({ size }: IconProps) => (
  <Glyph size={size}>
    <path d="M1.6 8S3.9 4.2 8 4.2 14.4 8 14.4 8S12.1 11.8 8 11.8 1.6 8 1.6 8Z" />
    <circle cx="8" cy="8" r="1.8" />
  </Glyph>
);

/** 隐藏（眼睛划掉） */
export const IconEyeOff = ({ size }: IconProps) => (
  <Glyph size={size}>
    <path d="M2.6 5.4C2 6.1 1.6 8 1.6 8s2.3 3.8 6.4 3.8c1 0 1.9-.2 2.6-.6" />
    <path d="M6.2 4.4c.6-.1 1.2-.2 1.8-.2 4.1 0 6.4 3.8 6.4 3.8s-.7 1.1-1.8 2.1" />
    <path d="M2 2 14 14" />
  </Glyph>
);

/** 锁定（闭锁） */
export const IconLock = ({ size }: IconProps) => (
  <Glyph size={size}>
    <path d="M4.6 7V5.2a3.4 3.4 0 0 1 6.8 0V7" />
    <path d="M3.4 7h9.2v6H3.4z" />
  </Glyph>
);

/** 解锁（开锁） */
export const IconUnlock = ({ size }: IconProps) => (
  <Glyph size={size}>
    <path d="M4.6 7V5.2a3.4 3.4 0 0 1 6.4-1.4" />
    <path d="M3.4 7h9.2v6H3.4z" />
  </Glyph>
);

/** 选中的字 —— I 形光标 */
export const IconCaretText = ({ size }: IconProps) => (
  <Glyph size={size}>
    <path d="M8 3v10M5.4 3h5.2M5.4 13h5.2" />
  </Glyph>
);

// ══════════════════════════════════════════════════════════════════════
// 动作
// ══════════════════════════════════════════════════════════════════════

export const IconPlus = ({ size }: IconProps) => (
  <Glyph size={size}>
    <path d="M8 3.5v9M3.5 8h9" />
  </Glyph>
);

/** 新增文字：T + 右下角加号 */
export const IconAddText = ({ size }: IconProps) => (
  <Glyph size={size}>
    <path d="M2.5 3.5h7M6 3.5V11" />
    <path d="M11.8 9.6v4M9.8 11.6h4" />
  </Glyph>
);

/** 新增矩形：方框 + 右下角加号 */
export const IconAddRect = ({ size }: IconProps) => (
  <Glyph size={size}>
    <path d="M2.5 3h7v7h-7z" />
    <path d="M11.8 9.6v4M9.8 11.6h4" />
  </Glyph>
);

export const IconUndo = ({ size }: IconProps) => (
  <Glyph size={size}>
    <path d="M2.8 8.4A5 5 0 1 1 5 12.2" />
    <path d="M2.5 4.2v4.4h4.4" />
  </Glyph>
);

export const IconRedo = ({ size }: IconProps) => (
  <Glyph size={size}>
    <path d="M13.2 8.4A5 5 0 1 0 11 12.2" />
    <path d="M13.5 4.2v4.4H9.1" />
  </Glyph>
);

/** 保存 —— 软盘 */
export const IconSave = ({ size }: IconProps) => (
  <Glyph size={size}>
    <path d="M3 3h7.5L13 5.5V13H3z" />
    <path d="M5.5 3v3.5h5V3M5.5 13v-3.5h5V13" />
  </Glyph>
);

/** 重渲 —— 相机（出图） */
export const IconRender = ({ size }: IconProps) => (
  <Glyph size={size}>
    <path d="M2.5 5.5h11v7.5h-11z" />
    <path d="M6 5.5l1-2.2h2l1 2.2" />
    <circle cx="8" cy="9.2" r="2.1" />
  </Glyph>
);

export const IconUp = ({ size }: IconProps) => (
  <Glyph size={size}>
    <path d="M4 9.8 8 5.8l4 4" />
  </Glyph>
);

export const IconDown = ({ size }: IconProps) => (
  <Glyph size={size}>
    <path d="M4 6.2 8 10.2l4-4" />
  </Glyph>
);

export const IconTrash = ({ size }: IconProps) => (
  <Glyph size={size}>
    <path d="M2.8 4.3h10.4M6 4.3V2.6h4v1.7" />
    <path d="M4.2 4.3l.7 9.1h6.2l.7-9.1" />
  </Glyph>
);

/** 折叠小箭头（分类标题左端） */
export const IconCaret = ({ size }: IconProps) => (
  <Glyph size={size}>
    <path d="M6 3.5 10.5 8 6 12.5" />
  </Glyph>
);

// ══════════════════════════════════════════════════════════════════════
// 工具栏：工具
// ══════════════════════════════════════════════════════════════════════

/** 选择 —— 箭头光标 */
export const IconCursor = ({ size }: IconProps) => (
  <Glyph size={size}>
    <path d="M3.6 2.4 12.4 7.9l-4 .9-1.9 4.1z" />
  </Glyph>
);

/** 矢量 / 顶点 —— 一条边 + 两端顶点方块 */
export const IconVector = ({ size }: IconProps) => (
  <Glyph size={size}>
    <path d="M4.4 11.6 11.6 4.4" />
    <rect x="1.8" y="9.8" width="4.2" height="4.2" rx="0.9" />
    <rect x="10" y="2" width="4.2" height="4.2" rx="0.9" />
  </Glyph>
);

/** 椭圆 */
export const IconEllipse = ({ size }: IconProps) => (
  <Glyph size={size}>
    <ellipse cx="8" cy="8" rx="5.6" ry="4.1" />
  </Glyph>
);

/** 多边形 —— 五边形 */
export const IconPolygon = ({ size }: IconProps) => (
  <Glyph size={size}>
    <path d="M8 2.3 13.7 6.4 11.5 13.1H4.5L2.3 6.4z" />
  </Glyph>
);

/** 路径 —— 曲线 + 两端控制点 */
export const IconPath = ({ size }: IconProps) => (
  <Glyph size={size}>
    <path d="M3.4 11.2c2.6-6.6 6.6-6.6 9.2 0" />
    <rect x="1.4" y="9.8" width="3.4" height="3.4" rx="0.8" />
    <rect x="11.2" y="9.8" width="3.4" height="3.4" rx="0.8" />
  </Glyph>
);
