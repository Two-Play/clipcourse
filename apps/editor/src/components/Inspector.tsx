// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Properties of the selected clip, or of the chapter and course when
 * nothing is selected. Simple fields first; layout and fine tuning live in
 * a collapsible "More options" section.
 */
import {
  findClip,
  fitChapterToContent,
  moveClip,
  resizeClip,
  selectChapter,
  setChapterProps,
  setCourseProps,
  updateClip,
} from '@clipcourse/editor-core';
import type {
  Animation,
  AnimationType,
  Clip,
  HighlightKind,
  SlideDirection,
  TextStyle,
  VisualClip,
} from '@clipcourse/format';
import { useId, useState, type ReactNode } from 'react';
import { useEditor, useSession } from '../context.js';
import { t } from '../i18n.js';

export function Inspector() {
  const selection = useEditor((s) => s.selection);
  const course = useEditor((s) => s.course);
  const location = selection.length === 1 ? findClip(course, selection[0]!) : null;
  return (
    <aside className="inspector" aria-label={t('properties')}>
      {location ? (
        <ClipInspector clip={location.clip} key={location.clip.id} />
      ) : (
        <ChapterInspector />
      )}
    </aside>
  );
}

// --- Generic fields ---------------------------------------------------------------

function Field({
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

/** Number input that commits on blur or Enter; shows seconds for ms values. */
function NumberField(props: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
  seconds?: boolean;
  min?: number | undefined;
  max?: number | undefined;
  step?: number | undefined;
}) {
  const { label, value, onCommit, seconds, min, max, step } = props;
  const shown = seconds ? +(value / 1000).toFixed(3) : value;
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const n = Number(draft.replace(',', '.'));
    setDraft(null);
    if (!Number.isFinite(n)) return;
    const clamped = Math.min(Math.max(n, min ?? -Infinity), max ?? Infinity);
    onCommit(seconds ? Math.round(clamped * 1000) : clamped);
  };
  return (
    <Field label={label}>
      {(id) => (
        <input
          id={id}
          type="number"
          inputMode="decimal"
          value={draft ?? String(shown)}
          min={min}
          max={max}
          step={step ?? (seconds ? 0.1 : 1)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') setDraft(null);
          }}
        />
      )}
    </Field>
  );
}

function TextField(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  hint?: string;
}) {
  return (
    <Field label={props.label} {...(props.hint ? { hint: props.hint } : {})}>
      {(id) =>
        props.multiline ? (
          <textarea
            id={id}
            rows={3}
            value={props.value}
            onChange={(e) => props.onChange(e.target.value)}
          />
        ) : (
          <input
            id={id}
            type="text"
            value={props.value}
            onChange={(e) => props.onChange(e.target.value)}
          />
        )
      }
    </Field>
  );
}

function SelectField<T extends string>(props: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <Field label={props.label}>
      {(id) => (
        <select id={id} value={props.value} onChange={(e) => props.onChange(e.target.value as T)}>
          {props.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

/** Color input; only #rrggbb is editable here, other formats are kept until changed. */
function ColorField(props: {
  label: string;
  value: string | undefined;
  onChange: (v: string) => void;
}) {
  const hex = /^#[0-9a-f]{6}$/i.test(props.value ?? '')
    ? props.value!
    : /^#[0-9a-f]{3}$/i.test(props.value ?? '')
      ? '#' + [...props.value!.slice(1)].map((c) => c + c).join('')
      : '#000000';
  return (
    <Field label={props.label}>
      {(id) => (
        <input id={id} type="color" value={hex} onChange={(e) => props.onChange(e.target.value)} />
      )}
    </Field>
  );
}

// --- Clip --------------------------------------------------------------------------

function ClipInspector({ clip }: { clip: Clip }) {
  const { store } = useSession();
  const course = useEditor((s) => s.course);
  const edit = (field: string, update: (c: Clip) => void) =>
    store
      .getState()
      .execute(`Edit ${field}`, updateClip(clip.id, update), { mergeKey: `${clip.id}:${field}` });
  const editStyle = (field: keyof TextStyle, value: TextStyle[keyof TextStyle]) =>
    edit(field, (c) => {
      if (c.type === 'text' || c.type === 'box') c.style = { ...c.style, [field]: value };
    });

  const assetsOf = (kind: string) =>
    Object.entries(course.assets)
      .filter(([, a]) => a.kind === kind)
      .map(([id, a]) => ({ value: id, label: a.src.split('/').pop() ?? id }));

  return (
    <div className="inspector-body">
      <h2>{t('properties')}</h2>

      <fieldset>
        <legend>{t('timeline')}</legend>
        <NumberField
          label={t('start')}
          seconds
          min={0}
          value={clip.start}
          onCommit={(v) => store.getState().execute('Move clip', moveClip(clip.id, v))}
        />
        <NumberField
          label={t('duration')}
          seconds
          min={0.1}
          value={clip.duration}
          onCommit={(v) =>
            store.getState().execute('Trim clip', resizeClip(clip.id, 'end', clip.start + v))
          }
        />
      </fieldset>

      <fieldset>
        <legend>{t('text')}</legend>
        {(clip.type === 'text' || clip.type === 'box') && (
          <TextField
            label={t('text')}
            multiline
            value={clip.text ?? ''}
            onChange={(v) =>
              edit('text', (c) => void ((c.type === 'text' || c.type === 'box') && (c.text = v)))
            }
          />
        )}
        {clip.type === 'text' && (
          <SelectField
            label={t('role')}
            value={clip.role ?? 'paragraph'}
            options={[
              { value: 'paragraph', label: t('roleParagraph') },
              { value: 'heading', label: t('roleHeading') },
            ]}
            onChange={(v) => edit('role', (c) => void (c.type === 'text' && (c.role = v)))}
          />
        )}
        {(clip.type === 'text' || clip.type === 'box') && (
          <>
            <NumberField
              label={t('fontSize')}
              min={1}
              max={1000}
              value={clip.style?.fontSize ?? 48}
              onCommit={(v) => editStyle('fontSize', v)}
            />
            <ColorField
              label={t('color')}
              value={clip.style?.color ?? '#ffffff'}
              onChange={(v) => editStyle('color', v)}
            />
            <SelectField
              label={t('align')}
              value={clip.style?.align ?? 'left'}
              options={[
                { value: 'left', label: '⯇ left' },
                { value: 'center', label: '≡ center' },
                { value: 'right', label: 'right ⯈' },
              ]}
              onChange={(v) => editStyle('align', v)}
            />
          </>
        )}
        {(clip.type === 'image' || clip.type === 'video' || clip.type === 'audio') && (
          <SelectField
            label={t('media')}
            value={clip.assetId}
            options={assetsOf(clip.type)}
            onChange={(v) =>
              edit(
                'asset',
                (c) =>
                  void (
                    (c.type === 'image' || c.type === 'video' || c.type === 'audio') &&
                    (c.assetId = v)
                  ),
              )
            }
          />
        )}
        {clip.type === 'image' && (
          <TextField
            label={t('altText')}
            hint={t('altHint')}
            value={clip.alt ?? course.assets[clip.assetId]?.alt ?? ''}
            onChange={(v) => edit('alt', (c) => void (c.type === 'image' && (c.alt = v)))}
          />
        )}
        {(clip.type === 'video' || clip.type === 'audio') && (
          <SelectField
            label={t('captions')}
            value={clip.captionsAssetId ?? ''}
            options={[{ value: '', label: t('none') }, ...assetsOf('captions')]}
            onChange={(v) =>
              edit('captions', (c) => {
                if (c.type !== 'video' && c.type !== 'audio') return;
                if (v) c.captionsAssetId = v;
                else delete c.captionsAssetId;
              })
            }
          />
        )}
      </fieldset>

      {(clip.type === 'box' || clip.type === 'shape') && (
        <fieldset>
          <legend>{t('fill')}</legend>
          {clip.type === 'shape' && (
            <SelectField
              label={t('shape')}
              value={clip.shape}
              options={(['rect', 'ellipse', 'line', 'arrow'] as const).map((v) => ({
                value: v,
                label: v,
              }))}
              onChange={(v) => edit('shape', (c) => void (c.type === 'shape' && (c.shape = v)))}
            />
          )}
          <ColorField
            label={t('fill')}
            value={clip.fill}
            onChange={(v) =>
              edit('fill', (c) => void ((c.type === 'box' || c.type === 'shape') && (c.fill = v)))
            }
          />
          <ColorField
            label={t('stroke')}
            value={clip.stroke}
            onChange={(v) =>
              edit(
                'stroke',
                (c) => void ((c.type === 'box' || c.type === 'shape') && (c.stroke = v)),
              )
            }
          />
          <NumberField
            label={t('strokeWidth')}
            min={0}
            max={200}
            value={clip.strokeWidth ?? 0}
            onCommit={(v) =>
              edit(
                'strokeWidth',
                (c) => void ((c.type === 'box' || c.type === 'shape') && (c.strokeWidth = v)),
              )
            }
          />
        </fieldset>
      )}

      {clip.type === 'highlight' && (
        <fieldset>
          <legend>{t('highlight')}</legend>
          <SelectField<HighlightKind>
            label={t('highlightKind')}
            value={clip.kind}
            options={[
              { value: 'frame', label: t('highlightFrame') },
              { value: 'marker', label: t('highlightMarker') },
              { value: 'arrow', label: t('highlightArrow') },
              { value: 'spotlight', label: t('highlightSpotlight') },
            ]}
            onChange={(v) => edit('kind', (c) => void (c.type === 'highlight' && (c.kind = v)))}
          />
          {clip.kind !== 'spotlight' && (
            <ColorField
              label={t('color')}
              value={clip.color ?? (clip.kind === 'marker' ? '#ffdd00' : '#ff5d73')}
              onChange={(v) => edit('color', (c) => void (c.type === 'highlight' && (c.color = v)))}
            />
          )}
          {(clip.kind === 'frame' || clip.kind === 'arrow') && (
            <NumberField
              label={t('strokeWidth')}
              min={1}
              max={100}
              value={clip.strokeWidth ?? 8}
              onCommit={(v) =>
                edit('strokeWidth', (c) => void (c.type === 'highlight' && (c.strokeWidth = v)))
              }
            />
          )}
          <CheckField
            label={t('pulse')}
            checked={clip.pulse === true}
            onChange={(v) =>
              edit('pulse', (c) => {
                if (c.type !== 'highlight') return;
                if (v) c.pulse = true;
                else delete c.pulse;
              })
            }
          />
          <TextField
            label={t('screenReaderLabel')}
            value={clip.label ?? ''}
            onChange={(v) =>
              edit('label', (c) => {
                if (c.type !== 'highlight') return;
                if (v) c.label = v;
                else delete c.label;
              })
            }
          />
        </fieldset>
      )}

      {clip.type === 'progress' && (
        <fieldset>
          <legend>{t('clipLabelProgress')}</legend>
          <ColorField
            label={t('progressFill')}
            value={clip.fill ?? '#4f8cff'}
            onChange={(v) => edit('fill', (c) => void (c.type === 'progress' && (c.fill = v)))}
          />
          <ColorField
            label={t('progressBackground')}
            value={clip.background ?? '#555555'}
            onChange={(v) =>
              edit('background', (c) => void (c.type === 'progress' && (c.background = v)))
            }
          />
        </fieldset>
      )}

      {clip.type !== 'audio' && (
        <fieldset>
          <legend>{t('animation')}</legend>
          <AnimationFields clip={clip} phase="in" label={t('animationIn')} edit={edit} />
          <AnimationFields clip={clip} phase="out" label={t('animationOut')} edit={edit} />
        </fieldset>
      )}

      {clip.type !== 'audio' && (
        <details className="advanced">
          <summary>{t('advanced')}</summary>
          <fieldset>
            <legend>{t('layout')}</legend>
            {(['x', 'y', 'width', 'height'] as const).map((key) => (
              <NumberField
                key={key}
                label={key}
                min={key === 'width' || key === 'height' ? 1 : undefined}
                value={Math.round(clip.frame[key])}
                onCommit={(v) =>
                  edit(
                    `frame.${key}`,
                    (c) => void (c.type !== 'audio' && (c.frame = { ...c.frame, [key]: v })),
                  )
                }
              />
            ))}
            <NumberField
              label={t('rotation')}
              min={-360}
              max={360}
              value={clip.frame.rotation ?? 0}
              onCommit={(v) =>
                edit('rotation', (c) => {
                  if (c.type === 'audio') return;
                  const frame = { ...c.frame };
                  if (v) frame.rotation = v;
                  else delete frame.rotation;
                  c.frame = frame;
                })
              }
            />
            <NumberField
              label={t('opacity')}
              min={0}
              max={1}
              step={0.05}
              value={clip.opacity ?? 1}
              onCommit={(v) =>
                edit('opacity', (c) => {
                  if (c.type === 'audio') return;
                  if (v >= 1) delete c.opacity;
                  else c.opacity = v;
                })
              }
            />
            {(clip.type === 'box' || clip.type === 'shape') && (
              <NumberField
                label={t('radius')}
                min={0}
                value={clip.radius ?? 0}
                onCommit={(v) =>
                  edit(
                    'radius',
                    (c) => void ((c.type === 'box' || c.type === 'shape') && (c.radius = v)),
                  )
                }
              />
            )}
            {(clip.type === 'image' || clip.type === 'video') && (
              <SelectField
                label={t('fit')}
                value={clip.fit ?? 'contain'}
                options={(['contain', 'cover', 'fill'] as const).map((v) => ({
                  value: v,
                  label: v,
                }))}
                onChange={(v) =>
                  edit(
                    'fit',
                    (c) => void ((c.type === 'image' || c.type === 'video') && (c.fit = v)),
                  )
                }
              />
            )}
          </fieldset>
        </details>
      )}
      {(clip.type === 'video' || clip.type === 'audio') && (
        <NumberField
          label={t('volume')}
          min={0}
          max={1}
          step={0.05}
          value={clip.volume ?? 1}
          onCommit={(v) =>
            edit('volume', (c) => {
              if (c.type !== 'video' && c.type !== 'audio') return;
              if (v >= 1) delete c.volume;
              else c.volume = v;
            })
          }
        />
      )}
    </div>
  );
}

// --- Chapter and course ---------------------------------------------------------------

function ChapterInspector() {
  const { store } = useSession();
  const chapter = useEditor(selectChapter);
  const course = useEditor((s) => s.course);
  return (
    <div className="inspector-body">
      <p className="inspector-empty">{t('nothingSelected')}</p>
      <fieldset>
        <legend>{t('chapter')}</legend>
        <TextField
          label={t('title')}
          value={chapter.title}
          onChange={(v) =>
            store
              .getState()
              .execute('Rename chapter', setChapterProps(chapter.id, { title: v || ' ' }), {
                mergeKey: `chapter-title:${chapter.id}`,
              })
          }
        />
        <NumberField
          label={t('duration')}
          seconds
          min={0.1}
          value={chapter.duration}
          onCommit={(v) =>
            store
              .getState()
              .execute('Change chapter length', setChapterProps(chapter.id, { duration: v }))
          }
        />
        <button
          type="button"
          onClick={() => store.getState().execute('Fit chapter', fitChapterToContent(chapter.id))}
        >
          {t('fitToContent')}
        </button>
        <SelectField
          label={t('transition')}
          value={chapter.transition.mode}
          options={[
            { value: 'wait', label: t('transitionWait') },
            { value: 'auto', label: t('transitionAuto') },
          ]}
          onChange={(mode) =>
            store
              .getState()
              .execute('Change transition', setChapterProps(chapter.id, { transition: { mode } }))
          }
        />
        <ColorField
          label={t('background')}
          value={chapter.background ?? course.stage.background}
          onChange={(v) =>
            store
              .getState()
              .execute('Chapter background', setChapterProps(chapter.id, { background: v }), {
                mergeKey: `chapter-bg:${chapter.id}`,
              })
          }
        />
      </fieldset>
      <fieldset>
        <legend>{t('course')}</legend>
        <TextField
          label={t('title')}
          value={course.title}
          onChange={(v) =>
            store.getState().execute('Rename course', setCourseProps({ title: v || ' ' }), {
              mergeKey: 'course-title',
            })
          }
        />
        <LanguageField
          value={course.language}
          onCommit={(v) =>
            store.getState().execute('Course language', setCourseProps({ language: v }))
          }
        />
      </fieldset>
    </div>
  );
}

/** Language tag input; commits only valid BCP 47 tags. */
function LanguageField({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const valid = (v: string) => /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/.test(v);
  const commit = () => {
    if (draft !== null && valid(draft) && draft !== value) onCommit(draft);
    setDraft(null);
  };
  return (
    <Field label={t('language')} hint="BCP 47, e.g. en, de, de-CH">
      {(id) => (
        <input
          id={id}
          type="text"
          value={draft ?? value}
          aria-invalid={draft !== null && !valid(draft)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
        />
      )}
    </Field>
  );
}

function CheckField(props: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  const id = useId();
  return (
    <div className="field field-check">
      <input
        id={id}
        type="checkbox"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      <label htmlFor={id}>{props.label}</label>
    </div>
  );
}

const DEFAULT_ANIMATION_MS = 500;

/** Entrance or exit animation: type, then duration and direction when set. */
function AnimationFields({
  clip,
  phase,
  label,
  edit,
}: {
  clip: VisualClip;
  phase: 'in' | 'out';
  label: string;
  edit: (field: string, update: (c: Clip) => void) => void;
}) {
  const current = clip.animations?.[phase];
  const set = (field: string, next: Animation | null) =>
    edit(`anim.${phase}.${field}`, (c) => {
      if (c.type === 'audio') return;
      const animations = { ...c.animations };
      if (next) animations[phase] = next;
      else delete animations[phase];
      if (animations.in || animations.out) c.animations = animations;
      else delete c.animations;
    });
  return (
    <div className="anim-group" data-phase={phase}>
      <SelectField<AnimationType | 'none'>
        label={label}
        value={current?.type ?? 'none'}
        options={[
          { value: 'none', label: t('animationNone') },
          { value: 'fade', label: t('animationFade') },
          { value: 'slide', label: t('animationSlide') },
          { value: 'zoom', label: t('animationZoom') },
        ]}
        onChange={(type) =>
          set(
            'type',
            type === 'none'
              ? null
              : {
                  ...current,
                  type,
                  duration: current?.duration ?? DEFAULT_ANIMATION_MS,
                  ...(type === 'slide' && !current?.direction
                    ? { direction: phase === 'in' ? 'left' : 'right' }
                    : {}),
                },
          )
        }
      />
      {current && (
        <NumberField
          label={`${label}: ${t('duration')}`}
          seconds
          min={0.05}
          max={60}
          value={current.duration}
          onCommit={(v) => set('duration', { ...current, duration: Math.max(1, v) })}
        />
      )}
      {current?.type === 'slide' && (
        <SelectField<SlideDirection>
          label={`${label}: ${t('direction')}`}
          value={current.direction ?? 'left'}
          options={(['left', 'right', 'up', 'down'] as const).map((v) => ({ value: v, label: v }))}
          onChange={(direction) => set('direction', { ...current, direction })}
        />
      )}
    </div>
  );
}
