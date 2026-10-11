# `src/editor/` —— 编辑器层

**设计文档在项目级：[`docs/EDITOR-EVOLUTION.md`](../../docs/EDITOR-EVOLUTION.md)**
（现状调查 + 类 PS 演进方案 + 分阶段验收判据 + 未决问题）。**动本目录前先读它。**

## 一句话

编辑器不住在子文档里，而是**住在父文档**、只把子文档当**被操作对象**的一层。
`iframe` 退化为纯渲染器（`pointer-events:none`、不含脚本），交互由父文档的覆盖层接管。

## 模块

| 文件 | 状态 | 职责 |
| --- | --- | --- |
| `types.ts` | ✅ | 契约：`EditorSpec` / `LayerPatch` / `LayerDom` / `HostDom` / `Viewport` / `Hit` / 手势会话 |
| `geometry.ts` | ✅ | **纯函数**：坐标换算、比例 ↔ local px、move/resize/rotate 解算。可 `vitest` 直测 |
| `hit-test.ts` | ✅ | 命中测试**两段式**：先装饰件、再问子文档 |
| `target.ts` | ✅ | ⭐目标适配器 —— **本目录唯一接触子文档的地方** |
| `overlay.ts` | ✅ | 父文档覆盖层：选中框 / 四角手柄 / 旋转柄（挂进 `.canvas-wrapper`） |
| `index.ts` | ✅ | `createEditor(host, wrap, target, opts) → EditorHandle`；手势状态机与编排 |
| `commands.ts` / `state.ts` / `tools/` | ⏳ M2+ | 命令栈（撤销/重做）、工具枚举、图层管理 |

## 两条不变量（都可机器断言）

### ① `src/editor/` 不引用任何全局网页对象

所有文档对象（**宿主 `Document`、挂载点元素、子文档 root**）都**从参数流入**；
编辑器不认识"当前页面"是谁。

保证的形状要说准：编辑器**碰不到任何没被注入的东西** —— 它没有 `document`、
`window` 可用，所以既到不了父页面的别处，也到不了别的 iframe。
这是**结构性**约束，不是沙箱强制的（沙箱会把编辑器逼回"注入进子文档"的老路，
见设计文档 §4.4）。

```bash
grep -nE '\b(document|window)\b' src/editor/*.ts   # 必须 0 命中
```

### ② 子文档内 `<script>` 数恒为 0

`srcdoc` 只保留渲染产物本身 + 一个 `<base>` 标签；不再注入数据块与编辑脚本。
在真实 app 上由 `scripts/_probe-m1-invariants.ts` 断言（同时断言子文档里没有覆盖层残留）。

## 跑测试

```bash
npm test                                           # 几何 / 命中的纯函数单测（33 条）
npm run step scripts/_probe-editor-behaviour.ts    # 真实 app 的行为契约（20 条）
npm run step scripts/_probe-m1-invariants.ts       # M1 不变量（19 条）
```

> 行为契约的**基线数值**记在 `.workbuddy/memory/DETAILS.md §14.6`。
> 改本目录之后必须逐条一致，否则就是功能回退。
