export interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  attachments?: string[];
}

export interface ElementInfo {
  id: string;
  label: string;
}

export type PipelineStep = 'design' | 'translate' | 'code' | 'render';
