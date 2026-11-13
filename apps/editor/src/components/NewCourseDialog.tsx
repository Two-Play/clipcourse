// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "New course": blank or one of the course templates, with a theme. The
 * thumbnails are the real player rendering the first chapter, so what the
 * author sees is what learners get.
 */
import { COURSE_TEMPLATES, createEmptyCourse } from '@clipcourse/editor-core';
import { THEME_PRESETS, themePreset, type Course, type Theme } from '@clipcourse/format';
import { evaluate, injectStyles, Stage } from '@clipcourse/player';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSession } from '../context.js';
import { t } from '../i18n.js';

const THUMB_WIDTH = 240;

/** A small, static picture of a course's first chapter. */
export function CourseThumbnail({ course, time = 4000 }: { course: Course; time?: number }) {
  const hostRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    injectStyles(document);
    const stage = new Stage(document, course, {
      resolveAsset: () => '',
      onPlayBlocked: () => {},
      onMediaError: () => {},
    });
    stage.element.style.transformOrigin = '0 0';
    stage.element.style.transform = `scale(${THUMB_WIDTH / course.stage.width})`;
    stage.element.setAttribute('aria-hidden', 'true');
    stage.element.inert = true;
    host.replaceChildren(stage.element);
    stage.render(evaluate(course, 0, Math.min(time, course.chapters[0]!.duration)), false);
    return () => stage.destroy();
  }, [course, time]);
  return (
    <div
      ref={hostRef}
      className="course-thumb"
      style={{
        width: THUMB_WIDTH,
        height: (THUMB_WIDTH * course.stage.height) / course.stage.width,
      }}
    />
  );
}

export function ThemeSwatch({ theme }: { theme: Theme }) {
  const c = theme.colors;
  return (
    <span
      className="theme-swatch"
      aria-hidden
      style={{ background: c.background, borderColor: c.muted }}
    >
      <span style={{ background: c.text }} />
      <span style={{ background: c.accent }} />
      <span style={{ background: c.surface }} />
    </span>
  );
}

export function NewCourseDialog({ onClose }: { onClose: () => void }) {
  const session = useSession();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [templateId, setTemplateId] = useState<string>('blank');
  const [themeId, setThemeId] = useState<string>('dark');

  useEffect(() => {
    dialogRef.current!.showModal();
  }, []);

  const options = useMemo(
    () => [
      {
        id: 'blank',
        name: t('blankCourse'),
        description: t('blankCourseDescription'),
        theme: 'dark',
      },
      ...COURSE_TEMPLATES.map((tpl) => ({
        id: tpl.id,
        name: tpl.name,
        description: tpl.description,
        theme: tpl.theme,
      })),
    ],
    [],
  );

  const theme = themePreset(themeId)!.theme;
  const build = (id: string, th: Theme, newId: (p: string) => string): Course => {
    const template = COURSE_TEMPLATES.find((tpl) => tpl.id === id);
    return template ? template.create(newId, th) : createEmptyCourse(newId, 'Untitled course', th);
  };
  // Previews with throwaway ids.
  const previews = useMemo(() => {
    let n = 0;
    const id = (p: string) => `${p}_${++n}`;
    return Object.fromEntries(options.map((o) => [o.id, build(o.id, theme, id)]));
  }, [options, theme]);

  const create = () => {
    session.load({ course: build(templateId, theme, (p) => session.newId(p)), files: new Map() });
    onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      className="new-course"
      aria-labelledby="new-course-title"
      onClose={onClose}
      onCancel={onClose}
    >
      <h2 id="new-course-title">{t('newCourseTitle')}</h2>
      <p className="muted">{t('newCourseIntro')}</p>
      <fieldset className="gallery">
        <legend>{t('chooseTemplate')}</legend>
        {options.map((o) => (
          <label key={o.id} className={`gallery-card${templateId === o.id ? ' is-selected' : ''}`}>
            <input
              type="radio"
              name="template"
              value={o.id}
              checked={templateId === o.id}
              onChange={() => {
                setTemplateId(o.id);
                setThemeId(o.theme);
              }}
            />
            <CourseThumbnail course={previews[o.id]!} />
            <span className="gallery-name">{o.name}</span>
            <span className="gallery-description">{o.description}</span>
          </label>
        ))}
      </fieldset>
      <fieldset className="theme-picker">
        <legend>{t('chooseTheme')}</legend>
        {THEME_PRESETS.map((p) => (
          <label key={p.id} className={`theme-option${themeId === p.id ? ' is-selected' : ''}`}>
            <input
              type="radio"
              name="theme"
              value={p.id}
              checked={themeId === p.id}
              onChange={() => setThemeId(p.id)}
            />
            <ThemeSwatch theme={p.theme} />
            {p.name}
          </label>
        ))}
      </fieldset>
      <div className="dialog-buttons">
        <button type="button" onClick={onClose}>
          {t('cancel')}
        </button>
        <button type="button" className="primary" onClick={create}>
          {t('create')}
        </button>
      </div>
    </dialog>
  );
}
