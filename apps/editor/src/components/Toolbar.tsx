// SPDX-License-Identifier: AGPL-3.0-only
import {
  createEmptyCourse,
  ProjectError,
  selectCanRedo,
  selectCanUndo,
  selectDirty,
  type Project,
} from '@clipcourse/editor-core';
import { addClipAt, addProgressBar } from '../actions.js';
import { useEditor, useSession } from '../context.js';
import { loadExample } from '../examples.js';
import { t } from '../i18n.js';
import { probeMediaDuration } from '../session.js';

export function Toolbar({
  onPreview,
  onExport,
  onAi,
  onError,
}: {
  onPreview: () => void;
  onExport: () => void;
  onAi: () => void;
  onError: (message: string) => void;
}) {
  const session = useSession();
  const { store, storage } = session;
  const canUndo = useEditor(selectCanUndo);
  const canRedo = useEditor(selectCanRedo);
  const dirty = useEditor(selectDirty);
  const title = useEditor((s) => s.course.title);

  const confirmDiscard = () => !dirty || window.confirm(t('confirmDiscard'));

  const replace = (project: Project) => {
    session.load(project);
  };

  const open = async () => {
    if (!confirmDiscard()) return;
    try {
      const project = await storage.openProject();
      if (project) replace(project);
    } catch (error) {
      const details =
        error instanceof ProjectError && error.issues.length
          ? '\n' +
            error.issues
              .slice(0, 5)
              .map((i) => `${i.path}: ${i.message}`)
              .join('\n')
          : '';
      onError(
        `${t('openFailed')} ${error instanceof Error ? error.message : String(error)}${details}`,
      );
    }
  };

  const save = async () => {
    const name =
      title
        .trim()
        .replace(/[^\p{L}\p{N}_-]+/gu, '-')
        .replace(/^-|-$/g, '') || 'course';
    await storage.saveProject(session.project, name);
    store.getState().markSaved();
  };

  const importMedia = async () => {
    const files = await storage.pickFiles('image/*,video/*,audio/*,.vtt,text/vtt');
    const result = await session.importFiles(files, probeMediaDuration);
    if (result.errors.length) onError(`${t('importFailed')} ${result.errors.join('; ')}`);
  };

  return (
    <header className="toolbar">
      <span className="brand">{t('appName')}</span>
      <div className="toolbar-group" role="group" aria-label="Project">
        <button
          type="button"
          onClick={() =>
            confirmDiscard() &&
            replace({ course: createEmptyCourse((p) => session.newId(p)), files: new Map() })
          }
        >
          {t('new')}
        </button>
        <button type="button" onClick={open}>
          {t('open')}
        </button>
        <button
          type="button"
          onClick={async () => {
            if (!confirmDiscard()) return;
            try {
              replace(await loadExample('welcome'));
            } catch (error) {
              onError(`${t('openFailed')} ${String(error)}`);
            }
          }}
        >
          {t('openExample')}
        </button>
        <button
          type="button"
          onClick={save}
          className={dirty ? 'is-dirty' : ''}
          title={dirty ? t('unsaved') : t('saved')}
        >
          {t('save')}
          {dirty ? ' •' : ''}
        </button>
      </div>
      <div className="toolbar-group" role="group" aria-label="History">
        <button
          type="button"
          onClick={() => store.getState().undo()}
          disabled={!canUndo}
          title={`${t('undo')} (Ctrl+Z)`}
        >
          ↶ {t('undo')}
        </button>
        <button
          type="button"
          onClick={() => store.getState().redo()}
          disabled={!canRedo}
          title={`${t('redo')} (Ctrl+Shift+Z)`}
        >
          ↷ {t('redo')}
        </button>
      </div>
      <div className="toolbar-group" role="group" aria-label="Add">
        <button type="button" onClick={() => addClipAt(session, 'text')}>
          ＋ {t('addText')}
        </button>
        <button type="button" onClick={() => addClipAt(session, 'box')}>
          ＋ {t('addBox')}
        </button>
        <button type="button" onClick={() => addClipAt(session, 'shape')}>
          ＋ {t('addShape')}
        </button>
        <button type="button" onClick={() => addClipAt(session, 'highlight')}>
          ＋ {t('addHighlight')}
        </button>
        <button type="button" onClick={() => addProgressBar(session)}>
          ＋ {t('addProgress')}
        </button>
        <button type="button" onClick={importMedia}>
          {t('importMedia')}
        </button>
      </div>
      <div className="toolbar-end">
        <button type="button" className="primary" onClick={onPreview}>
          ▶ {t('preview')}
        </button>
        <button type="button" onClick={onExport}>
          {t('exportScorm')}
        </button>
        <button type="button" onClick={onAi}>
          ✦ {t('aiAssistant')}
        </button>
      </div>
    </header>
  );
}
