// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Timeline of the current chapter: ruler, tracks, clips, playhead and the
 * chapter end. Drags run as store transactions, so each drag is one undo
 * step and Escape cancels it.
 */
import {
  addCourseTrack,
  addMarker,
  addTrack,
  pruneCourseLayer,
  removeMarker,
  updateMarker,
  gridStep,
  moveClip,
  moveTrack,
  removeTrack,
  resizeClip,
  selectChapter,
  setChapterProps,
  snapBlock,
  snapPoints,
  snapTime,
  updateTrack,
  type Recipe,
} from '@clipcourse/editor-core';
import type { Clip, Marker, Track } from '@clipcourse/format';
import {
  ArrowDown,
  ArrowUp,
  BookmarkPlus,
  Eye,
  EyeOff,
  Layers,
  Magnet,
  Pause,
  Play,
  Rows3,
  Scissors,
  Trash2,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { addAssetClip, splitSelectionAtPlayhead } from '../actions.js';
import { useEditor, useSession } from '../context.js';
import { clipLabel, displayTracks, formatTimecode, msToPx, pxToMs } from '../geometry.js';
import { t } from '../i18n.js';

export const HEADER_WIDTH = 190;
const EDGE_PX = 7;
const SNAP_PX = 8;
const DRAG_THRESHOLD_PX = 3;
export const ASSET_MIME = 'application/x-clipcourse-asset';

type DragMode = 'move' | 'start' | 'end';

export function Timeline() {
  const session = useSession();
  const { store } = session;
  const chapter = useEditor(selectChapter);
  const course = useEditor((s) => s.course);
  const zoom = useEditor((s) => s.zoom);
  const playhead = useEditor((s) => s.playhead);
  const selection = useEditor((s) => s.selection);
  const snapping = useEditor((s) => s.snapping);
  const playing = useEditor((s) => s.playing);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [snapLine, setSnapLine] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const contentEnd = chapter.tracks.reduce(
    (end, track) => track.clips.reduce((e, c) => Math.max(e, c.start + c.duration), end),
    0,
  );
  const width = msToPx(Math.max(chapter.duration, contentEnd) + 10000, zoom);
  const courseLayer = course.courseLayer;
  const rows: TrackRow[] = [
    ...[...(courseLayer?.foreground ?? [])].reverse().map((track, i, all) => ({
      track,
      scope: 'course' as const,
      index: all.length - 1 - i,
      count: all.length,
    })),
    ...displayTracks(chapter).map((track, displayIndex) => ({
      track,
      scope: 'chapter' as const,
      index: chapter.tracks.length - 1 - displayIndex,
      count: chapter.tracks.length,
    })),
    ...[...(courseLayer?.background ?? [])].reverse().map((track, i, all) => ({
      track,
      scope: 'course' as const,
      index: all.length - 1 - i,
      count: all.length,
    })),
  ];
  const visibleEndMs = pxToMs(width, zoom);
  const step = gridStep(zoom);

  // Keep the playhead in view while playing.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !playing) return;
    const x = msToPx(playhead, zoom);
    const visible = el.clientWidth - HEADER_WIDTH;
    if (x < el.scrollLeft || x > el.scrollLeft + visible - 40) el.scrollLeft = Math.max(0, x - 40);
  }, [playhead, playing, zoom]);

  /** Converts a client x coordinate to chapter time. */
  const timeAt = (clientX: number) => {
    const el = scrollRef.current!;
    const rect = el.getBoundingClientRect();
    return Math.max(0, pxToMs(clientX - rect.left - HEADER_WIDTH + el.scrollLeft, zoom));
  };

  /** The track under the pointer, if it is in the given scope. */
  const trackAt = (clientX: number, clientY: number, scope: TrackRow['scope']): string | null => {
    for (const el of document.elementsFromPoint(clientX, clientY)) {
      const data = (el as HTMLElement).dataset;
      if (data?.laneTrackId) return data.laneScope === scope ? data.laneTrackId : null;
    }
    return null;
  };

  // --- Scrubbing ---------------------------------------------------------------
  const startScrub = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    store.getState().setPlayhead(timeAt(event.clientX));
    const move = (e: globalThis.PointerEvent) => store.getState().setPlayhead(timeAt(e.clientX));
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  const onLanePointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return;
    store.getState().select([]);
    startScrub(event);
  };

  // --- Clip drags --------------------------------------------------------------
  const onClipPointerDown = (
    event: PointerEvent<HTMLElement>,
    clip: Clip,
    scope: TrackRow['scope'],
  ) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const state = store.getState();
    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      const has = state.selection.includes(clip.id);
      state.select(
        has ? state.selection.filter((id) => id !== clip.id) : [...state.selection, clip.id],
      );
      return;
    }
    state.select([clip.id]);

    const el = event.currentTarget;
    const rect = el.getBoundingClientRect();
    const offset = event.clientX - rect.left;
    const mode: DragMode =
      offset < EDGE_PX ? 'start' : offset > rect.width - EDGE_PX ? 'end' : 'move';
    const originX = event.clientX;
    const originY = event.clientY;
    const label = mode === 'move' ? 'Move clip' : 'Trim clip';
    let started = false;
    // Listen on window: the clip element re-mounts when it moves to another track.

    const points = snapPoints(selectChapter(state), state.playhead, new Set([clip.id]));
    const threshold = pxToMs(SNAP_PX, zoom);

    const move = (e: globalThis.PointerEvent) => {
      const dx = e.clientX - originX;
      if (!started) {
        if (Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(e.clientY - originY) < DRAG_THRESHOLD_PX)
          return;
        started = true;
        store.getState().begin(label);
      }
      const delta = pxToMs(dx, zoom);
      const snap = store.getState().snapping && !e.altKey;
      if (mode === 'move') {
        let start = Math.max(0, clip.start + delta);
        let target: number | null = null;
        if (snap) ({ time: start, target } = snapBlock(start, clip.duration, points, threshold));
        const trackId = trackAt(e.clientX, e.clientY, scope) ?? undefined;
        store.getState().preview(moveClip(clip.id, start, trackId));
        setSnapLine(target);
      } else {
        const edgeTime = mode === 'start' ? clip.start : clip.start + clip.duration;
        let time = Math.max(0, edgeTime + delta);
        let target: number | null = null;
        if (snap) ({ time, target } = snapTime(time, points, threshold));
        store.getState().preview(resizeClip(clip.id, mode, time));
        setSnapLine(target);
      }
    };
    const finish = (commit: boolean) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', escape);
      setSnapLine(null);
      if (!started) return;
      if (commit) store.getState().commit();
      else store.getState().cancel();
    };
    const up = () => finish(true);
    const cancel = () => finish(false);
    const escape = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', escape);
  };

  /** Keyboard alternative to dragging: arrows move, Alt+arrows trim the end. */
  const onClipKeyDown = (event: KeyboardEvent<HTMLElement>, clip: Clip) => {
    const stepMs = event.shiftKey ? 1000 : 100;
    const dir = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      store.getState().select([clip.id]);
      return;
    }
    if (!dir) return;
    event.preventDefault();
    event.stopPropagation();
    store.getState().select([clip.id]);
    if (event.altKey) {
      store
        .getState()
        .execute(
          'Trim clip',
          resizeClip(clip.id, 'end', clip.start + clip.duration + dir * stepMs),
          {
            mergeKey: `trim:${clip.id}`,
          },
        );
    } else {
      store
        .getState()
        .execute('Move clip', moveClip(clip.id, Math.max(0, clip.start + dir * stepMs)), {
          mergeKey: `move:${clip.id}`,
        });
    }
  };

  // --- Chapter end -------------------------------------------------------------
  const onEndPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const el = event.currentTarget;
    el.setPointerCapture(event.pointerId);
    const state = store.getState();
    const points = snapPoints(selectChapter(state), state.playhead);
    const threshold = pxToMs(SNAP_PX, zoom);
    store.getState().begin('Change chapter length');
    const move = (e: globalThis.PointerEvent) => {
      let time = Math.max(100, timeAt(e.clientX));
      if (store.getState().snapping && !e.altKey) time = snapTime(time, points, threshold).time;
      store.getState().preview(setChapterProps(chapter.id, { duration: time }));
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      store.getState().commit();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  // --- Drop assets -------------------------------------------------------------
  const onDragOver = (event: React.DragEvent<HTMLElement>, trackId: string) => {
    if (!event.dataTransfer.types.includes(ASSET_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setDropTarget(trackId);
  };
  const onDrop = (event: React.DragEvent<HTMLElement>, trackId: string) => {
    const assetId = event.dataTransfer.getData(ASSET_MIME);
    setDropTarget(null);
    if (!assetId) return;
    event.preventDefault();
    addAssetClip(session, assetId, trackId, timeAt(event.clientX));
  };

  // --- Zoom with Ctrl+wheel ------------------------------------------------------
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const state = store.getState();
      const rect = el.getBoundingClientRect();
      const pointerX = e.clientX - rect.left - HEADER_WIDTH;
      const timeUnderPointer = pxToMs(pointerX + el.scrollLeft, state.zoom);
      const next = state.zoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2);
      state.setZoom(next);
      el.scrollLeft = Math.max(0, msToPx(timeUnderPointer, store.getState().zoom) - pointerX);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [store]);

  const addTrackOnTop = () => {
    const id = session.newId('track');
    store
      .getState()
      .execute(
        'Add track',
        addTrack(chapter.id, { id, name: `Track ${chapter.tracks.length + 1}` }),
      );
  };

  const ticks: number[] = [];
  for (let ms = 0; msToPx(ms, zoom) <= width; ms += step) ticks.push(ms);

  return (
    <section className="timeline" aria-label={t('timeline')}>
      <div className="tl-toolbar">
        <TransportButton />
        <span className="tl-timecode" aria-live="off">
          {formatTimecode(playhead)} / {formatTimecode(chapter.duration)}
        </span>
        <button
          type="button"
          onClick={() => splitSelectionAtPlayhead(session)}
          disabled={selection.length === 0}
          className="icon-button"
        >
          <Scissors size={15} aria-hidden /> {t('split')}
        </button>
        <button type="button" onClick={addTrackOnTop} className="icon-button">
          <Rows3 size={15} aria-hidden /> {t('addTrack')}
        </button>
        <button
          type="button"
          onClick={() =>
            store.getState().execute(
              'Add track for all chapters',
              addCourseTrack('foreground', {
                id: session.newId('track'),
                name: t('allChapters'),
              }),
            )
          }
          className="icon-button"
        >
          <Layers size={15} aria-hidden /> {t('addCourseTrack')}
        </button>
        <button
          type="button"
          onClick={() => {
            const id = session.newId('marker');
            const n = (chapter.markers?.length ?? 0) + 1;
            store
              .getState()
              .execute(
                'Add marker',
                addMarker(chapter.id, { id, time: playhead, title: `${t('marker')} ${n}` }),
              );
          }}
          className="icon-button"
        >
          <BookmarkPlus size={15} aria-hidden /> {t('addMarker')}
        </button>
        <label className="tl-check">
          <input
            type="checkbox"
            checked={snapping}
            onChange={(e) => store.getState().setSnapping(e.target.checked)}
          />
          <Magnet size={15} aria-hidden />
          {t('snapping')}
        </label>
        <label className="tl-zoom">
          <ZoomOut size={15} aria-hidden />
          <span className="sr-only">{t('zoom')}</span>
          <input
            type="range"
            min={Math.log(5)}
            max={Math.log(1000)}
            step={0.01}
            value={Math.log(zoom)}
            onChange={(e) => store.getState().setZoom(Math.exp(Number(e.target.value)))}
          />
          <ZoomIn size={15} aria-hidden />
        </label>
      </div>

      <div
        className="tl-scroll"
        ref={scrollRef}
        style={{ ['--header-width' as string]: `${HEADER_WIDTH}px` }}
      >
        <div className="tl-content" style={{ width: width + HEADER_WIDTH }}>
          <div className="tl-row tl-ruler-row">
            <div className="tl-header tl-corner" />
            <div className="tl-ruler" onPointerDown={startScrub} data-testid="ruler">
              {ticks.map((ms) => (
                <span key={ms} className="tl-tick" style={{ left: msToPx(ms, zoom) }}>
                  {formatTimecode(ms).replace(/\.0$/, '')}
                </span>
              ))}
              {(chapter.markers ?? []).map((marker) => (
                <MarkerFlag
                  key={marker.id}
                  marker={marker}
                  chapterId={chapter.id}
                  timeAt={timeAt}
                />
              ))}
            </div>
          </div>

          {rows.map(({ track, scope, index, count }) => (
            <div className={`tl-row${scope === 'course' ? ' is-course' : ''}`} key={track.id}>
              <TrackHeader track={track} index={index} count={count} scope={scope} />
              <div
                className={`tl-lane${dropTarget === track.id ? ' is-drop' : ''}${track.hidden ? ' is-hidden' : ''}`}
                data-lane-track-id={track.id}
                data-lane-scope={scope}
                onPointerDown={onLanePointerDown}
                onDragOver={(e) => onDragOver(e, track.id)}
                onDragLeave={() => setDropTarget(null)}
                onDrop={(e) => onDrop(e, track.id)}
              >
                {track.clips.map((clip) => {
                  const end = Math.min(clip.start + clip.duration, visibleEndMs);
                  return (
                    <div
                      key={clip.id}
                      role="button"
                      tabIndex={0}
                      className={`tl-clip tl-clip-${clip.type}${selection.includes(clip.id) ? ' is-selected' : ''}${end < clip.start + clip.duration ? ' is-open-ended' : ''}`}
                      style={{
                        left: msToPx(clip.start, zoom),
                        width: Math.max(4, msToPx(end - clip.start, zoom)),
                      }}
                      data-clip-id={clip.id}
                      aria-pressed={selection.includes(clip.id)}
                      aria-label={`${clipLabel(clip, course)}, ${formatTimecode(clip.start)} – ${formatTimecode(clip.start + clip.duration)}${scope === 'course' ? `, ${t('allChapters')}` : ''}`}
                      title={clipLabel(clip, course)}
                      onPointerDown={(e) => onClipPointerDown(e, clip, scope)}
                      onKeyDown={(e) => onClipKeyDown(e, clip)}
                    >
                      <span className="tl-clip-handle tl-clip-handle-start" aria-hidden="true" />
                      <span className="tl-clip-label">{clipLabel(clip, course)}</span>
                      <span className="tl-clip-handle tl-clip-handle-end" aria-hidden="true" />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="tl-overlay" style={{ left: HEADER_WIDTH }}>
            <div className="tl-after-end" style={{ left: msToPx(chapter.duration, zoom) }} />
            <div
              className="tl-end-handle"
              style={{ left: msToPx(chapter.duration, zoom) }}
              onPointerDown={onEndPointerDown}
              title={t('chapterEnd')}
              aria-label={t('chapterEnd')}
              data-testid="chapter-end"
            />
            {snapLine !== null && (
              <div className="tl-snap-line" style={{ left: msToPx(snapLine, zoom) }} />
            )}
            <div
              className="tl-playhead"
              style={{ left: msToPx(playhead, zoom) }}
              data-testid="playhead"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function TransportButton() {
  const { store } = useSession();
  const playing = useEditor((s) => s.playing);
  return (
    <button
      type="button"
      className="tl-play"
      aria-label={playing ? t('pause') : t('play')}
      title={`${playing ? t('pause') : t('play')} (Space)`}
      onClick={() => {
        const s = store.getState();
        const chapter = selectChapter(s);
        if (!s.playing && s.playhead >= chapter.duration) s.setPlayhead(0);
        s.setPlaying(!s.playing);
      }}
    >
      {playing ? <Pause size={16} aria-hidden /> : <Play size={16} aria-hidden />}
    </button>
  );
}

interface TrackRow {
  track: Track;
  scope: 'chapter' | 'course';
  index: number;
  count: number;
}

function TrackHeader({ track, index, count, scope }: Omit<TrackRow, 'track'> & { track: Track }) {
  const { store } = useSession();
  const [editing, setEditing] = useState(false);
  const name = track.name ?? 'Track';
  const exec = (label: string, recipe: Recipe) => store.getState().execute(label, recipe);

  return (
    <div className="tl-header">
      {editing ? (
        <input
          className="tl-track-name-input"
          aria-label={t('trackName')}
          defaultValue={name}
          autoFocus
          onBlur={(e) => {
            setEditing(false);
            const value = e.target.value.trim();
            if (value && value !== name)
              exec('Rename track', updateTrack(track.id, { name: value }));
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setEditing(false);
          }}
        />
      ) : (
        <button
          type="button"
          className="tl-track-name"
          onDoubleClick={() => setEditing(true)}
          title={t('trackName')}
        >
          {name}
        </button>
      )}
      {scope === 'course' && (
        <span className="tl-badge" title={t('allChapters')} aria-label={t('allChapters')}>
          <Layers size={12} aria-hidden />
        </span>
      )}
      <div className="tl-track-buttons">
        <button
          type="button"
          aria-pressed={!!track.hidden}
          aria-label={track.hidden ? t('showTrack') : t('hideTrack')}
          title={track.hidden ? t('showTrack') : t('hideTrack')}
          onClick={() =>
            exec('Toggle visibility', updateTrack(track.id, { hidden: !track.hidden }))
          }
        >
          {track.hidden ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
        </button>
        <button
          type="button"
          aria-pressed={!!track.muted}
          aria-label={track.muted ? t('unmuteTrack') : t('muteTrack')}
          title={track.muted ? t('unmuteTrack') : t('muteTrack')}
          onClick={() => exec('Toggle mute', updateTrack(track.id, { muted: !track.muted }))}
        >
          {track.muted ? <VolumeX size={14} aria-hidden /> : <Volume2 size={14} aria-hidden />}
        </button>
        <button
          type="button"
          aria-label={t('moveTrackUp')}
          title={t('moveTrackUp')}
          disabled={index >= count - 1}
          onClick={() => exec('Move track', moveTrack(track.id, index + 1))}
        >
          <ArrowUp size={14} aria-hidden />
        </button>
        <button
          type="button"
          aria-label={t('moveTrackDown')}
          title={t('moveTrackDown')}
          disabled={index <= 0}
          onClick={() => exec('Move track', moveTrack(track.id, index - 1))}
        >
          <ArrowDown size={14} aria-hidden />
        </button>
        <button
          type="button"
          aria-label={t('deleteTrack')}
          title={t('deleteTrack')}
          disabled={scope === 'chapter' && count <= 1}
          onClick={() =>
            exec('Delete track', (draft) => {
              removeTrack(track.id)(draft);
              pruneCourseLayer()(draft);
            })
          }
        >
          <Trash2 size={14} aria-hidden />
        </button>
      </div>
    </div>
  );
}

/** A marker flag on the ruler: drag to move, double-click to rename, Delete to remove. */
function MarkerFlag({
  marker,
  chapterId,
  timeAt,
}: {
  marker: Marker;
  chapterId: string;
  timeAt: (clientX: number) => number;
}) {
  const { store } = useSession();
  const zoom = useEditor((s) => s.zoom);

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const originX = event.clientX;
    let started = false;
    const move = (e: globalThis.PointerEvent) => {
      if (!started) {
        if (Math.abs(e.clientX - originX) < DRAG_THRESHOLD_PX) return;
        started = true;
        store.getState().begin('Move marker');
      }
      store.getState().preview(updateMarker(chapterId, marker.id, { time: timeAt(e.clientX) }));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (started) store.getState().commit();
      else store.getState().setPlayhead(marker.time);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const rename = () => {
    const title = window.prompt(t('markerTitle'), marker.title)?.trim();
    if (title)
      store.getState().execute('Rename marker', updateMarker(chapterId, marker.id, { title }));
  };

  return (
    <button
      type="button"
      className="tl-marker"
      style={{ left: msToPx(marker.time, zoom) }}
      title={`${marker.title} (${formatTimecode(marker.time)})`}
      aria-label={`${t('marker')}: ${marker.title}, ${formatTimecode(marker.time)}`}
      data-marker-id={marker.id}
      onPointerDown={onPointerDown}
      onDoubleClick={rename}
      onKeyDown={(e) => {
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          e.stopPropagation();
          store.getState().execute('Delete marker', removeMarker(chapterId, marker.id));
        } else if (e.key === 'Enter' || e.key === 'F2') {
          e.preventDefault();
          rename();
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          e.stopPropagation();
          const step = (e.shiftKey ? 1000 : 100) * (e.key === 'ArrowLeft' ? -1 : 1);
          store
            .getState()
            .execute(
              'Move marker',
              updateMarker(chapterId, marker.id, { time: marker.time + step }),
              {
                mergeKey: `marker:${marker.id}`,
              },
            );
        }
      }}
    >
      <span className="tl-marker-label">{marker.title}</span>
    </button>
  );
}
