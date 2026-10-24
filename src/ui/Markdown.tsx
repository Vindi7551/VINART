/**
 * 助手消息的 Markdown 渲染。
 *
 * ## 为什么加这一层（2026-10-10）
 *
 * 助手回复本来就是 Markdown（`**强调**` / `- 列表` / `## 小节` / 行内代码 / 表格），
 * 而消息气泡此前是**纯文本插值**：`<div className="chat-bubble">{msg.text}</div>`。
 * 后果实测：星号原样露出来，`- ` 开头的列表被并成一行，整段读起来是一坨。
 *
 * ## 三条约定
 *
 * 1. **只给助手的普通消息用**。用户自己的输入不解析 —— 路径里的 `*`/`_`
 *    被当成强调语法只会帮倒忙（用户气泡另用 `white-space: pre-wrap` 保住换行）。
 *    管线日志（`kind: 'log'`）也不解析：那是等宽终端式输出，不是散文。
 * 2. **硬换行**（`remark-breaks`）。CommonMark 里单个换行默认只是软换行（会被并成一行），
 *    而模型写回复时**换行是有意的**——不加这条，`- ` 之外的换行照样会被吃掉。
 * 3. **链接强制新窗口**。回复里常出现 `http://localhost:5173` 这类地址；
 *    默认 `<a href>` 会在 iframe/同一页里跳走，把整个应用导航掉。加
 *    `target="_blank"` + `rel="noreferrer noopener"` 才安全。
 *
 * 安全性：`react-markdown` **默认不解析原始 HTML**（没有 `rehype-raw`），
 * 且产出的是 React 元素而非字符串，所以不存在注入面。
 * 样式在 `index.css` 的 `.chat-bubble .md` 段（token 驱动，不写死色值）。
 *
 * ## ⚠️ 为什么要 `memo`（2026-10-24）
 *
 * `react-markdown` 的解析（remark parse → gfm → breaks → hast → react）**每次 render
 * 都会完整重跑一遍**，本身没有缓存。而 `App` 的任何 state 变化（画布打字、选字、
 * 流式 chunk、面板尺寸…）都会让它下面整棵树重渲 ⇒ 聊天越长，一次重渲越慢。
 * 实测（60 条消息、约 42 KB 文本）：纯文本 render 0.6 ms，走 Markdown 要 66 ms。
 *
 * ⇒ 这里按 `text` 做记忆化：文本没变就直接复用上一次的元素树。
 * 消息行另有一层记忆化（见 `ConversationPanel` 的 `MessageRow`）——流式时只有
 * **正在变的那一条**会重新解析，历史消息全部跳过。
 */
import { memo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';

/**
 * 渲染器配置与插件表放在模块级：它们与 `text` 无关，没必要每次 render 新建一份。
 * `a` 不展开 `props` —— react-markdown 会带一个 `node` 字段，摊到 DOM 上会告警。
 */
const MD_COMPONENTS: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ),
};

const MD_PLUGINS = [remarkGfm, remarkBreaks];

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={MD_PLUGINS} components={MD_COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
