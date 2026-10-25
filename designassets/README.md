# designassets —— 设计资产库

当前代码真正读取的只有两处：

- `builtin/placeholder.svg`：占位图（`@placeholder`），预览/出图时由服务端内联；
- `fonts/families/*`：字体注册表（`src/fonts/registry.ts` → `/api/fonts/...`）。

其余目录是素材库或历史存档，当前链路不一定自动接线。

## 目录

```text
designassets/
├── builtin/placeholder.svg     占位图
├── elements/
│   ├── icons/*.svg             图标（14 个，currentColor）
│   └── palette/*.json          配色方案
├── textures/                   纹理素材（brush-stroke.png）
├── fonts/
│   ├── families/<Family>/      family.json + 字重文件
│   └── schemes/                旧链命名方案（当前未接线）
└── layouts/                    旧契约版式资产（历史存档）
```

## 字体

每个家族一个目录：`family.json` 描述 `family` / `dir` / `weights` / `files` / `license`，
字体文件按 `files` 里的文件名放置。`src/fonts/registry.ts` 扫描
`fonts/families/*/family.json`，缺文件或字段不合法的家族会被跳过。

- 字体是**完整文件，不做子集**：预览、编辑器、出图共用同一套 URL。
- 新增字体文件会被 `.gitignore` 排除；仓库里已有的拉丁字体随仓库分发，
  中文字体（`NotoSansSC` / `NotoSerifSC`）只跟踪元数据，换机器时要按 `family.json` 补齐。
- 中文设计至少需要 `NotoSansSC` 或 `NotoSerifSC` 的字重文件。
- `fonts/schemes/` 是旧链的命名排版方案，当前代码未读取。

## 元素

- `elements/icons/*.svg`：线框图标，内部用 `currentColor`；当前还没有“按名取”的入口，
  模型生成的图标走 `generate_assets` 的 `icons`，由工具做安全检查后落盘。
- `elements/palette/*.json`：配色方案素材，当前由设计流程按需引用。
- `textures/`：纹理素材（如笔刷 PNG）。

## 历史版式

`layouts/` 里的 `design-sketch.json` / `design-appearance.json` / `sketch.html` 是旧契约资产，
当前代码不读，不要当模板或现行格式参照。

## 入库规则

`designassets/` 只放**用户认定值得沉淀**的资产；工作产物与生成图留在会话工作目录
（`<workDir>/designs/`），不要自动倒进这里。
