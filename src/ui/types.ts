export interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  attachments?: string[];
  /** 委派记录：哪个 Subagent 被调用、结果如何 */
  delegations?: DelegationRecord[];
}

export interface DelegationRecord {
  agent: string;
  task: string;
  status: 'running' | 'done';
  result?: string;
}

export interface ElementInfo {
  id: string;
  label: string;
}

export type PipelineStep = 'design' | 'translate' | 'code' | 'render';
