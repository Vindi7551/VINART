/**
 * `ask_user` 的 pending 注册表 —— **服务端进程内**。
 *
 * ask_user 工具会阻塞当前 turn，等前端 POST /answer 解析；
 * 因此 pending 必须活在这条 /chat 流和 HTTP 路由都能看到的地方。
 *
 * ⚠️ 不落盘：页面刷新/服务重启后 pending 作废；这是第一版的已知边界。
 */

import type { AskQuestion } from './turn-parts';

type Answers = Record<string, string | string[]>;

export interface PendingAsk {
  sessionId: string;
  questionId: string;
  questions: AskQuestion[];
  resolve: (answers: Answers) => void;
  reject: (err: Error) => void;
}

const pending = new Map<string, PendingAsk>();

export function hasPendingAsk(sessionId: string): boolean {
  return pending.has(sessionId);
}

export function askUser(
  sessionId: string,
  questions: AskQuestion[],
  signal: AbortSignal,
  onEvent?: (evt: Record<string, unknown>) => void,
): Promise<Answers> {
  if (pending.has(sessionId)) {
    return Promise.reject(new Error('该会话已经有一个待回答问题'));
  }
  if (signal.aborted) return Promise.reject(new Error('用户已停止'));

  const questionId = `q_${crypto.randomUUID().slice(0, 8)}`;
  return new Promise<Answers>((resolve, reject) => {
    const cleanup = () => {
      signal.removeEventListener('abort', onAbort);
      pending.delete(sessionId);
    };
    const onAbort = () => {
      cleanup();
      onEvent?.({ kind: 'ask-user-cancelled', questionId });
      reject(new Error('用户已停止'));
    };
    const p: PendingAsk = {
      sessionId,
      questionId,
      questions,
      resolve: (answers) => {
        cleanup();
        onEvent?.({ kind: 'ask-user-answered', questionId, answers });
        resolve(answers);
      },
      reject: (err) => {
        cleanup();
        onEvent?.({ kind: 'ask-user-cancelled', questionId });
        reject(err);
      },
    };
    pending.set(sessionId, p);
    signal.addEventListener('abort', onAbort, { once: true });
    onEvent?.({ kind: 'ask-user', questionId, questions });
  });
}

export function answerPending(
  sessionId: string,
  questionId: string,
  answers: Answers,
): boolean {
  const p = pending.get(sessionId);
  if (!p || p.questionId !== questionId) return false;
  p.resolve(answers);
  return true;
}

export function cancelPending(sessionId: string, reason = '用户已停止'): boolean {
  const p = pending.get(sessionId);
  if (!p) return false;
  p.reject(new Error(reason));
  return true;
}
