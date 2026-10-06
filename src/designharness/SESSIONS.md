# 会话层设计(SESSIONS.md)

> 状态:方案定稿,待实施。参照:Claude Code 的转录实现(每会话 JSONL 追加 + 重放恢复)
> 与双层记忆模式(热路径=窗口内,冷路径=按需检索)。
>
> 核心原则:**会话事件流(JSONL)是持久层,内存态是派生物**。崩溃安全、可重放、可检索。
> sessionId 贯穿四端:前端(localStorage)→ API(路由)→ harness(ChatSession 实例)→ 事件文件(文件名)。

## 0. 语义:会话 = 一次连续的设计工作史

对话消息与设计操作(打开版式/保存 spec/重渲)**同一个事件流**——
未来「圈选某元素重新生成」时,LLM 的上下文里天然有:对话历史 + 操作历史 + 产物引用。

## 1. 事件模型

```ts
type ArtifactRef = { layout: string; file?: string; element?: string };

type SessionEvent =
  | { seq: number; ts: string; kind: 'message';
      id: string; role: 'user' | 'assistant'; text: string;
      refs?: ArtifactRef[] }
  | { seq: number; ts: string; kind: 'action';
      action: 'open-layout' | 'save-spec' | 'render' | 'pipeline-start' | 'pipeline-done';
      detail: Record<string, unknown> }        // 如 { layout: 'shirt-PT01' }
  | { seq: number; ts: string; kind: 'meta'; title?: string };
```

- `seq` 自增(重放时按文件序赋号);事件**只追加、永不改写**
- 大内容外置:截图/PNG 不进 JSONL,`refs.file` 存产物目录相对路径
- `deriveMessages(events)` → ChatMessage[](重放:只取 message 事件)

### 索引文件(列表页快,免重放)

```jsonc
// test_product/sessions/index.json
[{ "id": "...", "title": "...", "updatedAt": "...", "messageCount": 3 }]
```
追加事件时同步更新对应条目;损坏时从事件流惰性重建。

## 2. 存储布局

```
test_product/sessions/
├── index.json
└── <sessionId>.jsonl        # 每会话一个追加文件
```

## 3. 新模块 transcript.ts(src/designharness/session/)

```ts
appendEvent(sessionId, event): Promise<void>   // JSON.stringify + '\n' 追加;写队列防交错
loadTranscript(sessionId): Promise<SessionEvent[]>  // 全读→逐行 JSON.parse→坏行跳过(半截写入容错)
listSessions(): Promise<SessionIndex[]>        // 读 index.json
deleteSession(sessionId): Promise<void>
deriveMessages(events): ChatMessage[]          // 事件→消息(供 ChatSession 灌历史)
deriveTitle(events): string                    // 首条用户消息前 20 字
```

## 4. harness 改造

- `chat-session.ts`:加 **restore(messages)** ——服务重启/切会话后把派生历史灌回
  ChatSession(LLM 上下文恢复);其余接口不动
- `manager.ts`:`get-or-create(sessionId)` 语义——内存 Map<sessionId, ChatSession>
- LLM 上下文组装走现有 ChatContext(system prompt + 最近消息);compaction 钩子已预留,
  消息量级大了再启用

## 5. API(dev-server 新增 6 端点)

```
GET    /api/sessions                → index.json
POST   /api/sessions                → 新建空会话 → { id }
GET    /api/sessions/:id            → { events, messages, title }
DELETE /api/sessions/:id            → 删文件 + 更新索引
POST   /api/sessions/:id/events     → 追加事件(编辑器操作走这里)→ { seq }
POST   /api/sessions/:id/chat       → { text } → SSE 流式(harness ChatSession.send)
                                     → 结束时 assistant 消息落盘
```

进程模型:dev-server 内存 `Map<sessionId, ChatSession>`(get-or-create);
服务重启后 ChatSession 重建(从 JSONL 派生历史灌回)。

LLM system prompt(初版):设计助手——知道 Vinart 的版式/外观/渲染结构与当前
激活版式的层清单;后续阶段二把 spec 摘要动态注入。

## 6. 前端改造

- **App.tsx**:`sessionId`(localStorage `vinart.sessionId`,刷新恢复)+ 会话列表拉取
- **ConversationPanel**:顶部会话条(列表/新建/切换);messages 从 API 派生;
  发消息走 `POST /chat` SSE(流式渲染);替换「Agent 层已清空」占位
- **工作台联动**:打开版式 / 保存 / 重渲完成 → `POST events`(action 事件)——
  设计历史与对话历史同流

## 7. 实施顺序(每步有验证)

1. `transcript.ts`(纯函数:append/load/derive/容错)+ node 脚本验证
2. 6 个 API 端点 → curl 逐个验证
3. chat 接 LLM → curl 发消息,看流式回复 + JSONL 落盘
4. 前端会话条 + 消息流接真 → 页面验证(刷新恢复、多会话切换)
5. 编辑器操作入流 → 打开/保存/重渲产生 action 事件
6. 本文档收尾

## 8. 决策记录

| 决策 | 理由 |
|---|---|
| JSONL 追加,非整档重写 | 崩溃安全;可检索;与 Claude Code 同构 |
| 事件流而非消息表 | 操作入流后,「对话式修改」上下文天然完整 |
| 大内容外置 | 转录轻;重物(截图/PNG)本来就在产物目录 |
| 压缩后置 | 消息量级远小于工具循环场景;ChatContext 钩子已备 |
| 消息中止后置 | 成本低,阶段二补 |
| 单用户单进程写队列 | 现阶段够用;多标签并发写留待需要时加锁 |
