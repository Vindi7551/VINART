# 会话层设计（SESSIONS.md）

> **状态：已实施。** 本文档描述**当前**实现（早期的"待实施"方案稿已作废——它写的是
> `test_product/sessions/` 那套旧布局，早已不复存在）。
>
> **真源**：`src/designharness/session/transcript.ts`（类型 / 常量 / 行为）
> + `src/server/index.ts`（HTTP 面）。本文是给人读的设计说明；
> 逐条**实测**结论在探针 `scripts/_probe-sessions-store.ts` / `_probe-workdir-claim.ts` /
> `_probe-ui-workdir.ts` / `_probe-ui-session-home.ts`。
>
> **核心原则：会话事件流（JSONL）是持久层；索引与内存态都是派生物** —— 崩溃安全、可重放、可对账重建。

> ⚠️ **待决策（2026-10-18 记录，未实现）**：harness 与词表 / emit / 编辑器的接线，
> 尤其是"AI 读当前 doc"的三种方案（服务端内存 / chat 带 doc / chat 前 flush），见
> [`docs/PENDING-HARNESS-DOC-CONTEXT.md`](../../docs/PENDING-HARNESS-DOC-CONTEXT.md)。先记录，别当已实现。

## 0. 语义：会话 = 一次连续的设计工作史

对话消息与设计操作（打开版式 / 保存 spec / 重渲 / 派子 agent）走**同一条事件流**——
「圈选某元素重新生成」这类需求因此天然拥有完整上下文：对话史 + 操作史 + 产物引用。
`sessionId` 贯穿四端：前端（localStorage）→ API（路由）→ harness（ChatSession 实例）→ 事件文件名。

## 1. 存储布局

```
<工作目录>/.vinart/sessions/
├── index.json                                   该目录的会话索引（列表免重放；缓存，可重建）
├── <sessionId>.jsonl                            每会话一个追加文件（第一行 = 诞生 meta）
└── agents/<sessionId>/<runId>/transcript.jsonl  子 agent 账本（每次 spawn 一份）

~/.vinart/workdirs.json                          中央注册表：只存目录路径，不含任何会话数据
```

**「会话跟着工作目录走」——数据与归属同处一地。** 删掉那个目录 = 它的会话与账本一起消失，
**零清理逻辑**，也不会出现"目录没了、对话还在"。

### 子 agent 账本

主 AI 调 `spawn_design_agents` 派出子 agent 时，**每次运行（一个 `runId`）一份账本**，
记录 `spawn`（任务/工具/轮数上限）→ `model`（轮次、工具调用、token 消耗）→ `tool`（工具名、是否报错、结果摘要）。
它与会话**同生命周期**：`deleteSession` 会级联 `rm agents/<sessionId>`（见 §4.3）。

## 2. 事件模型

```ts
type ArtifactRef = { layout: string; file?: string; element?: string };

type SessionEvent =
  | { seq?: number; ts: string; kind: 'message';
      id: string; role: 'user' | 'assistant'; text: string;
      refs?: ArtifactRef[];
      /** 随消息上传的图片：**相对 workDir 的路径**（本体落 <workDir>/uploads/） */
      images?: string[];
      /** 与 images 平行对应的 Files API file_id；有值则重放时不读文件、直接引用 */
      fileIds?: string[] }
  | { seq?: number; ts: string; kind: 'action';
      action: 'open-layout' | 'save-spec' | 'render' | 'pipeline-start' | 'pipeline-done'
            | 'agent-spawn' | 'agent-result'   // 子 agent 记账对（以 detail.runId 配对）
            | 'tool-call';                      // 主 AI 工具循环的中间轮（审计用，不喂模型）
      detail: Record<string, unknown> }
  | { seq?: number; ts: string; kind: 'meta'; title?: string; workDir?: string; project?: string };
```

- **`seq` 不落盘**：写入时省略，读取（`readEvents`）时按行序赋号。
- **事件只追加、永不改写**；坏行（半截写入 / 进程中断）加载时**跳过**，不影响之前的事件 → 崩溃安全。
- **大内容外置**：截图 / PNG 不进 JSONL，事件里只放路径引用（`refs.file` / `images`），
  图片本体落 `<workDir>/uploads/`。
- `project` 字段**仅老数据**仍带（项目层已拆除）；新写入不再产生。
- `deriveMessages(events, workDir)` → `ChatMessage[]`（重放：只取 `message` 事件；
  带图消息两代数据并存——有 `fileIds` 走 Files 引用，只有 `images` 则回读文件编码 dataURL，
  读不到时退化为文本占位符，**不阻塞会话恢复**）。

### 索引条目（列表页快，免重放）

```ts
interface SessionIndexEntry {
  id: string;
  title: string;            // 首条用户消息前 20 字，缺则"新会话"
  updatedAt: string;
  messageCount: number;
  workDir: string | null;   // 事件流里**最后一条** meta 的 workDir（null = 从未设置）
  home: string;             // 数据实际落点（= 工作目录）。**由文件位置决定，不由 meta 决定**
}
```

索引是**缓存**，事件流才是持久层。缓存会漂（手拷目录、外部改动、早于 `touchIndex` 的历史数据、索引被截断），
所以 `reconcileDirIndex` 以事件流为准修它：**补登**（有文件没条目）/ **删幽灵**（有条目没文件）/
**修正**（字段与事件流不符）；已一致则**零写盘**。

## 3. 惰性会话

`createSession(workDir)` **只分配 id + 登记落点**，不落盘、不写索引、**不建目录**。
第一个事件真正追加时才建文件——**第一行就是诞生 meta，把 workDir 固化进事件流**：

```
{"ts":"…","kind":"meta","workDir":"D:\\…\\test_product"}
```

⇒ 空会话在磁盘上**不存在**，也不进列表（`listSessions` 只返回 `messageCount > 0` 的条目）。
「只是选一下目录 / 建个会话」不得在用户目录里留下任何东西——`mkdir` 的唯一执行者是
`appendEventInner`（真要写第一行时）。

## 4. 生命周期

### 4.1 认领即锁（workDir 不可更改）

工作目录**在创建时绑定、之后不可更改**——换目录 = 新开会话。`setWorkDir` 只对**尚未落盘**的惰性会话有效，
否则抛错 → API 返回 **409**。前端对应：没选目录不允许开聊（输入框 disabled + 后端 400）、
已绑定会话的 📂 按钮置灰。

### 4.2 注册与认领

- `registerRoot(dir)`：登记进注册表（幂等）。**写前先与注册表对账**——同一目录的不同写法
  （`D:/a` vs `D:\a`、大小写、尾斜杠）按 `rootKey` 归一去重，**只留规范形式**，否则列表遍历两遍、
  前端还会长出两个同名组头。
- `claimWorkDir(dir)` = `registerRoot` + `reconcileDirIndex` —— **「选目录」这个动作的后端语义**。
  打开一个已有数据的目录，立刻能看到里面真实存在的会话，而不是等你在那儿说第一句话才认回来。
  目录不存在时**零副作用**（不建目录）。

### 4.3 删除

`deleteSession(id)` 三件事：删 `<id>.jsonl` → **级联删 `agents/<id>`**（子 agent 账本与会话同生命周期；
`force:true`，无账本目录也不报错）→ 从**它所在目录**的索引里摘掉该条目。
**产物（`designs/`）不受影响**——删的是对话记录，不是画出来的图。

> ⚠️ 该级联是 `9e4358e`(2026-10-09) 才补上的；`14e719a`(10-08) 引入账本时 `deleteSession` 只删主账本。
> 因此 **10-08 ~ 10-09 窗口内删掉的会话会残留孤儿账本**（不可达死数据，只能手工清）。

## 5. 注册表与自愈

⚠️ **注册表是列表的唯一入口**：`listSessions` 遍历 `~/.vinart/workdirs.json` 里登记的目录，
再读各自的 `index.json` 合并。它丢了 / 换机器 → **数据还在盘上，但列表看不见**。
（"机器上有哪些目录"没有任何可枚举之处，所以注册表是必需的——缺的只是**认领动作**。）

三个自愈点：

1. `createSession` / `setWorkDir` 会顺带 `registerRoot`；
2. **前端「选目录」= 登记**（无会话分支直接 `claimWorkDir`）；
3. **前端启动自愈**：`localStorage['vinart.recentWorkDirs']`（最多 8 个目录）在**拉列表之前**逐个回放登记
   —— 否则刚重启时列表为空，用户会以为"聊天没了"。

⚠️ `rootsCache` 是进程内缓存且**无失效**——手改注册表后必须**重启服务**才生效。

## 6. 模块清单（`session/transcript.ts`）

| 导出 | 职责 |
|---|---|
| `newSessionId` / `createSession(workDir)` | 分配 id / 惰性建会话 |
| `appendEvent(id, ev)` | 追加事件（全局串行队列；惰性会话在此落地并写 meta） |
| `loadTranscript(id)` / `readEvents(file)` | 读事件流（后者按路径读，reconcile 用） |
| `deriveMessages` / `deriveTitle` | 事件 → 消息 / 标题 |
| `listRoots` / `registerRoot` / `claimWorkDir` | 注册表读 / 登记（带对账）/ 认领 |
| `reconcileDirIndex(root)` / `ReconcileReport` | 目录索引对账（补登 / 删幽灵 / 修正） |
| `resolveSessionLocation` / `sessionResolvable` | id → 落点（遍历注册表探测文件） |
| `agentTranscriptPath(id, runId)` | 子 agent 账本落点 |
| `deleteSession(id)` | 删主账本 + 级联账本 + 摘索引 |
| `getWorkDir` / `setWorkDir` / `DEFAULT_WORK_DIR` | 环境绑定（后者仅老数据兜底） |

并发纪律：`appendEvent` 走**全局串行队列**（并发追加同一新文件在 Windows 上会撞 EPERM，实测残留 0 字节文件）；
`index.json` 的所有 read-modify-write 走 `withIndexLock`（否则并发会 last-writer-wins 覆盖条目，
实测孤儿 jsonl 群的来源）。

## 7. HTTP API（会话层）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/sessions` | 列表（遍历注册表各目录的索引合并） |
| POST | `/api/sessions` | `{ workDir }` → `{ id }`（**惰性**；缺 workDir → 400） |
| GET | `/api/sessions/:id` | `{ id, events, messages, title }` |
| DELETE | `/api/sessions/:id` | 删除（**流式中 409**——生成到一半删了等于白烧钱） |
| POST | `/api/sessions/:id/events` | 追加事件 |
| POST | `/api/sessions/:id/workdir` | 设工作目录（仅未落盘的惰性会话，否则 409） |
| GET | `/api/sessions/:id/workdir` | 读工作目录 |
| POST | `/api/sessions/:id/chat` | `{ text }` → **SSE** 流式对话，结束后消息落盘 |
| GET | `/api/sessions/:id/artifacts` | 该会话的产物清单 |
| GET | `/api/sessions/:id/file/<rel...>` | 会话工作目录内的素材（逐段 decodeURIComponent + 越界检查） |
| POST | `/api/workdirs` | `{ dir }` → `ReconcileReport`（**认领**：登记 + 索引对账） |

## 8. 前端

- **`localStorage['vinart.sessionId']`** 记住当前会话，刷新恢复。
- **`localStorage['vinart.recentWorkDirs']`**（≤8）用于启动自愈（见 §5）。
- 左侧 `SessionListPanel`：**一级分组**——按 `normKey(home)`（正/反斜杠 + 大小写归一）合并成组，
  组名取目录末段，组头 hover ✎ = 在该目录下新建对话，会话项 hover 🗑 = 删记录与账本（产物保留）。
- `ConversationPanel`：未选目录 / 会话未绑定目录时禁止开聊（textarea 与发送按钮 disabled）。

## 9. 决策记录

| 决策 | 理由 |
|---|---|
| JSONL 追加，非整档重写 | 崩溃安全；可检索；与 Claude Code 同构 |
| 事件流而非消息表 | 操作入流后，「对话式修改」的上下文天然完整 |
| 数据落**工作目录内**（不是仓库统一目录） | 删目录 = 删会话，零清理逻辑；不会"目录没了对话还在" |
| 索引只是**缓存**，可对账重建 | 缓存会漂；以事件流为唯一事实来源才能自愈 |
| **惰性会话**（无消息 = 磁盘上不存在） | "空会话"没有存在价值，不该占列表、不该留垃圾 |
| workDir **创建即绑定、不可改** | 归属必须稳定；换目录 = 新会话，避免会话在目录间漂移 |
| 中央注册表**只存路径** | 发现侧无可枚举之处，必须有指针；但会话数据不进注册表（否则又成单点） |
| 「选目录」= 认领（登记 + 对账） | 补上"打开一个已有数据的目录却看不见会话"的缺口 |
| 子 agent 账本与会话**同生命周期** | 会话没了，委派记录没有独立价值；产物在 designs/ 不受影响 |
| 索引写互斥锁 + 追加串行队列 | 并发 read-modify-write 会覆盖条目 / Windows 并发建文件撞 EPERM |
