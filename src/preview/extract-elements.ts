/**
 * 从设计师产出的 HTML 中提取可交互元素。
 *
 * 依赖 designer agent 在生成 HTML 时嵌入的 data-vinart-* 标记。
 * 不再用 class 名模糊匹配——每个语义元素自带精确的类型和唯一 ID。
 *
 * 标记规范（见 designer/prompt.ts）：
 *   data-vinart-type="headline|subheadline|body|cta|caption|price|logo|tag|image-slot|other"
 *   data-vinart-id="文档内唯一标识"
 *   data-image-slot（仅 image-slot 类型，值与 data-vinart-id 一致）
 */

export interface ExtractedElement {
  /** 唯一标识，来自 data-vinart-id */
  id: string;
  /** 元素类型，直接取自 data-vinart-type */
  type:
    | 'headline'
    | 'subheadline'
    | 'body'
    | 'cta'
    | 'caption'
    | 'price'
    | 'logo'
    | 'tag'
    | 'image-slot'
    | 'other';
  /** 显示标签 */
  label: string;
  /** 元素在 HTML 中的标签名 */
  tag: string;
  /** 元素文本内容片段 */
  textSnippet?: string;
  /** data-image-slot 值（仅 image-slot 类型有值） */
  slotId?: string;
}

/** 根据元素类型生成人类可读的默认标签 */
function typeLabel(type: string): string {
  const map: Record<string, string> = {
    'headline': '标题',
    'subheadline': '副标题',
    'body': '正文',
    'cta': '按钮',
    'caption': '标注',
    'price': '价格',
    'logo': 'Logo',
    'tag': '标签',
    'image-slot': '图片',
  };
  return map[type] ?? '其他';
}

/**
 * 从 HTML 字符串中提取所有带 data-vinart-type 标记的元素。
 */
export function extractElements(html: string): ExtractedElement[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const elements: ExtractedElement[] = [];

  doc.querySelectorAll('[data-vinart-type]').forEach((el) => {
    const type = el.getAttribute('data-vinart-type') ?? 'other';
    const id = el.getAttribute('data-vinart-id') ?? '';
    const slotId = el.getAttribute('data-image-slot') ?? undefined;
    const tag = el.tagName.toLowerCase();
    const text = el.textContent?.trim().slice(0, 40) ?? '';

    if (!id) return; // 缺少唯一 ID 的元素跳过

    elements.push({
      id,
      type: type as ExtractedElement['type'],
      label: `${typeLabel(type)}: ${text || id}`,
      tag,
      textSnippet: text || undefined,
      slotId,
    });
  });

  return elements;
}
