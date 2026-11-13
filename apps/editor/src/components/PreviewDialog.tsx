// SPDX-License-Identifier: AGPL-3.0-only
/** Plays the course with the real player, exactly as learners will see it. */
import { createMemoryStore, createPlayer, type Player } from '@clipcourse/player';
import { useEffect, useRef } from 'react';
import { useSession } from '../context.js';
import { t } from '../i18n.js';

export function PreviewDialog({ onClose }: { onClose: () => void }) {
  const session = useSession();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current!;
    dialog.showModal();
    const state = session.store.getState();
    const chapterIndex = state.course.chapters.findIndex((c) => c.id === state.chapterId);
    let player: Player | null = createPlayer(hostRef.current!, state.course, {
      resolveAsset: session.resolveAsset,
      progressStore: createMemoryStore(),
      captions: true,
    });
    player.goToChapter(chapterIndex, state.playhead);
    (window as unknown as { __preview?: Player }).__preview = player;
    return () => {
      player?.destroy();
      player = null;
      delete (window as unknown as { __preview?: Player }).__preview;
    };
  }, [session]);

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
        <button type="button" onClick={onClose} autoFocus>
          {t('closePreview')}
        </button>
      </div>
      <div className="preview-player" ref={hostRef} />
    </dialog>
  );
}
