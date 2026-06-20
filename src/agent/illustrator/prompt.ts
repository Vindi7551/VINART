import type { SlotSpec, CreativeBrief, ImageTreatment } from '../../schema/index';

/** 素材师输入 */
export interface IllustratorInput {
  /** 目标槽位规格 */
  slot: SlotSpec;
  /** 创意简报（提供风格/调性上下文） */
  brief: CreativeBrief;
  /** 该槽位类型的图片处理方案 */
  treatment?: ImageTreatment;
}

/**
 * 将结构化槽位规格翻译为 vision 模型的正向 prompt。
 *
 * 翻译策略：
 * - subject 作为画面主体
 * - composition 控制构图
 * - lighting 控制光影
 * - 从 brief 中提取风格/氛围关键词做质量词
 * - 从 treatment 中提取滤镜/色彩方向做风格词
 */
export function buildPositivePrompt(
  slot: SlotSpec,
  brief: CreativeBrief,
  treatment?: ImageTreatment,
): string {
  const parts: string[] = [];

  // 主体 + 背景
  parts.push(slot.content.subject);
  if (slot.content.background) {
    parts.push(slot.content.background + ' background');
  }

  // 构图
  if (slot.content.composition) {
    parts.push(slot.content.composition, 'composition');
  }

  // 光影
  if (slot.content.lighting) {
    parts.push(slot.content.lighting, 'lighting');
  }

  // 风格锚点（从 brief 提取）
  parts.push(brief.visualStyle);
  parts.push(brief.mood, 'atmosphere');

  // 色彩方向
  parts.push(brief.colorDirection, 'color palette');

  // 滤镜 / 色彩倾向
  if (treatment?.filterStyle) {
    parts.push(treatment.filterStyle, 'style');
  }
  if (treatment?.note) {
    parts.push(treatment.note);
  }

  // 质量词
  parts.push('high quality', 'detailed', 'professional product photography');

  // 尺寸提示
  parts.push(`${slot.width}x${slot.height}`);

  return parts.join(', ');
}

/**
 * 构建负向 prompt。
 *
 * 从 brief.mustAvoid 和通用排除项组合。
 */
export function buildNegativePrompt(
  _slot: SlotSpec,
  brief: CreativeBrief,
): string {
  const defaults = [
    'blurry',
    'low quality',
    'distorted',
    'watermark',
    'text',
    'logo',
    'ugly',
    'deformed',
  ];

  const fromBrief = brief.mustAvoid ?? [];
  return [...defaults, ...fromBrief].join(', ');
}

/**
 * 素材师的 prompt 构建指南（内嵌在 system 指令中）。
 * 素材师不需要 ChatSession，这只是一个静态指南。
 */
export const PROMPT_BUILD_GUIDE = [
  '你是视觉素材生成专家（Illustrator），负责将槽位规格转化为图片生成 prompt。',
  '',
  'prompt 构建原则：',
  '- 主体 + 背景 + 构图 + 光影 + 风格 + 色彩 + 质量词，按此顺序排列',
  '- 使用英文 prompt（大多数 vision 模型对英文响应更好）',
  '- 风格词从创意简报中提取：visualStyle、mood、colorDirection',
  '- 如果有 ImageTreatment，将 filterStyle 倾向转化为描述性词语',
  '- 负向 prompt 包含通用质量排除项 + brief.mustAvoid',
  '- 指定目标分辨率：{width}x{height}',
].join('\n');
