// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The stage shows the current chapter at the playhead using the real player
 * renderer, plus a selection overlay to move and resize clips directly.
 */
import { selectChapter, updateClip } from '@clipcourse/editor-core';
import type { Frame, VisualClip } from '@clipcourse/format';
import { evaluate, injectStyles, Stage, themeVariables } from '@clipcourse/player';
import { themeOf } from '@clipcourse/format';
import { QuizStagePreview } from './QuizStagePreview.js';
import { menuLabel, openContextMenu } from './ContextMenu.js';
import { clipMenuItems, stageMenuItems } from '../contextMenus.js';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { useEditor, useSession } from '../context.js';
import { hitTest, resizeFrame, type Handle } from '../geometry.js';
import { t } from '../i18n.js';

export function StageView() {
  const session = useSession();
  const { store } = session;
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const [scale, setScale] = useState(1);
  const course = useEditor((s) => s.course);
  const playhead = useEditor((s) => s.playhead);
  const selection = useEditor((s) => s.selection);
  const chapterId = useEditor((s) => s.chapterId);
  const { width: stageWidth, height: stageHeight } = course.stage;

  // Create the renderer once and drive it straight from the store (no React
  // re-render per frame during playback).
  useLayoutEffect(() => {
    injectStyles(document);
    const stage = new Stage(document, store.getState().course, {
      resolveAsset: session.resolveAsset,
      onPlayBlocked: () => store.getState().setPlaying(false),
      onMediaError: () => {},
    });
    stage.setCaptionsEnabled(true);
    stageRef.current = stage;
    canvasRef.current!.prepend(stage.element);
    const render = () => {
      const s = store.getState();
      const index = s.course.chapters.findIndex((c) => c.id === s.chapterId);
      stage.setCourse(s.course);
      stage.render(evaluate(s.course, index, s.playhead), s.playing);
      session.stageStalled = stage.isStalled;
    };
    render();
    const unsubscribe = store.subscribe((s, prev) => {
      if (
        s.course !== prev.course ||
        s.chapterId !== prev.chapterId ||
        s.playhead !== prev.playhead ||
        s.playing !== prev.playing
      ) {
        render();
      }
    });
    const unsubscribeFiles = session.subscribeFiles(() => {
      // New files may resolve assets that were missing before.
      stage.setCourse({ ...store.getState().course });
      render();
    });
    return () => {
      unsubscribe();
      unsubscribeFiles();
      stage.destroy();
      stageRef.current = null;
    };
  }, [session, store]);

  // Fit the stage into the available space.
  useEffect(() => {
    const host = hostRef.current!;
    const fit = () => {
      const s = Math.min(host.clientWidth / stageWidth, host.clientHeight / stageHeight);
      setScale(Number.isFinite(s) && s > 0 ? s : 1);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(host);
    return () => observer.disconnect();
  }, [stageWidth, stageHeight]);

  const chapterIndex = course.chapters.findIndex((c) => c.id === chapterId);
  const scene = evaluate(course, chapterIndex, playhead);
  const visibleSelected = scene.clips
    .map((a) => a.clip)
    .filter((c): c is VisualClip => c.type !== 'audio' && selection.includes(c.id));

  /** Stage coordinates of a pointer event. */
  const toStage = (clientX: number, clientY: number) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: (clientX - rect.left) / scale, y: (clientY - rect.top) / scale };
  };

  const dragFrame = (event: PointerEvent<HTMLElement>, clip: VisualClip, handle: Handle | null) => {
    event.stopPropagation();
    event.preventDefault();
    const origin = toStage(event.clientX, event.clientY);
    const start: Frame = clip.frame;
    let started = false;
    const move = (e: globalThis.PointerEvent) => {
      const p = toStage(e.clientX, e.clientY);
      const dx = p.x - origin.x;
      const dy = p.y - origin.y;
      if (!started) {
        if (Math.hypot(dx, dy) * scale < 3) return;
        started = true;
        store.getState().begin(handle ? 'Resize' : 'Move');
      }
      const frame: Frame = handle
        ? resizeFrame(start, handle, dx, dy)
        : { ...start, x: Math.round(start.x + dx), y: Math.round(start.y + dy) };
      store
        .getState()
        .preview(updateClip(clip.id, (c) => void (c.type !== 'audio' && (c.frame = frame))));
    };
    const end = (commit: boolean) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', esc);
      if (!started) return;
      if (commit) store.getState().commit();
      else store.getState().cancel();
    };
    const up = () => end(true);
    const esc = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && end(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('keydown', esc);
  };

  const onOverlayPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const p = toStage(event.clientX, event.clientY);
    const s = store.getState();
    const hit = hitTest(
      s.course,
      s.course.chapters.indexOf(selectChapter(s)),
      s.playhead,
      p.x,
      p.y,
    );
    if (!hit) {
      s.select([]);
      return;
    }
    s.select([hit.id]);
    dragFrame(event, hit, null);
  };

  /** Arrow keys nudge the selected clips (Shift: 10 px). */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 10 : 1;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const d = delta[event.key];
    if (!d || visibleSelected.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    store.getState().execute(
      'Nudge',
      (draft) => {
        for (const clip of visibleSelected) {
          updateClip(clip.id, (c) => {
            if (c.type !== 'audio')
              c.frame = { ...c.frame, x: c.frame.x + d[0], y: c.frame.y + d[1] };
          })(draft);
        }
      },
      { mergeKey: `nudge:${visibleSelected.map((c) => c.id).join(',')}` },
    );
  };

  return (
    <div className="stage-host" ref={hostRef}>
      <div
        className="stage-canvas"
        ref={canvasRef}
        style={{
          width: stageWidth,
          height: stageHeight,
          transform: `translate(-50%, -50%) scale(${scale})`,
        }}
      >
        {course.chapters[chapterIndex]?.quiz && (
          <div className="stage-quiz-theme" style={themeVariables(themeOf(course))}>
            <QuizStagePreview course={course} chapter={course.chapters[chapterIndex]!} />
          </div>
        )}
        <div
          className="stage-overlay"
          role="application"
          aria-label={t('stage')}
          tabIndex={0}
          onPointerDown={onOverlayPointerDown}
          onContextMenu={(event) => {
            const s = store.getState();
            const keyboard = event.clientX === 0 && event.clientY === 0;
            let target: string | null = keyboard ? (s.selection[0] ?? null) : null;
            const p = keyboard
              ? { x: stageWidth / 2, y: stageHeight / 2 }
              : toStage(event.clientX, event.clientY);
            if (!keyboard) {
              target =
                hitTest(s.course, s.course.chapters.indexOf(selectChapter(s)), s.playhead, p.x, p.y)
                  ?.id ?? null;
            }
            if (target)
              openContextMenu(event, menuLabel(t('menuClip')), clipMenuItems(session, target));
            else {
              s.select([]);
              openContextMenu(event, menuLabel(t('menuStage')), stageMenuItems(session, p));
            }
          }}
          onKeyDown={onKeyDown}
          data-testid="stage-overlay"
        >
          {visibleSelected.map((clip) => (
            <div
              key={clip.id}
              className="stage-selection"
              data-selection-for={clip.id}
              style={{
                left: clip.frame.x,
                top: clip.frame.y,
                width: clip.frame.width,
                height: clip.frame.height,
                transform: clip.frame.rotation ? `rotate(${clip.frame.rotation}deg)` : undefined,
                ['--inv-scale' as string]: 1 / scale,
              }}
              onPointerDown={(e) => {
                if (e.button === 0) dragFrame(e, clip, null);
              }}
            >
              {(['nw', 'ne', 'sw', 'se'] as const).map((h) => (
                <span
                  key={h}
                  className={`stage-handle stage-handle-${h}`}
                  data-handle={h}
                  onPointerDown={(e) => {
                    if (e.button === 0) dragFrame(e, clip, h);
                  }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
