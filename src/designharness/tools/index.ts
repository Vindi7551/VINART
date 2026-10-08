/**
 * harness 工具集 barrel —— 子 agent 的业务能力适配器。
 *
 * 每个文件一个业务域，导出 `AgentTool[]` 常量；调用方（D 阶段服务层）
 * 按子 agent 的任务挑工具表拼进 spawn 请求。工具全部零 API 成本的
 * 本地确定性操作——烧钱动作（VLM/生图）不进工具表。
 */

export { DESIGN_SKETCH_TOOLS } from './design-sketch';
