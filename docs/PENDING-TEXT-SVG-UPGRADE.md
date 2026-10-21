# 待决策：普通文字的渐变描边/装饰线 → 自动升级 SVG

> **状态：只记录，未实现（2026-10-18）。**
> 用户明确要求"先放着、后面再讨论"，所以本轮不动渲染实现；这份文档把现状、
> 约束和候选方案钉住，避免下次重新推一遍。

## 1. 问题

`type:'text'` 的普通文字（没有 `curve` / `path`）走 HTML 排版（`.vt` + `span`）。
HTML 的 `-webkit-text-stroke` 和 `text-decoration-color` **只接受纯色**，表达不了渐变。

所以现在 `tx-stroke` 这种普通文字设了渐变描边时：

- `emitText` 把渐变描边**取首色近似**（`firstPaintColor`），并报 `note`；
- 描边不会消失，但**不是完整渐变**；
- 用户的原话："我都用渐变描边了那就不是普通的文字了吧？这是不应该自动升级吗？
  应该是用 svg 进行升级的吧？"

**方向是对的**：渐变描边/装饰线在 HTML 里做不到，SVG `<textPath>` 才是正确路径。
问题在"自动"这一步会顺带改变排版/编辑/盒子语义，必须先定边界。

## 2. 现状（截至 2026-10-18，未提交的工作区）

### 2.1 普通文字

| 情况 | 现在 |
|---|---|
| 节点 `fill` 是渐变 / 多层 | ✅ HTML `background-clip:text`；多层里纯色只当 `background-color`，渐变/url 进 `background-image` |
| run `fill` 是渐变 | ✅ 每段自己裁剪 |
| 节点/run 的 `fill` 纯色相等 | ✅ 视为冗余（`effectiveRunColor`），不盖住节点渐变 |
| **`stroke.paint` 是渐变** | ⚠️ **首色近似** + `note`（`-webkit-text-stroke` 只吃纯色） |
| **`decoration.color` 是渐变** | ⚠️ **首色近似** + `note`（`text-decoration-color` 只吃纯色） |

相关代码：

- `src/render/vocabulary/emit.ts`：`firstPaintColor` / `effectiveRunColor` / `lastPlainFill`、
  `emitText` 的 `fillClip`、`decoLineCss`、`decoColorSvg`；
- `src/editor/inspector.ts`：普通文字的描边色/线色 paint 字段带 `hint`；
- `src/ui/paint-editor.tsx`：对话框里显示该提示。

### 2.2 SVG 路径文字（`<textPath>`）

`curve` / `path` 走的这条渲染路径**已经支持**：

- 完整渐变描边（`stroke="url(#…)"`）；
- `curve` 的渐变装饰线（自定义 `<path>` + 渐变）；
- 多层 fill、run 级渐变、2 层 fill 的底层/顶层；
- 描边、装饰线、`data-run` 选区。

但它也有硬限制：

- 结构上**单行**（`\n` / `wrap:'normal'` / `dropCap` / `alignLast` 都被 note 掉）；
- 必须有 `frame.h` 作为 viewBox 高度（普通文字没有 h，高度是撑开的）；
- **文字比路径长时，超出部分不渲染**；
- 不是 contentEditable；编辑器现有的处理是"编辑期间降级成普通文字"（见
  `src/render/vocabulary/README.md` 的沿路径排字一节）。

## 3. 目标

普通文字一旦用了**渐变描边**或**渐变装饰线**，渲染上自动/显式切换到 SVG，
得到完整渐变，而不是首色近似。

## 4. 必须一起定的边界

1. **安全区**：无 `\n`、无 `wrap:'normal'`、无 `dropCap`、无竖排 `writingMode`、
   无方向的复杂情况。多行/折行文字怎么处理：
   - 先只做单行，其余首色 + 提示；还是
   - 多行也逐行生成 SVG `<text>`（需要自己算行/对齐/换行，工作量大）。
2. **高度/盒子**：SVG 要固定 `viewBox` 高度；普通文字的高度是自动的。自动升级会补
   `frame.h`（或内部计算 h），选中框从 HTML 行盒变成 SVG 盒，可能影响版面。
   这触碰项目"**版式 vs 外观**"的边界：渐变描边本身是外观，升级却改了版式。
3. **编辑**：SVG 不是 contentEditable。好消息是编辑器对 `curve`/`path` 文字已有
   "编辑期间降级成普通文字"的机制，可以复用；代价是编辑时不是最终 SVG 效果。
   也可以做"视觉 SVG + 透明 HTML 编辑层"的混合，但成本高。
4. **路径长度**：SVG 文字超出 path 直接不渲染；普通文字会折行/溢出。自动升级后，
   文字变长可能"凭空消失"，需要路径给够或字号缩小，且要有 note。
5. **对齐/基线/字距**：HTML 行盒 vs `<textPath>` 的 `startOffset`/`text-anchor`/baseline，
   要逐项对齐；`fit.ts` 目前零生产调用，量高/量宽都要另想办法。
6. **文档表示**：
   - **渲染器隐式自动**（doc 不变）：AI 写的 doc 也自动生效；但同一份 doc 的渲染路径
     由外观隐式决定，且升级不改 doc、不可撤销；
   - **编辑器写入 doc**（直 `path` 或新增 `render:'svg'` + `frame.h`）：显式、可撤销、
     可被 AI 带上；但要改模型/迁移，旧 doc 仍需渲染器兜底。
7. **渐变装饰线**：`curve` 有自定义装饰线；直 path（或直 SVG 文字）没有，需要补
   "直线装饰线"逻辑，否则升到 SVG 后装饰线又退回纯色。

## 5. 候选方案

| 方案 | 做法 | 优点 | 代价 |
|---|---|---|---|
| **A. 渲染器自动（单行安全区）** | 检测到普通文字 + 渐变描边/装饰线 + 单行安全条件 → 自动走 SVG 直 path；doc 不变；编辑器显示 badge | AI/doc 自动生效；无需改模型 | 隐式改版面/编辑；多行只能首色；h 要内部算 |
| **B. 编辑器自动 + 写 doc** | 编辑器检测到渐变Paint → 自动转成直 `path`（或 `render:'svg'`）+ h；可撤销；badge | 显式、可复现、可撤销；AI 可带 | 要改 doc/迁移；AI 旧 doc 仍需兜底 |
| **C. 显式"升级为 SVG 文字"** | 用户点按钮/勾选；写 doc | 最稳，不偷偷改版式 | 不是"自动" |
| **D. 混合（视觉 SVG + HTML 编辑层）** | 显示 SVG；按需覆盖透明 contentEditable | UX 最好，编辑不丢 | 布局对齐/光标/选区成本最高 |

## 6. 当前倾向（待用户拍板）

**A + 编辑器提示/badge**：

- 渲染器自动升级**只限单行安全区**；多行/换行/竖排/首字下沉继续 HTML + 首色 + note；
- 升级时在 `notes` 里写"已自动切换为 SVG 文字"，编辑器显示 badge；
- 高度按字号 × 行高计算（或从当前 DOM 量），并接受选中框变化；
- 编辑复用现有"编辑期间降级成普通文字"的机制，先不做透明编辑层；
- doc 暂不改模型；如果后面要"可撤销/可被 AI 显式带上"，再加 `render:'svg'` 或直 `path`。

**没有拍板前不要动实现。**

## 7. 待补验证（以后实现时）

- 单行普通文字 + 渐变描边：自动 SVG，`stroke="url(#…)"`，完整渐变；2 层 fill 保留；
- 多行/换行：仍 HTML + 首色 + note；
- 渐变装饰线：SVG 直线装饰线也完整渐变；
- 选中框/命中测试/内容编辑/撤销；
- 编辑器 badge/提示；
- 反向验证：把自动升级退回去，探针必须失败。

## 8. 相关文件

- 渲染：`src/render/vocabulary/emit.ts`（`emitText` / `emitPathText` / `firstPaintColor` /
  `effectiveRunColor` / `lastPlainFill` / `decoLineCss` / `decoColorSvg`）
- 面板字段：`src/editor/inspector.ts`（普通文字的 paint `hint`）
- 编辑器：`src/ui/paint-editor.tsx`（提示）、`src/editor/vocab-editor.ts`、
  `src/editor/text-session.ts`（编辑降级）
- 文档：`src/render/vocabulary/README.md`、`src/document/README.md`
- 测试：`test/emit-path-stroke.test.ts`、`test/paint.test.ts`
