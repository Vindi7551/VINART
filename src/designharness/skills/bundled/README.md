# bundled skills（产品内置）

这里放**随产品发布**的能力说明书。运行时**自动扫描本目录**：每个子目录一份 `SKILL.md`。

```
src/designharness/skills/bundled/
└── <name>/
    ├── SKILL.md          必需（带 frontmatter）
    └── …                 可选附属文件（正文里写相对路径，模型用 skill 的 file 参数按需取）
```

## 规则

- **同名优先级最高**：`bundled > project > user`。产品事实不能被用户/项目用一份写错的覆盖。
- **只放“产品自身的能力说明 / 硬规则”**；行业领域知识（Amazon listing、eBay 方法论等）
  走用户全局层，不要塞进这里。
- 目录随代码发布，打包后用户改不到。
- **改 / 加 / 删 skill 文件下一轮 chat 生效**（catalog 每轮现场扫描），不用重启 API。

## SKILL.md 格式

```md
---
name: asset-prompting
description: 一句话路由描述（进 <available_skills> 目录）
whenToUse: 什么时候该加载它（可选）
---

正文：模型加载后要遵守的指令。
附属文件直接写相对路径，如「参考 `references/rules.md`」。
```
