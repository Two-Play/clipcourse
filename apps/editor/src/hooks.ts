// SPDX-License-Identifier: AGPL-3.0-only
import { selectChapter } from '@clipcourse/editor-core';
import { useEffect } from 'react';
import { deleteSelection, duplicateSelection, splitSelectionAtPlayhead } from './actions.js';
import type { EditorSession } from './session.js';

/** Advances the playhead while playing; stops at the chapter end. */
export function usePlayback(session: EditorSession) {
  useEffect(() => {
    const { store } = session;
    let frame = 0;
    let last = 0;
    const loop = (now: number) => {
      const s = store.getState();
      if (!s.playing) return;
      const delta = Math.min(now - last, 250);
      last = now;
      if (!session.stageStalled) {
        const duration = selectChapter(s).duration;
        const next = s.playhead + delta;
        if (next >= duration) {
          s.setPlayhead(duration);
          s.setPlaying(false);
          return;
        }
        s.setPlayhead(next);
      }
      frame = requestAnimationFrame(loop);
    };
    const unsubscribe = store.subscribe((s, prev) => {
      if (s.playing && !prev.playing) {
        last = performance.now();
        frame = requestAnimationFrame(loop);
      } else if (!s.playing && prev.playing) {
        cancelAnimationFrame(frame);
      }
    });
    return () => {
      unsubscribe();
      cancelAnimationFrame(frame);
    };
  }, [session]);
}

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

/** Global keyboard shortcuts (ignored while typing in a field). */
export function useShortcuts(session: EditorSession, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTyping(e.target)) return;
      const s = session.store.getState();
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      let handled = true;
      if (mod && key === 'z' && !e.shiftKey) s.undo();
      else if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) s.redo();
      else if (mod && key === 'd') duplicateSelection(session);
      else if (mod && key === 'a')
        s.select(selectChapter(s).tracks.flatMap((t) => t.clips.map((c) => c.id)));
      else if (mod) handled = false;
      else if (key === ' ' && (e.target as HTMLElement)?.tagName !== 'BUTTON') {
        if (!s.playing && s.playhead >= selectChapter(s).duration) s.setPlayhead(0);
        s.setPlaying(!s.playing);
      } else if (key === 'delete' || key === 'backspace') deleteSelection(session);
      else if (key === 's') splitSelectionAtPlayhead(session);
      else if (key === 'escape') s.select([]);
      else if (key === 'arrowleft' && (e.target as HTMLElement)?.getAttribute('role') !== 'button')
        s.setPlayhead(s.playhead - (e.shiftKey ? 1000 : 100));
      else if (key === 'arrowright' && (e.target as HTMLElement)?.getAttribute('role') !== 'button')
        s.setPlayhead(s.playhead + (e.shiftKey ? 1000 : 100));
      else if (key === 'home') s.setPlayhead(0);
      else if (key === 'end') s.setPlayhead(selectChapter(s).duration);
      else handled = false;
      if (handled) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [session, enabled]);
}

/** Saves a working copy to the platform's draft storage after changes. */
export function useAutosave(session: EditorSession, delay = 800) {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (session.store.getState().transaction) return schedule();
        void session.storage.saveDraft(session.project).catch(() => {});
      }, delay);
    };
    const unsubscribe = session.store.subscribe((s, prev) => {
      if (s.course !== prev.course && !s.transaction) schedule();
    });
    const unsubscribeFiles = session.subscribeFiles(schedule);
    const flush = () => void session.storage.saveDraft(session.project).catch(() => {});
    window.addEventListener('pagehide', flush);
    return () => {
      clearTimeout(timer);
      unsubscribe();
      unsubscribeFiles();
      window.removeEventListener('pagehide', flush);
    };
  }, [session, delay]);
}
