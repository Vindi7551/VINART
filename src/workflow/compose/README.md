# compose —— 最终组装

这个阶段消费前两个阶段的产物：把**版式**（`design-sketch.json`）与**素材**
（`assetsgen` 产出的 PNG）合成可交付的成品图。

---

## 产物——只有一件

| 文件 | 是什么 | 给谁 |
|---|---|---|
| `final.png` | **成品图**（Blink 渲自包含 HTML）| Amazon——上传交付 |

⚠️ 以前还落盘 `final.html`（自包含快照）与 `final.linked.html`（相对路径源码），
**2026-10-09 删除**。理由：PNG 渲染用的是**内存里的 HTML 字符串**、从不读文件；
网页可编辑视图也由服务端**现场渲染**——两者零消费方。而且"手改 CSS 再重渲"
那条回路本就自相矛盾：CSS 是渲染器从 spec 生成的，手改必被下一次 final 覆盖。
改版式的正规入口是 **spec + 编辑器**（`design-sketch.json` / `design-appearance.json`）。

**PNG 不是源头，spec 才是。** 文字零 typo 的保证在渲染器生成的 HTML+CSS 里；
想改任何东西都是"改 spec → 重渲 → 新 PNG"，PNG 随时可再生（零模型调用）。

## 文件

| 文件 | 职责 |
|---|---|
| `assemble.ts` | `assembleFinal()`：缺素材检查 → 文字自适应（实测两遍）→ 组装自包含 HTML → 渲 PNG |
| `emit-html.ts` | 占位符 → data URL 内联 + 溯源注释头（**只产出 HTML 字符串，不落盘**）|

**入口**：聊天链的 `render_design` 工具（`designharness/tools/render-design.ts`）调 `assembleFinal()`。

## 文字自适应——为什么"渲两遍"

纯 CSS 做不到"字号自动缩到装得下"，必须实测：

```
a. 占位符换成真素材 → 得到可渲染的完整 HTML
b. 浏览器 setContent，等 document.fonts.ready
   （woff2 内联是异步的——不等就量 = 量到兜底字体的宽，系数全错）
c. 逐 text 节点量 .btfit 的 scrollWidth（需要）vs clientWidth（可用）
   need > avail → fits[id] = avail / need
d. 回填系数，重渲第二遍
```

⚠️ 每个 text 节点的 HTML 必须带 `data-fit`（外层）+ `.btfit`（内层）标记——
测量靠它定位。**实测教训：重构渲染器时丢了这两个标记，自适应静默失效，
永远显示"全部装得下"。** 验证方法是爆宽用例（把某个 fontScale 拉爆），
看能不能输出精确系数。

## 缺素材检查

任一素材文件缺失 → **中止**，不渲染。继续的话会渲出"断图空壳"：
PNG 体积明显偏小（渲染器里有 <200KB 的体积异常告警），容易被误判成功。

## 不在这里的

版式渲染器（`design-sketch/render.ts`）· 素材生成（`assetsgen/`）·
草图渲染（`design-sketch/sketch.ts`）——本阶段只**消费**它们的产物。
