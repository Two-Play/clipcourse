// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Plays the course with the real player, exactly as learners will see it.
 * Optionally runs it against a simulated LMS (SCORM 1.2 or 2004) and shows
 * what the LMS stores: status, bookmark, progress.
 */
import type { Player } from '@clipcourse/player';
import { createMemoryStore, createPlayer } from '@clipcourse/player';
import { runCourse, type RunningCourse, type ScormVersion } from '@clipcourse/scorm-runtime';
import {
  createLmsRecord,
  createMockLms,
  type LmsRecord,
  type MockLms,
} from '@clipcourse/scorm-runtime/testing';
import { useEffect, useReducer, useRef, useState } from 'react';
import { useSession } from '../context.js';
import { t } from '../i18n.js';

type Mode = 'off' | ScormVersion;

declare global {
  interface Window {
    __preview?: Player;
    __previewLms?: MockLms<unknown>;
  }
}

export function PreviewDialog({ onClose }: { onClose: () => void }) {
  const session = useSession();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>('off');
  const [launch, setLaunch] = useState(0);
  const recordRef = useRef<LmsRecord>(createLmsRecord());
  const [lms, setLms] = useState<MockLms<unknown> | null>(null);
  const [, refresh] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    dialogRef.current!.showModal();
  }, []);

  useEffect(() => {
    const host = hostRef.current!;
    const state = session.store.getState();
    const chapterIndex = state.course.chapters.findIndex((c) => c.id === state.chapterId);
    const playerOptions = { resolveAsset: session.resolveAsset, captions: true };
    let running: RunningCourse | null = null;
    let player: Player;
    if (mode === 'off') {
      player = createPlayer(host, state.course, {
        ...playerOptions,
        progressStore: createMemoryStore(),
      });
      player.goToChapter(chapterIndex, state.playhead);
      setLms(null);
    } else {
      const mock = createMockLms(mode, recordRef.current) as MockLms<unknown>;
      mock.onChange = refresh;
      running = runCourse(host, state.course, {
        scormVersion: mode,
        api: { version: mode, api: mock.api } as never,
        player: playerOptions,
      });
      player = running.player;
      setLms(mock);
      window.__previewLms = mock;
    }
    window.__preview = player;
    return () => {
      if (running) running.destroy();
      else player.destroy();
      delete window.__preview;
      delete window.__previewLms;
    };
  }, [session, mode, launch]);

  const values = lms?.values ?? {};
  const v12 = mode === '1.2';
  const rows: [string, string][] = lms
    ? [
        [t('lmsStatus'), values[v12 ? 'cmi.core.lesson_status' : 'cmi.completion_status'] ?? ''],
        [t('lmsEntry'), values[v12 ? 'cmi.core.entry' : 'cmi.entry'] ?? ''],
        [t('lmsLocation'), values[v12 ? 'cmi.core.lesson_location' : 'cmi.location'] ?? ''],
        ...(v12
          ? []
          : ([[t('lmsProgress'), values['cmi.progress_measure'] ?? '']] as [string, string][])),
        ...(v12
          ? ([
              [
                t('lmsScore'),
                scoreText(values['cmi.core.score.raw'], values['cmi.core.score.max']),
              ],
            ] as [string, string][])
          : ([
              [t('lmsScore'), scoreText(values['cmi.score.raw'], values['cmi.score.max'])],
              [t('lmsSuccess'), values['cmi.success_status'] ?? ''],
            ] as [string, string][])),
        ['suspend_data', values['cmi.suspend_data'] ?? ''],
        [
          t('lmsSession'),
          `${lms.state} · ${t('lmsLaunches', { n: lms.record.launches })} · ${lms.calls.length} ${t('lmsCalls')}`,
        ],
      ]
    : [];

  return (
    <dialog
      ref={dialogRef}
      className="preview"
      aria-label={t('preview')}
      onClose={onClose}
      onCancel={onClose}
    >
      <div className="preview-bar">
        <strong>{t('preview')}</strong>
        <label className="preview-mode">
          {t('lmsSimulation')}
          <select
            value={mode}
            onChange={(e) => {
              recordRef.current = createLmsRecord();
              setMode(e.target.value as Mode);
            }}
          >
            <option value="off">{t('lmsOff')}</option>
            <option value="1.2">SCORM 1.2</option>
            <option value="2004">SCORM 2004</option>
          </select>
        </label>
        {mode !== 'off' && (
          <>
            <button
              type="button"
              onClick={() => setLaunch((n) => n + 1)}
              title={t('lmsRelaunchHint')}
            >
              {t('lmsRelaunch')}
            </button>
            <button
              type="button"
              onClick={() => {
                recordRef.current = createLmsRecord();
                setLaunch((n) => n + 1);
              }}
            >
              {t('lmsReset')}
            </button>
          </>
        )}
        <button type="button" onClick={onClose} autoFocus>
          {t('closePreview')}
        </button>
      </div>
      <div className="preview-body">
        <div className="preview-player" ref={hostRef} />
        {lms && (
          <aside className="lms-panel" aria-label={t('lmsSimulation')}>
            <h3>{t('lmsData')}</h3>
            <dl>
              {rows.map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd data-lms-key={k}>{v || '—'}</dd>
                </div>
              ))}
            </dl>
          </aside>
        )}
      </div>
    </dialog>
  );
}

/** The runtime reports raw as a percentage (min 0, max 100). */
function scoreText(raw: string | undefined, max: string | undefined): string {
  if (!raw) return '';
  return max === '100' ? `${raw} %` : max ? `${raw} / ${max}` : raw;
}
