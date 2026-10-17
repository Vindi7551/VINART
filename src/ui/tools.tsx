import type { ReactNode } from 'react';

import type { Field } from '../editor/inspector';
import type { HostSignal } from './types';
import {
  IconAddRect,
  IconAddText,
  IconCursor,
  IconEllipse,
  IconImage,
  IconLayers,
  IconPath,
  IconPolygon,
  IconSwatch,
  IconType,
  IconVector,
} from './icons';

/**
 * **工具栏的工具表** —— 左侧那一栏，以及右侧检查器"跟着它整页切换"的那套分类。
 *
 * ## 为什么单独一个文件
 *
 * 三处要同一份定义：`ToolBar`（画按钮 + 高亮）、`EditPanel`（决定这一页显示哪些字段）、
 * `App`（自动跳转时判断"当前页跟这个节点有没有关系"）。
 * 定义散开就会漂 —— 加了分类忘了配图标 / 忘了配页，两边就不一致。
 *
 * ## 这一层在项目路线图里的位置
 *
 * `docs/EDITOR-EVOLUTION.md` 的 **M3 = 工具状态机 + 图层管理**（"显式工具枚举 + 光标/快捷键"）。
 * 这里是它的**界面那一半**：工具枚举 + 面板跟随。
 *
 * ⚠️ **诚实划界**：现在只有 `选择` / `矢量` 有"模式"含义（矢量页才显示顶点手柄），
 *    其余几个是**纯面板页**（不改变画布上点一下的行为）。
 *    "真模式"（每个工具一套指针行为 + 光标 + 快捷键）是 M3 的另一半，
 *    需要编辑器先有 `setTool()` 这种 API —— **还没做**。
 */

export type ToolId = 'select' | 'appearance' | 'text' | 'media' | 'vector' | 'layers';

/** 这一页顶部的"新增"按钮（`signal` 直接进 `HostSignal`） */
export interface ToolAdd {
  signal: HostSignal['type'];
  label: string;
  icon: ReactNode;
}

export interface ToolDef {
  id: ToolId;
  label: string;
  /** 悬浮说明：这一页是干什么的 */
  hint: string;
  icon: ReactNode;
  /** 这一页能"新增"什么（没有就不显示新增行） */
  adds?: ToolAdd[];
}

export const TOOLS: ToolDef[] = [
  {
    id: 'select',
    label: '选择',
    hint: '选中 · 移动 · 拖角缩放 · 拖柄旋转',
    icon: <IconCursor />,
  },
  {
    id: 'appearance',
    label: '外观',
    hint: '填充 · 描边 · 圆角 · 新增形状',
    icon: <IconSwatch />,
    adds: [
      { signal: 'add-rect', label: '矩形', icon: <IconAddRect /> },
      { signal: 'add-ellipse', label: '椭圆', icon: <IconEllipse /> },
      { signal: 'add-polygon', label: '多边形', icon: <IconPolygon /> },
      { signal: 'add-path', label: '路径', icon: <IconPath /> },
    ],
  },
  {
    id: 'text',
    label: '文字',
    hint: '内容 · 字体 · 排版 · 装饰（双击画布就地改字）',
    icon: <IconType />,
    adds: [{ signal: 'add-text', label: '文字', icon: <IconAddText /> }],
  },
  {
    id: 'media',
    label: '图片',
    hint: '素材 · 适配方式',
    icon: <IconImage />,
  },
  {
    id: 'vector',
    label: '矢量',
    hint: '圆角 · 顶点（矩形/椭圆拖一下顶点会升格成多边形）',
    icon: <IconVector />,
  },
  {
    id: 'layers',
    label: '图层',
    hint: '顺序 · 增删 · 选中',
    icon: <IconLayers />,
  },
];

/**
 * 字段分类（`inspector.ts` 的 `Field.group`）→ 工具。
 *
 * ⚠️ 分类名是**中文字符串**，与 `inspector.ts` 里写死的那些必须一致。
 *    加分类时两边一起改（漏了会落到 `select`，不会崩，但位置不对）。
 */
const GROUP_TOOL: Record<string, ToolId> = {
  位置: 'select',
  变换: 'select',
  外观: 'appearance',
  内容: 'text',
  字体: 'text',
  描边: 'text', // ⚠️ `描边` 这个分类名只出现在**文字**上（形状的描边在 `外观` 里）
  排版: 'text',
  沿路径: 'text',
  装饰: 'text',
  字形: 'text',
  图片: 'media',
};

/**
 * **按字段路径**覆盖分类归属 —— 用来把个别字段挪到更贴切的页。
 *
 * `radius`（圆角）挂在 `外观` 分类下，但它本质是**矢量**属性（跟顶点一起改），
 * 所以挪到"矢量"页；否则那一页空着。
 */
const FIELD_TOOL: Record<string, ToolId> = {
  radius: 'vector',
};

/** 一个字段属于哪个工具页 */
export function toolOfField(f: Pick<Field, 'path' | 'group'>): ToolId {
  return FIELD_TOOL[f.path] ?? GROUP_TOOL[f.group] ?? 'select';
}

/** 这一页要显示的那些字段（保持 `fieldsFor` 给的顺序） */
export function fieldsOfTool(fields: Field[], tool: ToolId): Field[] {
  return fields.filter((f) => toolOfField(f) === tool);
}

/**
 * ⚠️ **这两个是"全局页"，永远不因为选中而跳走**。
 *
 * `选择` 页（位置/变换）对**任何**节点都有字段 —— 不特判的话它就永远不会被跳走，
 * 反过来"跳到它"也没意义；`图层` 页是拿来点选图层的，选中就跳走会让人没法连着点。
 */
const STICKY_TOOLS: ReadonlySet<ToolId> = new Set<ToolId>(['select', 'layers']);

/**
 * **要不要跟着选中自动跳页**（规则 A：只在"当前页跟这个节点毫无关系"时才跳）。
 *
 * 这样你在 `选择` 页调位置，选中任何东西都不会被跳走；但在 `文字` 页误点了一张图片，
 * 会自动跳到 `图片` 页。
 */
export function shouldFollowSelection(fields: Field[], tool: ToolId): boolean {
  if (STICKY_TOOLS.has(tool)) return false;
  return fieldsOfTool(fields, tool).length === 0;
}

/** 选中一个节点时，它"最相关"的工具页 */
export function toolForLayer(node: { type: string }): ToolId {
  switch (node.type) {
    case 'text':
      return 'text';
    case 'image':
    case 'svg':
      return 'media';
    default:
      // shape / group：外观（形状改填充描边；组改效果）
      return 'appearance';
  }
}
