/**
 * DeepSeek DSML 工具调用标记的解析与过滤（DeepSeek 专有，协议中立层勿用）。
 *
 * 背景：DeepSeek 模型内部用 DSML 语法表示工具调用（`<｜｜DSML｜｜ invoke …>`，
 * 竖线是全角字符）。正常情况下 DeepSeek API 把它解析成结构化 `tool_calls` 返回；
 * 但长对话/多轮工具循环后模型偶发**格式漂移**——把内部语法直接写进 content，
 * API 原样透传，调用就会以「裸文本」漏到用户面前（实测 sess_6e08c721）。
 *
 * 这里的救场策略：content 里的 DSML invoke 块解析回结构化调用（照常执行），
 * DSML 块本身从显示与历史中剥除——泄漏被转回正常工作流，且不再自我强化
 * （剥除是关键：DSML 文本一旦进历史，模型会把它当示范继续模仿）。
 */

/** 全角竖线版的标记常量（直接抄自实测泄漏样本，勿改字符） */
export const DSML_OPEN = '<｜｜DSML｜｜';
export const DSML_CALLS_OPEN = '<｜｜DSML｜｜ calls>';
export const DSML_CALLS_CLOSE = '</｜｜DSML｜｜ calls>';

export interface DsmlInvocation {
  name: string;
  /** OpenAI 风格 arguments JSON 字符串（string="false" 的参数解析为值再序列化） */
  arguments: string;
}

/** content 是否携带 DSML 标记 */
export function hasDsml(text: string): boolean {
  return text.includes(DSML_OPEN);
}

/**
 * 从 content 中提取全部 DSML invoke 块，转成 OpenAI 风格调用。
 * parameter 的 string="true" → 值为纯字符串；string="false" → 值为 JSON（解析失败退化为字符串）。
 * 无 DSML 时返回 null（调用方据此走正常路径）。
 */
export function extractDsmlInvocations(text: string): DsmlInvocation[] | null {
  if (!hasDsml(text)) return null;
  const out: DsmlInvocation[] = [];
  const invokeRe = /<｜｜DSML｜｜ invoke name="([^"]+)">([\s\S]*?)<\/｜｜DSML｜｜ invoke>/g;
  for (const m of text.matchAll(invokeRe)) {
    const name = m[1]!;
    const body = m[2]!;
    const args: Record<string, unknown> = {};
    const paramRe = /<｜｜DSML｜｜ parameter name="([^"]+)" string="(true|false)">([\s\S]*?)<\/｜｜DSML｜｜ parameter>/g;
    for (const p of body.matchAll(paramRe)) {
      const key = p[1]!;
      const isString = p[2] === 'true';
      const raw = p[3] ?? '';
      if (isString) {
        args[key] = raw;
      } else {
        try {
          args[key] = JSON.parse(raw);
        } catch {
          args[key] = raw; // JSON 坏了退化为字符串——让工具层报参数错误（fail-loud）
        }
      }
    }
    out.push({ name, arguments: JSON.stringify(args) });
  }
  return out.length ? out : null;
}

/**
 * 剥除 content 里的 DSML 块（整段 calls 包裹、或未闭合的残余到结尾）。
 * 用于：进历史/转录/显示前的净化——DSML 文本进历史会让模型模仿（自我强化）。
 */
export function stripDsmlBlocks(text: string): string {
  if (!text.includes(DSML_OPEN)) return text;
  // 已闭合的 calls 块整段剥除；未闭合的从 DSML 开标记剥到结尾
  let out = text.replace(/<｜｜DSML｜｜ calls>[\s\S]*?(<\/｜｜DSML｜｜ calls>|$)/g, '');
  out = out.replace(/<｜｜DSML｜｜[\s\S]*$/g, ''); // 散开的单标记残余
  return out.replace(/\s+$/, '').trim();
}
