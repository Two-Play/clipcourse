// SPDX-License-Identifier: AGPL-3.0-only
/** Exports the project as a SCORM package (.zip) for an LMS. */
import { ExportError, exportScorm, packageFileName, type ScormVersion } from '@clipcourse/exporter';
import runtime from '@clipcourse/scorm-runtime/dist/clipcourse-runtime.iife.js?raw';
import { useEffect, useRef, useState } from 'react';
import { useSession } from '../context.js';
import { t } from '../i18n.js';
import { downloadBytes } from '../platform/browser.js';

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const session = useSession();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [version, setVersion] = useState<ScormVersion>('1.2');
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    dialogRef.current!.showModal();
  }, []);

  const course = session.store.getState().course;
  const mediaBytes = [...session.files.entries()]
    .filter(([path]) => Object.values(course.assets).some((a) => a.src === path))
    .reduce((sum, [, data]) => sum + data.length, 0);

  const run = () => {
    setErrors([]);
    setDone(null);
    try {
      const result = exportScorm(session.project, { version, runtime, generator: 'Clipcourse' });
      const name = packageFileName(course, version);
      downloadBytes(document, result.zip, name, 'application/zip');
      setWarnings(result.warnings);
      setDone(t('exportDone', { name, size: formatSize(result.zip.length) }));
    } catch (error) {
      if (error instanceof ExportError) setErrors([error.message, ...error.details]);
      else setErrors([String(error)]);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="export"
      aria-labelledby="export-title"
      onClose={onClose}
      onCancel={onClose}
    >
      <h2 id="export-title">{t('exportTitle')}</h2>
      <p className="muted">
        {t('exportSummary', {
          chapters: course.chapters.length,
          size: formatSize(mediaBytes),
        })}
      </p>
      <fieldset>
        <legend>{t('scormVersion')}</legend>
        <label className="radio">
          <input
            type="radio"
            name="scorm"
            checked={version === '1.2'}
            onChange={() => setVersion('1.2')}
          />
          <span>
            <strong>SCORM 1.2</strong> – {t('scorm12Hint')}
          </span>
        </label>
        <label className="radio">
          <input
            type="radio"
            name="scorm"
            checked={version === '2004'}
            onChange={() => setVersion('2004')}
          />
          <span>
            <strong>SCORM 2004 (4th Edition)</strong> – {t('scorm2004Hint')}
          </span>
        </label>
      </fieldset>
      {errors.length > 0 && (
        <div className="notice notice-error" role="alert">
          <ul>
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="notice" role="status">
          <ul>
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      {done && (
        <p className="export-done" role="status">
          {done}
        </p>
      )}
      <div className="dialog-buttons">
        <button type="button" onClick={onClose}>
          {t('close')}
        </button>
        <button type="button" className="primary" onClick={run}>
          {t('exportButton')}
        </button>
      </div>
    </dialog>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}
