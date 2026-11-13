// SPDX-License-Identifier: AGPL-3.0-only
/** Chapter list: open, add from templates, rename, reorder, duplicate, delete. */
import {
  builtInTemplates,
  duplicateChapter,
  moveChapter,
  removeChapter,
  setChapterProps,
  type ChapterTemplate,
} from '@clipcourse/editor-core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { insertTemplate, saveChapterAsTemplate } from '../actions.js';
import { useEditor, useSession } from '../context.js';
import { formatTimecode } from '../geometry.js';
import { t } from '../i18n.js';

export function ChapterPanel({ onMessage }: { onMessage: (message: string) => void }) {
  const session = useSession();
  const { store, storage } = session;
  const chapters = useEditor((s) => s.course.chapters);
  const chapterId = useEditor((s) => s.chapterId);
  const course = useEditor((s) => s.course);
  const [editing, setEditing] = useState<string | null>(null);
  const [userTemplates, setUserTemplates] = useState<ChapterTemplate[]>([]);
  const menuRef = useRef<HTMLDetailsElement>(null);

  const reloadTemplates = useCallback(
    async () => setUserTemplates(await storage.listTemplates()),
    [storage],
  );
  useEffect(() => {
    void reloadTemplates();
  }, [reloadTemplates]);

  const choose = (template: ChapterTemplate) => {
    insertTemplate(session, template);
    if (menuRef.current) menuRef.current.open = false;
  };

  const saveTemplate = async () => {
    const current = chapters.find((c) => c.id === chapterId)!;
    const name = window.prompt(t('templateName'), current.title)?.trim();
    if (!name) return;
    await saveChapterAsTemplate(session, chapterId, name);
    await reloadTemplates();
    onMessage(t('templateSaved', { name }));
  };

  return (
    <section className="chapters" aria-label={t('chapters')}>
      <div className="panel-title">
        <h2>{t('chapters')}</h2>
        <details className="menu" ref={menuRef}>
          <summary className="button">＋ {t('addChapter')}</summary>
          <div className="menu-popup" role="menu">
            <p className="menu-heading">{t('templates')}</p>
            {builtInTemplates(course).map((template) => (
              <button
                key={template.id}
                type="button"
                role="menuitem"
                onClick={() => choose(template)}
              >
                {template.name}
              </button>
            ))}
            {userTemplates.length > 0 && <p className="menu-heading">{t('myTemplates')}</p>}
            {userTemplates.map((template) => (
              <div key={template.id} className="menu-row">
                <button type="button" role="menuitem" onClick={() => choose(template)}>
                  {template.name}
                </button>
                <button
                  type="button"
                  className="icon"
                  aria-label={`${t('deleteTemplate')}: ${template.name}`}
                  onClick={async () => {
                    await storage.deleteTemplate(template.id);
                    await reloadTemplates();
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </details>
      </div>

      <ol className="chapter-list">
        {chapters.map((chapter, index) => {
          const active = chapter.id === chapterId;
          return (
            <li
              key={chapter.id}
              className={`chapter-item${active ? ' is-active' : ''}`}
              data-chapter-id={chapter.id}
            >
              {editing === chapter.id ? (
                <input
                  aria-label={t('renameChapter')}
                  defaultValue={chapter.title}
                  autoFocus
                  onBlur={(e) => {
                    setEditing(null);
                    const title = e.target.value.trim();
                    if (title && title !== chapter.title) {
                      store
                        .getState()
                        .execute('Rename chapter', setChapterProps(chapter.id, { title }));
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    if (e.key === 'Escape') setEditing(null);
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="chapter-open"
                  aria-current={active ? 'true' : undefined}
                  onClick={() => store.getState().setChapter(chapter.id)}
                  onDoubleClick={() => setEditing(chapter.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'F2') setEditing(chapter.id);
                  }}
                  title={`${t('renameChapter')}: F2 / double-click`}
                >
                  <span className="chapter-num">{index + 1}.</span>
                  <span className="chapter-title">{chapter.title}</span>
                  <small>
                    {formatTimecode(chapter.duration).replace(/\.\d$/, '')}
                    {chapter.transition.mode === 'auto' ? ' ↪' : ''}
                  </small>
                </button>
              )}
              <span className="chapter-actions">
                <button
                  type="button"
                  className="icon"
                  aria-label={`${t('moveChapterUp')}: ${chapter.title}`}
                  disabled={index === 0}
                  onClick={() =>
                    store.getState().execute('Move chapter', moveChapter(chapter.id, index - 1))
                  }
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="icon"
                  aria-label={`${t('moveChapterDown')}: ${chapter.title}`}
                  disabled={index === chapters.length - 1}
                  onClick={() =>
                    store.getState().execute('Move chapter', moveChapter(chapter.id, index + 1))
                  }
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="icon"
                  aria-label={`${t('duplicateChapter')}: ${chapter.title}`}
                  onClick={() => {
                    let created = '';
                    store.getState().execute(
                      'Duplicate chapter',
                      duplicateChapter(
                        chapter.id,
                        (p) => session.newId(p),
                        (id) => (created = id),
                      ),
                    );
                    if (created) store.getState().setChapter(created);
                  }}
                >
                  ⧉
                </button>
                <button
                  type="button"
                  className="icon"
                  aria-label={`${t('deleteChapter')}: ${chapter.title}`}
                  disabled={chapters.length <= 1}
                  onClick={() => {
                    if (!window.confirm(t('confirmDeleteChapter', { title: chapter.title })))
                      return;
                    const next = chapters[index + 1] ?? chapters[index - 1]!;
                    if (active) store.getState().setChapter(next.id);
                    store.getState().execute('Delete chapter', removeChapter(chapter.id));
                  }}
                >
                  ✕
                </button>
              </span>
            </li>
          );
        })}
      </ol>
      <button type="button" className="save-template" onClick={saveTemplate}>
        {t('saveAsTemplate')}
      </button>
    </section>
  );
}
