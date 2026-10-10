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
 */
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';

export function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          // 不展开 props（react-markdown 会带一个 `node` 字段，摊到 DOM 上会告警）
          a: (props) => (
            <a href={props.href} target="_blank" rel="noreferrer noopener">
              {props.children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
