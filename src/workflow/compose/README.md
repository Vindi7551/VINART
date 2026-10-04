# compose —— 最终组装

这个阶段消费前两个阶段的产物：把**版式**（`design-sketch.json`）与**素材**
（`assetsgen` 产出的 PNG）合成可交付的成品图。

---

## 产物分工——三件东西，三种受众

| 文件 | 是什么 | 给谁 |
|---|---|---|
| `final.linked.html` | **版式源码**（相对路径引用素材，人可读）| **你**——改 CSS/文案 → 重跑 final，零模型调用 |
| `final.html` | **自包含快照**（图以 data URL 内联）| 分享 / 存档——单文件到处能开 |
| `final.png` | **成品图**（Blink 渲自包含版）| Amazon——上传交付 |

**PNG 不是源头，HTML 才是。** 文字零 typo 的保证在 HTML+CSS 里；
想改任何东西都是"改源码 → 重跑渲染 → 新 PNG"，PNG 随时可再生。

## 文件

| 文件 | 职责 |
|---|---|
| `assemble.ts` | `assembleFinal()`：缺素材检查 → 文字自适应（实测两遍）→ 双输出 HTML → 渲 PNG |
| `emit-html.ts` | 占位符替换 + 双输出 HTML + 溯源注释头（这张图怎么来的完整档案）|

**入口**：`scripts/step-layout.ts -- <规格.json> final [--no-library]`

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
