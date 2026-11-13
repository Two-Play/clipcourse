// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "On click" settings of a visual clip: what happens when the learner
 * activates it, its accessible name, and whether it starts hidden.
 */
import { findClip, updateClip } from '@clipcourse/editor-core';
import type { ClipAction, ClipActionType, Course, VisualClip } from '@clipcourse/format';
import { useId, useState, type ReactNode } from 'react';
import { useEditor, useSession } from '../context.js';
import { clipLabel } from '../geometry.js';
import { t, type MessageKey } from '../i18n.js';

const TYPE_LABEL: Record<ClipActionType, MessageKey> = {
  goToChapter: 'actGoToChapter',
  goToMarker: 'actGoToMarker',
  openPopup: 'actOpenPopup',
  setClipVisibility: 'actShowHide',
  openUrl: 'actOpenUrl',
};

function Row({
  label,
  children,
  hint,
}: {
  label: string;
  children: (id: string) => ReactNode;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}

/** A sensible first action of each type for this course, or null if impossible. */
function defaultAction(
  type: ClipActionType,
  course: Course,
  chapterId: string,
  clipId: string,
): ClipAction | null {
  switch (type) {
    case 'goToChapter': {
      const index = course.chapters.findIndex((c) => c.id === chapterId);
      const target = course.chapters[index + 1] ?? course.chapters[0]!;
      return { type, chapterId: target.id };
    }
    case 'goToMarker': {
      const chapter = course.chapters.find((c) => c.markers?.length);
      return chapter ? { type, chapterId: chapter.id, markerId: chapter.markers![0]!.id } : null;
    }
    case 'openPopup':
      return course.popups?.length ? { type, popupId: course.popups[0]!.id } : null;
    case 'setClipVisibility': {
      const chapter = course.chapters.find((c) => c.id === chapterId);
      const other = chapter?.tracks
        .flatMap((tr) => tr.clips)
        .find((c) => c.id !== clipId && c.type !== 'audio');
      return other ? { type, clipId: other.id, visible: 'show' } : null;
    }
    case 'openUrl':
      return { type, url: 'https://' };
  }
}

/** URL input that only commits http(s) and mailto links. */
function UrlField({ value, onCommit }: { value: string; onCommit: (url: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const valid = (v: string) => /^(https?:\/\/[^\s]+|mailto:[^\s]+)$/i.test(v);
  const commit = () => {
    if (draft !== null && valid(draft) && draft !== value) onCommit(draft);
    setDraft(null);
  };
  return (
    <Row label={t('actUrl')} hint={t('actUrlHint')}>
      {(id) => (
        <input
          id={id}
          type="url"
          value={draft ?? value}
          aria-invalid={draft !== null && !valid(draft)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
        />
      )}
    </Row>
  );
}

export function ActionFields({ clip }: { clip: VisualClip }) {
  const session = useSession();
  const course = useEditor((s) => s.course);
  const chapterIndex = findClip(course, clip.id)?.chapterIndex ?? -1;
  const chapterId = course.chapters[chapterIndex]?.id ?? course.chapters[0]!.id;
  const edit = (field: string, update: (c: VisualClip) => void, merge = true) =>
    session.run(
      `Edit ${field}`,
      updateClip(clip.id, (c) => {
        if (c.type !== 'audio') update(c);
      }),
      merge ? { mergeKey: `${clip.id}:${field}` } : undefined,
    );
  const setAction = (action: ClipAction | null) =>
    edit(
      'action',
      (c) => {
        if (action) c.action = action;
        else if (c.type !== 'button') delete c.action;
      },
      false,
    );
  const action = clip.action;
  const isButton = clip.type === 'button';

  const targetFields = (() => {
    if (!action) return null;
    switch (action.type) {
      case 'goToChapter':
        return (
          <Row label={t('actChapter')}>
            {(id) => (
              <select
                id={id}
                value={action.chapterId}
                onChange={(e) => setAction({ type: 'goToChapter', chapterId: e.target.value })}
              >
                {course.chapters.map((c, i) => (
                  <option key={c.id} value={c.id}>
                    {i + 1}. {c.title}
                  </option>
                ))}
              </select>
            )}
          </Row>
        );
      case 'goToMarker':
        return (
          <Row label={t('actMarker')}>
            {(id) => (
              <select
                id={id}
                value={`${action.chapterId}|${action.markerId}`}
                onChange={(e) => {
                  const [chapter, marker] = e.target.value.split('|') as [string, string];
                  setAction({ type: 'goToMarker', chapterId: chapter, markerId: marker });
                }}
              >
                {course.chapters.flatMap((c, i) =>
                  (c.markers ?? []).map((m) => (
                    <option key={m.id} value={`${c.id}|${m.id}`}>
                      {i + 1}. {c.title} – {m.title}
                    </option>
                  )),
                )}
              </select>
            )}
          </Row>
        );
      case 'openPopup':
        return (
          <Row label={t('actPopup')}>
            {(id) => (
              <select
                id={id}
                value={action.popupId}
                onChange={(e) => setAction({ type: 'openPopup', popupId: e.target.value })}
              >
                {(course.popups ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            )}
          </Row>
        );
      case 'setClipVisibility': {
        const chapter = course.chapters[chapterIndex];
        const candidates = [
          ...(chapter?.tracks ?? []),
          ...(course.courseLayer?.background ?? []),
          ...(course.courseLayer?.foreground ?? []),
        ]
          .flatMap((tr) => tr.clips)
          .filter((c) => c.type !== 'audio');
        return (
          <>
            <Row label={t('actTargetClip')}>
              {(id) => (
                <select
                  id={id}
                  value={action.clipId}
                  onChange={(e) => setAction({ ...action, clipId: e.target.value })}
                >
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.id === clip.id ? `${t('actThisClip')}: ` : ''}
                      {clipLabel(c, course)}
                    </option>
                  ))}
                </select>
              )}
            </Row>
            <Row label={t('actVisible')}>
              {(id) => (
                <select
                  id={id}
                  value={action.visible}
                  onChange={(e) =>
                    setAction({ ...action, visible: e.target.value as 'show' | 'hide' | 'toggle' })
                  }
                >
                  <option value="show">{t('actShow')}</option>
                  <option value="hide">{t('actHide')}</option>
                  <option value="toggle">{t('actToggle')}</option>
                </select>
              )}
            </Row>
            <label className="field-check">
              <input
                type="checkbox"
                checked={action.pause === true}
                onChange={(e) => {
                  const next = { ...action };
                  if (e.target.checked) next.pause = true;
                  else delete next.pause;
                  setAction(next);
                }}
              />
              {t('actPause')}
            </label>
          </>
        );
      }
      case 'openUrl':
        return (
          <UrlField
            key={clip.id}
            value={action.url}
            onCommit={(url) => setAction({ type: 'openUrl', url })}
          />
        );
    }
  })();

  return (
    <fieldset className="action-fields">
      <legend>{t('onClick')}</legend>
      <Row label={t('actType')}>
        {(id) => (
          <select
            id={id}
            value={action?.type ?? ''}
            onChange={(e) => {
              const type = e.target.value as ClipActionType | '';
              if (!type) return setAction(null);
              const next = defaultAction(type, course, chapterId, clip.id);
              if (next) setAction(next);
            }}
          >
            {!isButton && <option value="">{t('actNone')}</option>}
            {(Object.keys(TYPE_LABEL) as ClipActionType[]).map((type) => {
              const possible = defaultAction(type, course, chapterId, clip.id) !== null;
              return (
                <option key={type} value={type} disabled={!possible}>
                  {t(TYPE_LABEL[type])}
                  {!possible
                    ? ` (${t(type === 'openPopup' ? 'actNeedsPopup' : type === 'goToMarker' ? 'actNeedsMarker' : 'actNeedsClip')})`
                    : ''}
                </option>
              );
            })}
          </select>
        )}
      </Row>
      {targetFields}
      {action && !isButton && (
        <Row label={t('actLabel')} hint={t('actLabelHint')}>
          {(id) => (
            <input
              id={id}
              type="text"
              value={clip.actionLabel ?? ''}
              onChange={(e) =>
                edit('actionLabel', (c) => {
                  if (e.target.value) c.actionLabel = e.target.value;
                  else delete c.actionLabel;
                })
              }
            />
          )}
        </Row>
      )}
      <label className="field-check">
        <input
          type="checkbox"
          checked={clip.startsHidden === true}
          onChange={(e) =>
            edit(
              'startsHidden',
              (c) => {
                if (e.target.checked) c.startsHidden = true;
                else delete c.startsHidden;
              },
              false,
            )
          }
        />
        {t('startsHidden')}
      </label>
    </fieldset>
  );
}
