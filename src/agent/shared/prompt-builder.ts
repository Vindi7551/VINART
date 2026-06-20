/**
 * 动态 System Prompt 组装工具。
 *
 * 模式：
 *   system prompt = 静态基础层 + 动态上下文
 *
 * 静态基础层可被 KV-cache 复用（前缀缓存），动态部分在分隔标记后。
 *
 * 未来扩展：
 *   assemblePrompt(base, context, skills?) — skills 作为第三层注入。
 */
export function assemblePrompt(
  base: string,
  ...sections: (string | undefined | false)[]
): string {
  const parts = [base];

  for (const section of sections) {
    if (section) {
      parts.push(section);
    }
  }

  return parts.join('\n\n---\n\n');
}

/**
 * 把键值对格式化为 prompt 段落。
 * 用于将结构化数据转成自然语言片段。
 *
 * 例：
 *   formatSection('当前任务', [
 *     ['参考图描述', '一张电商海报'],
 *     ['文案内容', '全场五折'],
 *   ])
 *   → "## 当前任务\n参考图描述：一张电商海报\n文案内容：全场五折"
 */
export function formatSection(
  title: string,
  fields: (readonly [string, string])[],
): string {
  const lines = [`## ${title}`];
  for (const [key, value] of fields) {
    if (value) {
      lines.push(`${key}：${value}`);
    }
  }
  return lines.join('\n');
}
