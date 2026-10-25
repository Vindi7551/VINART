# CLAUDE.md

本文件只放 **AI 助手的工作约定**。项目说明、架构、命令与已知限制以 [`README.md`](README.md) 为准；
模块细节见 README 的「文档地图」。文档冲突时以代码与 README 为准，并顺手修正过时处。

## 工作约定

- **不自行提交**：用户明确要求后才 `git add` / `git commit`；提交信息用中文。
- 提交前 `npx tsc --noEmit` 必须零错误；改逻辑后跑 `npm test`。
- **dev 服务由用户启动**（Vite 5173 / API 8787）。AI 不挂后台任务起服务，只访问已启动的实例；
  改 `emit.ts` / `vocabulary.ts` / `server/` 后提醒重启 API，改前端后提醒刷新页面。
- 改文件只用编辑工具。**不要用 PowerShell 的 `Set-Content` / `-replace` 改源码**——UTF-8 中文会乱码。
- 不提交 `keys.json`、字体二进制、`test_product/` 等本地产物（见 `.gitignore`）。
- `npm run step <file.ts>` 只是通用 TS 脚本运行器，不是固定流水线入口。
- 本机沙箱若因 esbuild `spawn EPERM` 起不来，API/探针改用
  `node --experimental-transform-types --import ./scripts/_ts-resolve.mjs <脚本>`。

## 项目不变量

- **一个文档模型**：`src/document/vocabulary.ts`；落盘只有 `doc.json`。
  不要重建已删除的旧契约（`design-sketch` / `design-appearance` / `render/declarative` /
  `workflow/compose` / `workflow/appearance` / `workflow/steps`）。
- **渲染 ≠ 方案生成**：`emitDocument` 是纯函数（文档 → HTML）；模型只参与方案生成。
  截图/栅格化是后面的独立步骤。
- **两套坐标**：AI 工具用 0–1；`doc.json` 的几何是 px；`src/workflow/translate/` 是唯一换算点。
- **编辑器住在父文档**：iframe 只做渲染器，不注入脚本；选中框、手柄、文字选区都在父侧。
- 改文档字段要同时检查 `vocabulary.ts`、`emit.ts`、编辑器、AI 工具和测试，
  避免「渲染支持、编辑器不支持」的静默陷阱。
- 文档入口是 README；不要再新增平行的项目说明/架构文档。模块深挖保留在现有文件里：
  `src/document/README.md`、`src/editor/README.md`、`src/render/vocabulary/README.md` 等。

## 验证与排查

- 只认硬证据：`tsc --noEmit` / `git diff` / 运行时 DOM / 探针断言；不要凭工具转录肉眼判断。
- 探针要断言、不要打印；新探针要能证明「把修复退回去就会失败」。
- UI 冒烟必须断言几何；改完前端要真的加载一次页面。
- 产物体积突变是最便宜的异常信号（PNG 骤降 = 断图）。
- CSS 只用 `/* */` 注释；`//` 会吞掉紧随其后的声明。
- 删入口/改字段前先 grep 调用方；「有 import」不等于「还活着」。

## 历史存档（别当现值）

- `designassets/layouts/*` 里的 `design-sketch.json` / `design-appearance.json` / `sketch.html`
  是旧契约资产，当前代码不读。
- `test_product/vocab-points/vector-demo.html` 是手写死的旧模型快照，不是当前渲染/DOM 的参照。

命令与目录见 README。
