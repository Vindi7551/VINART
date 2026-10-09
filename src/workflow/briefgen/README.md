# briefgen —— 创意方案（brief）生成

链 A 的归宿：**产品照 + 卖点 → compile 可直接吃的 brief md**。

此前这条链断在 step-03（产出的槽位 JSON 没人消费）——compile 的输入是
自由格式的创意方案 md（手写，`test_product/briefs/*.md`）。本模块把链 A
翻新到底：最后一步把结构化规划「翻译」成那种 md。

## 四步

| 步 | 模块 | 输入 → 输出 |
|---|---|---|
| ① 图像识别 | `perceive.ts` | 产品照 → 可见事实 JSON（含 uncertain，不猜） |
| ② 卖点审计 | `claims.ts` | 事实 + 五点描述 → 要素级证据状态（已有证据/可补证/无法证明） |
| ③ 套图规划 | `plan.ts` | 要素清单 → 图位方案 MAIN+PT01…（购买问题归并 + 覆盖验收） |
| ④ brief 编写 | `draft.ts` | 规划 + 卖点 + 事实 → **每个图位一份 brief md** |

⚠️ **没有 CLI 入口了**。此前这四个模块各配一个 `npm run step` 薄壳
（`src/workflow/steps/step-01..04`），2026-10-09 随整层入口一起删除。

现在怎么用：**产品链路已把这四步整体搬进对话**——`amazon-listing` 技能手册
（内容就源自本目录）把流程与规范直接交给主 AI，主 AI 自己看图/审计/规划/
写方案，产物留对话内。本目录的四个模块是那套流程的**代码化实现与规范来源**；
要单跑时从模块导出调用（`perceiveProduct` / `auditClaims` / `planSlots` / `draftBrief`）。

产出落点：中间产物（识别/审计/规划 JSON）在 `test_product/` 根目录；
**brief 落 `test_product/briefs/<产品名>-<slot>.md`**——与手写 brief 同目录，
compile 用法不变：`npm run step src/workflow/design-sketch/compile.ts -- test_product/briefs/xxx.md`。

## 设计决策

- **旧 step-04（三层设计草案）职责已被 compile 取代**——compile 吃 brief 直接产
  版式 + VLM 视觉验收，可回喂修正。旧脚本移入 `.backup/`。
- **plan 砍掉了两块旧职责**：版式草案（归 compile）、生成提示词（归 assetsgen/order，
  订单编写模型按生图模型方言写，规划层代写只会产出不合规范的废文案）。
  规划层只回答「做哪几张图、每张回答什么购买问题、图上写什么字」。
- **语言中性**（2026-10-02）：listing 面向哪个市场是业务输入（`--lang`，默认 de），
  不写死德语；输出字段不再带 `_de` 后缀。
  ⚠️ 这里的 lang 是 **listing 市场语言**（图内文字语言）——与 compile 的
  `--prompt-lang`（生图提示词语言，读者是模型）是**两回事**。
- **MAIN 跳过**：纯白底 + 抠图 + 禁文字，机械处理没有设计决策，走图像处理管线。
- **每步单独可跑、产物肉眼可验收**：终端打印分组摘要 + JSON/MD 落盘。
- brief 的程序化验收：**图内文案必须逐字出现**（compile 被要求文案一字不漏，
  brief 漏字 = 成品漏字）。
- 全部 gateway.stream 直调（与 order.ts / compile.ts 同模式），不再走
  session/context 封装。
