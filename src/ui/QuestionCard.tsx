import { useEffect, useState } from 'react';
import type { AskQuestion, TurnQuestionPart } from '../designharness/session/turn-parts';

type AnswerMap = Record<string, string | string[]>;

function initialAnswers(part: TurnQuestionPart): AnswerMap {
  return part.answers ? { ...part.answers } : {};
}

function labelOf(q: AskQuestion, value: string): string {
  return q.options?.find((o) => o.value === value)?.label ?? value;
}

/** 结构化提问卡：ask_user 阻塞当前 turn，用户在这里回答或停止。 */
export function QuestionCard({
  part,
  sessionId,
  onStop,
}: {
  part: TurnQuestionPart;
  sessionId?: string | null;
  onStop?: () => void;
}) {
  const [answers, setAnswers] = useState<AnswerMap>(() => initialAnswers(part));
  const [other, setOther] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setAnswers(initialAnswers(part));
    setError('');
  }, [part.questionId, part.status]);

  const pending = part.status === 'pending';

  function setSingle(qid: string, value: string) {
    setAnswers((prev) => ({ ...prev, [qid]: value }));
  }

  function toggleMulti(qid: string, value: string) {
    setAnswers((prev) => {
      const cur = Array.isArray(prev[qid]) ? (prev[qid] as string[]) : [];
      const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
      return { ...prev, [qid]: next };
    });
  }

  function answerForSubmit(): { ok: true; answers: AnswerMap } | { ok: false; error: string } {
    const out: AnswerMap = {};
    for (const q of part.questions) {
      const extra = (other[q.id] ?? '').trim();
      const cur = answers[q.id];
      if (q.multiSelect) {
        const vals = Array.isArray(cur) ? [...cur] : [];
        if (extra) vals.push(extra);
        if (!vals.length) return { ok: false, error: `请回答「${q.header ?? q.question}」` };
        out[q.id] = vals;
      } else {
        if (extra) out[q.id] = extra;
        else if (typeof cur === 'string' && cur) out[q.id] = cur;
        else return { ok: false, error: `请回答「${q.header ?? q.question}」` };
      }
    }
    return { ok: true, answers: out };
  }

  async function submit() {
    if (!pending || submitting) return;
    if (!sessionId) {
      setError('没有会话 id，无法提交');
      return;
    }
    const built = answerForSubmit();
    if (!built.ok) {
      setError(built.error);
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const resp = await fetch(`/api/sessions/${sessionId}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionId: part.questionId, answers: built.answers }),
      });
      if (!resp.ok) {
        const detail = await resp.text().catch(() => '');
        throw new Error(detail || `HTTP ${resp.status}`);
      }
      setAnswers(built.answers);
    } catch (e) {
      setError(`提交失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={`question-card ${part.status}`}>
      <div className="question-card-head">
        <span className="question-card-title">需要确认</span>
        {part.status === 'answered' ? <span className="question-card-status">已回答</span> : null}
        {part.status === 'cancelled' ? <span className="question-card-status">已取消</span> : null}
      </div>

      {part.status === 'answered' ? (
        <div className="question-answers">
          {part.questions.map((q) => {
            const a = part.answers?.[q.id];
            const vals = Array.isArray(a) ? a : a ? [a] : [];
            return (
              <div key={q.id} className="question-answer-item">
                <div className="question-answer-label">{q.header ?? q.question}</div>
                <div className="question-answer-value">
                  {vals.length ? vals.map((v) => labelOf(q, v)).join('、') : '（未回答）'}
                </div>
              </div>
            );
          })}
        </div>
      ) : part.status === 'cancelled' ? (
        <div className="question-cancelled">本轮提问已取消。</div>
      ) : (
        <form
          className="question-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {part.questions.map((q) => {
            const cur = answers[q.id];
            return (
              <fieldset key={q.id} className="question-item">
                <legend className="question-label">
                  {q.header ? <span className="question-header">{q.header}</span> : null}
                  {q.question}
                </legend>
                {q.options?.length ? (
                  <div className="question-options">
                    {q.options.map((opt) => {
                      const checked = q.multiSelect
                        ? Array.isArray(cur) && cur.includes(opt.value)
                        : cur === opt.value;
                      return (
                        <label key={opt.value} className={`question-option${checked ? ' checked' : ''}`}>
                          <input
                            type={q.multiSelect ? 'checkbox' : 'radio'}
                            name={q.id}
                            value={opt.value}
                            checked={checked}
                            onChange={() =>
                              q.multiSelect
                                ? toggleMulti(q.id, opt.value)
                                : setSingle(q.id, opt.value)
                            }
                          />
                          <span className="question-option-label">{opt.label}</span>
                          {opt.description ? (
                            <span className="question-option-desc">{opt.description}</span>
                          ) : null}
                        </label>
                      );
                    })}
                  </div>
                ) : null}
                {q.allowOther || !q.options?.length ? (
                  <input
                    className="question-other"
                    type="text"
                    value={other[q.id] ?? ''}
                    placeholder={q.options?.length ? '其他（可选）' : '输入回答…'}
                    onChange={(e) => setOther((prev) => ({ ...prev, [q.id]: e.target.value }))}
                  />
                ) : null}
              </fieldset>
            );
          })}

          {error ? <div className="question-error">{error}</div> : null}

          <div className="question-actions">
            {onStop ? (
              <button type="button" className="question-stop" onClick={onStop}>
                停止
              </button>
            ) : null}
            <button type="submit" className="question-submit" disabled={submitting}>
              {submitting ? '提交中…' : '提交回答'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
