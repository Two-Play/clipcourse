// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Edits one question: prompt, kind-specific answers, scoring and feedback.
 * Used for question clips and for questions in quiz chapters.
 */
import { createQuestion, QUESTION_KINDS } from '@clipcourse/editor-core';
import type { Choice, Course, Question, QuestionKind } from '@clipcourse/format';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { t, type MessageKey } from '../i18n.js';

export const KIND_LABEL: Record<QuestionKind, MessageKey> = {
  single: 'qSingle',
  multiple: 'qMultiple',
  text: 'qText',
  order: 'qOrder',
  match: 'qMatch',
  hotspot: 'qHotspot',
};

type Change = (question: Question, field: string) => void;

function nextId(prefix: string, taken: { id: string }[]): string {
  let n = taken.length + 1;
  while (taken.some((x) => x.id === `${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

function Row({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children(id)}
    </div>
  );
}

function IconButton({
  label,
  icon: Icon,
  onClick,
  disabled,
}: {
  label: string;
  icon: typeof Plus;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="icon"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon size={14} aria-hidden />
    </button>
  );
}

/** List editor for choices / order items: text, optional "correct" toggle, move, remove, add. */
function ChoiceList({
  items,
  correct,
  multiple,
  showCorrect,
  onChange,
  prefix,
  label,
}: {
  items: Choice[];
  correct: string[];
  multiple: boolean;
  showCorrect: boolean;
  onChange: (items: Choice[], correct: string[], field: string) => void;
  prefix: string;
  label: string;
}) {
  const group = useId();
  const move = (index: number, delta: number) => {
    const next = [...items];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item!);
    onChange(next, correct, 'order');
  };
  return (
    <fieldset className="q-list">
      <legend>{label}</legend>
      {items.map((item, index) => (
        <div className="q-list-row" key={item.id}>
          {showCorrect && (
            <input
              type={multiple ? 'checkbox' : 'radio'}
              name={group}
              aria-label={`${t('qCorrect')}: ${item.text}`}
              title={t('qCorrect')}
              checked={correct.includes(item.id)}
              onChange={(e) => {
                const next = multiple
                  ? e.target.checked
                    ? [...correct, item.id]
                    : correct.filter((id) => id !== item.id)
                  : [item.id];
                onChange(items, next, 'correct');
              }}
            />
          )}
          <input
            type="text"
            aria-label={`${label} ${index + 1}`}
            value={item.text}
            onChange={(e) =>
              onChange(
                items.map((x) => (x.id === item.id ? { ...x, text: e.target.value } : x)),
                correct,
                `text.${item.id}`,
              )
            }
          />
          <IconButton
            label={t('moveUp')}
            icon={ArrowUp}
            disabled={index === 0}
            onClick={() => move(index, -1)}
          />
          <IconButton
            label={t('moveDown')}
            icon={ArrowDown}
            disabled={index === items.length - 1}
            onClick={() => move(index, 1)}
          />
          <IconButton
            label={t('delete')}
            icon={Trash2}
            disabled={items.length <= 2}
            onClick={() =>
              onChange(
                items.filter((x) => x.id !== item.id),
                correct.filter((id) => id !== item.id),
                'remove',
              )
            }
          />
        </div>
      ))}
      <button
        type="button"
        className="icon-button"
        disabled={items.length >= 20}
        onClick={() =>
          onChange([...items, { id: nextId(prefix, items), text: t('qNewAnswer') }], correct, 'add')
        }
      >
        <Plus size={14} aria-hidden /> {t('qAddAnswer')}
      </button>
    </fieldset>
  );
}

/** One accepted answer per line; keeps the raw text so new lines can be typed. */
function AnswerLines({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState(value.join('\n'));
  return (
    <Row label={t('qAcceptedAnswers')}>
      {(id) => (
        <textarea
          id={id}
          rows={3}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            const list = e.target.value
              .split('\n')
              .map((a) => a.trim())
              .filter(Boolean);
            if (list.length) onChange(list);
          }}
        />
      )}
    </Row>
  );
}

export function QuestionEditor({
  question,
  course,
  onChange,
}: {
  question: Question;
  course: Course;
  onChange: Change;
}) {
  const imageAssets = Object.entries(course.assets).filter(([, a]) => a.kind === 'image');
  const set = (patch: Partial<Question>, field: string) =>
    onChange({ ...question, ...patch } as Question, field);

  let answers: ReactNode = null;
  switch (question.kind) {
    case 'single':
    case 'multiple':
      answers = (
        <ChoiceList
          label={t('qAnswers')}
          prefix="c"
          items={question.choices}
          multiple={question.kind === 'multiple'}
          showCorrect
          correct={question.kind === 'single' ? [question.correct] : question.correct}
          onChange={(choices, correct, field) => {
            if (question.kind === 'single') {
              const first =
                correct.find((id) => choices.some((c) => c.id === id)) ?? choices[0]!.id;
              set({ choices, correct: first } as Partial<Question>, field);
            } else {
              const kept = correct.filter((id) => choices.some((c) => c.id === id));
              set(
                { choices, correct: kept.length ? kept : [choices[0]!.id] } as Partial<Question>,
                field,
              );
            }
          }}
        />
      );
      break;
    case 'text':
      answers = (
        <>
          <AnswerLines
            value={question.answers}
            onChange={(answers) => set({ answers } as Partial<Question>, 'answers')}
          />
          <label className="field-check">
            <input
              type="checkbox"
              checked={question.caseSensitive === true}
              onChange={(e) =>
                set({ caseSensitive: e.target.checked || undefined } as Partial<Question>, 'case')
              }
            />
            {t('qCaseSensitive')}
          </label>
        </>
      );
      break;
    case 'order':
      answers = (
        <ChoiceList
          label={t('qCorrectOrder')}
          prefix="s"
          items={question.items}
          multiple={false}
          showCorrect={false}
          correct={[]}
          onChange={(items, _c, field) => set({ items } as Partial<Question>, field)}
        />
      );
      break;
    case 'match':
      answers = (
        <fieldset className="q-list">
          <legend>{t('qPairs')}</legend>
          {question.pairs.map((pair, index) => (
            <div className="q-list-row" key={pair.id}>
              <input
                type="text"
                aria-label={`${t('qLeft')} ${index + 1}`}
                value={pair.left}
                onChange={(e) =>
                  set(
                    {
                      pairs: question.pairs.map((p) =>
                        p.id === pair.id ? { ...p, left: e.target.value } : p,
                      ),
                    } as Partial<Question>,
                    `left.${pair.id}`,
                  )
                }
              />
              <input
                type="text"
                aria-label={`${t('qRight')} ${index + 1}`}
                value={pair.right}
                onChange={(e) =>
                  set(
                    {
                      pairs: question.pairs.map((p) =>
                        p.id === pair.id ? { ...p, right: e.target.value } : p,
                      ),
                    } as Partial<Question>,
                    `right.${pair.id}`,
                  )
                }
              />
              <IconButton
                label={t('delete')}
                icon={Trash2}
                disabled={question.pairs.length <= 2}
                onClick={() =>
                  set(
                    { pairs: question.pairs.filter((p) => p.id !== pair.id) } as Partial<Question>,
                    'remove',
                  )
                }
              />
            </div>
          ))}
          <button
            type="button"
            className="icon-button"
            disabled={question.pairs.length >= 20}
            onClick={() =>
              set(
                {
                  pairs: [
                    ...question.pairs,
                    { id: nextId('p', question.pairs), left: t('qLeft'), right: t('qRight') },
                  ],
                } as Partial<Question>,
                'add',
              )
            }
          >
            <Plus size={14} aria-hidden /> {t('qAddPair')}
          </button>
        </fieldset>
      );
      break;
    case 'hotspot':
      answers = (
        <>
          <Row label={t('media')}>
            {(id) => (
              <select
                id={id}
                value={question.assetId}
                onChange={(e) => set({ assetId: e.target.value } as Partial<Question>, 'asset')}
              >
                {imageAssets.map(([assetId, asset]) => (
                  <option key={assetId} value={assetId}>
                    {asset.src.split('/').pop()}
                  </option>
                ))}
              </select>
            )}
          </Row>
          <Row label={t('altText')}>
            {(id) => (
              <input
                id={id}
                type="text"
                value={question.alt ?? ''}
                onChange={(e) =>
                  set({ alt: e.target.value || undefined } as Partial<Question>, 'alt')
                }
              />
            )}
          </Row>
          <fieldset className="q-list">
            <legend>{t('qAreas')}</legend>
            <p className="field-hint">{t('qAreasHint')}</p>
            {question.areas.map((area, index) => (
              <div className="q-area" key={area.id}>
                <div className="q-list-row">
                  <input
                    type="checkbox"
                    aria-label={`${t('qCorrect')}: ${area.label}`}
                    title={t('qCorrect')}
                    checked={question.correct.includes(area.id)}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...question.correct, area.id]
                        : question.correct.filter((id) => id !== area.id);
                      if (next.length) set({ correct: next } as Partial<Question>, 'correct');
                    }}
                  />
                  <input
                    type="text"
                    aria-label={`${t('qAreaLabel')} ${index + 1}`}
                    value={area.label}
                    onChange={(e) =>
                      set(
                        {
                          areas: question.areas.map((a) =>
                            a.id === area.id ? { ...a, label: e.target.value } : a,
                          ),
                        } as Partial<Question>,
                        `label.${area.id}`,
                      )
                    }
                  />
                  <IconButton
                    label={t('delete')}
                    icon={Trash2}
                    disabled={question.areas.length <= 1}
                    onClick={() =>
                      set(
                        {
                          areas: question.areas.filter((a) => a.id !== area.id),
                          correct: question.correct.filter((id) => id !== area.id).length
                            ? question.correct.filter((id) => id !== area.id)
                            : [question.areas.find((a) => a.id !== area.id)!.id],
                        } as Partial<Question>,
                        'remove',
                      )
                    }
                  />
                </div>
                <div className="q-area-box">
                  {(['x', 'y', 'width', 'height'] as const).map((key) => (
                    <label key={key}>
                      {key}
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={Math.round(area[key] * 100)}
                        onChange={(e) => {
                          const v = Math.min(100, Math.max(0, Number(e.target.value))) / 100;
                          set(
                            {
                              areas: question.areas.map((a) =>
                                a.id === area.id ? { ...a, [key]: v } : a,
                              ),
                            } as Partial<Question>,
                            `${key}.${area.id}`,
                          );
                        }}
                      />
                      %
                    </label>
                  ))}
                </div>
              </div>
            ))}
            <button
              type="button"
              className="icon-button"
              onClick={() =>
                set(
                  {
                    areas: [
                      ...question.areas,
                      {
                        id: nextId('h', question.areas),
                        label: t('qAreaLabel'),
                        x: 0.1,
                        y: 0.1,
                        width: 0.2,
                        height: 0.2,
                      },
                    ],
                  } as Partial<Question>,
                  'add',
                )
              }
            >
              <Plus size={14} aria-hidden /> {t('qAddArea')}
            </button>
          </fieldset>
        </>
      );
      break;
  }

  return (
    <div className="question-editor">
      <Row label={t('qType')}>
        {(id) => (
          <select
            id={id}
            value={question.kind}
            onChange={(e) => {
              const kind = e.target.value as QuestionKind;
              const image = imageAssets[0]?.[0];
              if (kind === 'hotspot' && !image) return;
              const fresh = createQuestion(kind, question.id, image);
              // Keep the author's own prompt, but not the old kind's sample text.
              const sample = createQuestion(question.kind, question.id, image).prompt;
              onChange(
                {
                  ...fresh,
                  prompt: question.prompt === sample ? fresh.prompt : question.prompt,
                  ...(question.points !== undefined ? { points: question.points } : {}),
                } as Question,
                'kind',
              );
            }}
          >
            {QUESTION_KINDS.map((kind) => (
              <option
                key={kind}
                value={kind}
                disabled={kind === 'hotspot' && imageAssets.length === 0}
              >
                {t(KIND_LABEL[kind])}
              </option>
            ))}
          </select>
        )}
      </Row>
      <Row label={t('qPrompt')}>
        {(id) => (
          <textarea
            id={id}
            rows={2}
            value={question.prompt}
            onChange={(e) => e.target.value.trim() && set({ prompt: e.target.value }, 'prompt')}
          />
        )}
      </Row>
      {answers}
      <details className="advanced">
        <summary>{t('qScoring')}</summary>
        <div className="q-grid">
          <Row label={t('qPoints')}>
            {(id) => (
              <input
                id={id}
                type="number"
                min={0}
                max={1000}
                value={question.points ?? 1}
                onChange={(e) => set({ points: Math.max(0, Number(e.target.value)) }, 'points')}
              />
            )}
          </Row>
          <Row label={t('qAttempts')}>
            {(id) => (
              <input
                id={id}
                type="number"
                min={0}
                max={100}
                value={question.attempts ?? 1}
                title={t('qAttemptsHint')}
                onChange={(e) =>
                  set({ attempts: Math.max(0, Math.round(Number(e.target.value))) }, 'attempts')
                }
              />
            )}
          </Row>
        </div>
        <label className="field-check">
          <input
            type="checkbox"
            checked={question.scored !== false}
            onChange={(e) =>
              set({ scored: e.target.checked ? undefined : false } as Partial<Question>, 'scored')
            }
          />
          {t('qScored')}
        </label>
        <label className="field-check">
          <input
            type="checkbox"
            checked={question.showSolution !== false}
            onChange={(e) =>
              set(
                { showSolution: e.target.checked ? undefined : false } as Partial<Question>,
                'solution',
              )
            }
          />
          {t('qShowSolution')}
        </label>
        <Row label={t('qFeedbackCorrect')}>
          {(id) => (
            <input
              id={id}
              type="text"
              value={question.feedback?.correct ?? ''}
              onChange={(e) =>
                set(
                  {
                    feedback: { ...question.feedback, correct: e.target.value || undefined },
                  } as Partial<Question>,
                  'fbc',
                )
              }
            />
          )}
        </Row>
        <Row label={t('qFeedbackIncorrect')}>
          {(id) => (
            <input
              id={id}
              type="text"
              value={question.feedback?.incorrect ?? ''}
              onChange={(e) =>
                set(
                  {
                    feedback: { ...question.feedback, incorrect: e.target.value || undefined },
                  } as Partial<Question>,
                  'fbi',
                )
              }
            />
          )}
        </Row>
      </details>
    </div>
  );
}

/** Removes undefined values so documents stay valid under exactOptionalPropertyTypes. */
export function cleanQuestion(question: Question): Question {
  const copy = JSON.parse(JSON.stringify(question)) as Question;
  if (copy.feedback && Object.keys(copy.feedback).length === 0) delete copy.feedback;
  return copy;
}
