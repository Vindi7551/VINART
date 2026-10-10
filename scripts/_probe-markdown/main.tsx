/**
 * Markdown 观测台 —— 把 `Markdown.tsx` 的输出放进**真实的 `.chat-bubble` 外壳**里看。
 *
 * 为什么要单独一页：Markdown 这套样式是**视觉问题**（段落间距、列表缩进、
 * 代码块底色、表格宽度、粗体是否够粗），只看 DOM 断言判断不了"读起来舒不舒服"。
 * 这里并排渲染若干代表样本，截图放大核对。
 *
 * 打开： http://localhost:5173/scripts/_probe-markdown/index.html
 *
 * ⚠️ 只读页面：全是静态字符串，不发请求、不写盘。
 */
import { createRoot } from 'react-dom/client';
import '../../src/ui/index.css';
import { Markdown } from '../../src/ui/Markdown';

/** 样本 1 = **用户截图里那条真实回复的原文**（逐字，含 `**`/`- `/`✗` 等） */
const REAL_REPLY = `这张参考图的版式骨架我能拆出来复用，但要动手前得先把内容定死（子 agent 拿不到我们的对话，逐字文案必须写全）：

**参考图可复用的骨架**
- 竖版海报（约 2:3），主体人物大图占左侧 2/3，右下方留白
- 右上角主标题：粗笔**红字 + 黑字**双行错落，下方一行英文小字
- 右侧中部两行宣传语（大字号，右对齐偏中）
- 中部偏右一个**光晕亮点**（暖黄逆光）
- 右下角**圆形红色印章 + 大号分数**（如 9.1 分）
- 底部一排极小字（出品/联合 logo 条）

**要你补 4 件事：**
1. **用途与名称**：电影？活动？产品？主标题叫什么
2. **逐字文案**：主标题（中文几字，红/黑怎么分）、英文行、宣传语两行、日期或口号、印章里的文字和分数
3. **画面主体**：沿用「大人 + 小孩牵手、逆光暖调」这种构图，还是换成别的（比如产品、单人、群像）？
4. **素材来源**：主体人物我可以直接生成一版 AI 人物/场景图（付费，要先给你清单确认）；如果你有自己的图，放进 \`uploads/\` 告诉我文件名

给齐这 4 项我就委派出草图；只想先看骨架的话，说一声「先按参考图的文案来」，我可以用同名电影文案先搭一版草案给你看构图。`;

/** 样本 2 = 会话里另一条真实回复（含 ## 标题与行内代码） */
const REAL_REPLY_2 = `我按当前打开的 **POSTER02** 编了配色；因为方向你还没拍板，**POSTER01 我也一起编了一版**——两版色板并排看，正好帮你定方向。都是看女主那张图取色（几毛钱的事）。两版配色都编好了，各自存在 \`designs/POSTER0*/design-appearance.json\`，渲染时自动采用。

## POSTER02 · 明亮青春（当前打开的这版）
基调：暖米白纸感 + 雾玫瑰，淡紫点睛

## POSTER01 · 夜色舞台
基调：深蓝夜色 + 暖黄逆光`;

/** 样本 3 = 代码块 / 表格 / 链接 / 任务列表 / 删除线 / 引用（GFM 覆盖） */
const GFM = `改完重渲：**零 API 成本**。

\`\`\`json
{
  "name": "POSTER01",
  "canvas": { "width": 2000, "height": 3000 },
  "layers": [{ "id": "bg", "type": "image" }]
}
\`\`\`

| 图层 | 类型 | 说明 |
| --- | --- | --- |
| bg | image | 舞台背景 |
| title_cn | text | 中文主标题 |

- [x] 骨架拆解
- [ ] 逐字文案待定

~~旧方案~~ → 新方案。本地地址：http://localhost:5173

> 注意：视觉性问题必须渲染出来看。`;

/** 样本 4 = 边界：单换行（靠 remark-breaks 保住）、词间 `_` 与 `*` 的差别、长路径 */
const EDGE = `第一行
第二行（上面这行是单个换行，必须留住）

下划线在词间不配对（我们的图层 id 全指望这条）：title_cn 与 title_en

星号在词间会配对（CommonMark 行为，已知边界）：2*3*4

长路径不该被吃掉：\`test_product/layout/lead_portrait\``;

const CASES: { title: string; role: 'assistant'; body: string }[] = [
  { title: '① 你截图里那条真实回复（逐字原文）', role: 'assistant', body: REAL_REPLY },
  { title: '② 会话里的另一条真实回复', role: 'assistant', body: REAL_REPLY_2 },
  { title: '③ GFM：代码块 / 表格 / 链接 / 任务列表 / 删除线 / 引用', role: 'assistant', body: GFM },
  { title: '④ 边界：单换行 / 星号不误解析', role: 'assistant', body: EDGE },
];

function Harness() {
  return (
    <div className="chat-stream" style={{ padding: 16, width: 820, margin: '0 auto' }}>
      {CASES.map((c) => (
        <div key={c.title} style={{ marginBottom: 18 }}>
          <div className="chat-msg-label">{c.title}</div>
          <div className={`chat-msg ${c.role}`} data-probe-case={c.title}>
            <div className="chat-bubble">
              <Markdown text={c.body} />
            </div>
          </div>
          <div className="chat-msg user" style={{ marginTop: 8 }}>
            <div className="chat-bubble">
              {'用户气泡不解析 Markdown，但换行要留住：\n第二行 **这两个星号原样显示**'}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Harness />);
