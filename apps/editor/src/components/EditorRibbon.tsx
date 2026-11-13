// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The editor's ribbon: quick access bar plus the File, Home, Insert,
 * Chapter and View tabs, and a contextual tab for the selected clip.
 */
import {
  addCourseTrack,
  addMarker,
  addTrack,
  builtInTemplates,
  createEmptyCourse,
  duplicateChapter,
  findClip,
  fitChapterToContent,
  QUESTION_KINDS,
  setQuiz,
  createQuestion,
  moveChapter,
  ProjectError,
  removeChapter,
  selectCanRedo,
  selectCanUndo,
  selectChapter,
  selectDirty,
  setChapterProps,
  updateClip,
  type ChapterTemplate,
  type Project,
} from '@clipcourse/editor-core';
import type { AnimationType, Clip } from '@clipcourse/format';
import {
  AArrowDown,
  AArrowUp,
  AlignCenter,
  AlignHorizontalJustifyCenter,
  AlignLeft,
  AlignRight,
  AlignVerticalJustifyCenter,
  ArrowDown,
  ArrowRightToLine,
  ArrowUp,
  Bold,
  BookmarkPlus,
  BookOpen,
  Bot,
  BringToFront,
  ChartBarStacked,
  Copy,
  CopyPlus,
  FilePlus,
  FolderOpen,
  Highlighter,
  CircleHelp,
  MousePointerClick,
  ListChecks,
  ImagePlus,
  Layers,
  LayoutTemplate,
  Magnet,
  Maximize2,
  MonitorPlay,
  PackageOpen,
  PaintBucket,
  Palette,
  PanelLeft,
  PanelRight,
  Pause,
  Pen,
  Play,
  Redo2,
  Rows3,
  Save,
  Scissors,
  SendToBack,
  Shapes,
  Sparkles,
  Square,
  Timer,
  Trash2,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  addClipAt,
  addProgressBar,
  addQuizChapter,
  arrangeClip,
  centerClip,
  deleteSelection,
  duplicateSelection,
  editTextStyle,
  insertTemplate,
  saveChapterAsTemplate,
  setClipAnimation,
  splitSelectionAtPlayhead,
} from '../actions.js';
import { useEditor, useSession } from '../context.js';
import { loadExample } from '../examples.js';
import { t, type MessageKey } from '../i18n.js';
import { probeMediaDuration } from '../session.js';
import { KIND_LABEL } from './QuestionEditor.js';
import {
  Ribbon,
  RibbonButton,
  RibbonColor,
  RibbonGroup,
  RibbonMenu,
  RibbonStack,
  type RibbonTab,
} from './ribbon/Ribbon.js';

export interface RibbonActions {
  onPreview: () => void;
  onExport: () => void;
  onAi: () => void;
  onMessage: (message: string) => void;
  panels: { sidebar: boolean; inspector: boolean };
  onTogglePanel: (panel: 'sidebar' | 'inspector') => void;
}

const TYPE_LABEL: Record<Clip['type'], MessageKey> = {
  text: 'clipLabelText',
  box: 'clipLabelBox',
  shape: 'clipLabelShape',
  image: 'clipLabelImage',
  video: 'clipLabelVideo',
  audio: 'clipLabelAudio',
  highlight: 'clipLabelHighlight',
  progress: 'clipLabelProgress',
  question: 'clipLabelQuestion',
  button: 'clipLabelButton',
};

const COLLAPSED_KEY = 'clipcourse:ribbon-collapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

/** File commands shared by the quick access bar and the File tab. */
function useProjectCommands(onMessage: (message: string) => void) {
  const session = useSession();
  const { store, storage } = session;
  const dirty = useEditor(selectDirty);
  const title = useEditor((s) => s.course.title);
  const confirmDiscard = () => !dirty || window.confirm(t('confirmDiscard'));

  return {
    newProject() {
      if (confirmDiscard())
        session.load({ course: createEmptyCourse((p) => session.newId(p)), files: new Map() });
    },
    async open() {
      if (!confirmDiscard()) return;
      try {
        const project: Project | null = await storage.openProject();
        if (project) session.load(project);
      } catch (error) {
        const details =
          error instanceof ProjectError && error.issues.length
            ? '\n' +
              error.issues
                .slice(0, 5)
                .map((i) => `${i.path}: ${i.message}`)
                .join('\n')
            : '';
        onMessage(
          `${t('openFailed')} ${error instanceof Error ? error.message : String(error)}${details}`,
        );
      }
    },
    async openExample() {
      if (!confirmDiscard()) return;
      try {
        session.load(await loadExample('welcome'));
      } catch (error) {
        onMessage(`${t('openFailed')} ${String(error)}`);
      }
    },
    async save() {
      const name =
        title
          .trim()
          .replace(/[^\p{L}\p{N}_-]+/gu, '-')
          .replace(/^-|-$/g, '') || 'course';
      await storage.saveProject(session.project, name);
      store.getState().markSaved();
    },
    async importMedia() {
      const files = await storage.pickFiles('image/*,video/*,audio/*,.vtt,text/vtt');
      const result = await session.importFiles(files, probeMediaDuration);
      if (result.errors.length) onMessage(`${t('importFailed')} ${result.errors.join('; ')}`);
    },
  };
}

/** Save, undo, redo, course title, AI assistant and preview: always visible. */
export function QuickAccessBar({
  onPreview,
  onAi,
  onMessage,
}: Pick<RibbonActions, 'onPreview' | 'onAi' | 'onMessage'>) {
  const { store } = useSession();
  const canUndo = useEditor(selectCanUndo);
  const canRedo = useEditor(selectCanRedo);
  const dirty = useEditor(selectDirty);
  const title = useEditor((s) => s.course.title);
  const commands = useProjectCommands(onMessage);
  return (
    <header className="quick-access">
      <span className="brand">
        <Sparkles size={16} aria-hidden /> {t('appName')}
      </span>
      <div className="quick-access-buttons" role="group" aria-label={t('quickAccess')}>
        <RibbonButton
          size="icon"
          icon={Save}
          label={t('save')}
          hint={`${t('save')}${dirty ? ` – ${t('unsaved')}` : ''}`}
          onClick={() => void commands.save()}
        />
        <RibbonButton
          size="icon"
          icon={Undo2}
          label={t('undo')}
          hint={`${t('undo')} (Ctrl+Z)`}
          disabled={!canUndo}
          onClick={() => store.getState().undo()}
        />
        <RibbonButton
          size="icon"
          icon={Redo2}
          label={t('redo')}
          hint={`${t('redo')} (Ctrl+Shift+Z)`}
          disabled={!canRedo}
          onClick={() => store.getState().redo()}
        />
      </div>
      <span className="doc-title" title={title}>
        {title}
        {dirty && <span className="dirty-dot" aria-label={t('unsaved')} />}
      </span>
      <div className="quick-access-end">
        <RibbonButton size="small" icon={Bot} label={t('aiAssistant')} onClick={onAi} />
        <RibbonButton
          size="small"
          icon={MonitorPlay}
          label={t('preview')}
          onClick={onPreview}
          primary
        />
      </div>
    </header>
  );
}

export function EditorRibbon(props: RibbonActions) {
  const session = useSession();
  const { store, storage } = session;
  const course = useEditor((s) => s.course);
  const chapter = useEditor(selectChapter);
  const selection = useEditor((s) => s.selection);
  const playing = useEditor((s) => s.playing);
  const snapping = useEditor((s) => s.snapping);
  const commands = useProjectCommands(props.onMessage);
  const [active, setActive] = useState('home');
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [userTemplates, setUserTemplates] = useState<ChapterTemplate[]>([]);

  useEffect(() => {
    void storage.listTemplates().then(setUserTemplates);
  }, [storage, active]);

  const selected = selection.length === 1 ? (findClip(course, selection[0]!)?.clip ?? null) : null;
  const chapterIndex = course.chapters.indexOf(chapter);
  const exec = store.getState().execute;

  // Leave a contextual tab that no longer applies.
  useEffect(() => {
    if (active === 'clip' && !selected) setActive('home');
  }, [active, selected]);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, c ? '0' : '1');
      } catch {
        // per-browser convenience only
      }
      return !c;
    });
  };

  const templateItems = [
    ...builtInTemplates(course).map((template) => ({
      label: template.name,
      onSelect: () => insertTemplate(session, template),
    })),
    ...userTemplates.map((template, i) => ({
      label: template.name,
      onSelect: () => insertTemplate(session, template),
      separatorBefore: i === 0,
    })),
  ];

  const firstImage = Object.entries(course.assets).find(([, a]) => a.kind === 'image')?.[0];
  const questionItems = QUESTION_KINDS.map((kind) => ({
    label: t(KIND_LABEL[kind]),
    disabled: kind === 'hotspot' && !firstImage,
    ...(kind === 'hotspot' && !firstImage ? { hint: t('hotspotNeedsImage') } : {}),
    onSelect: () =>
      addClipAt(session, 'question', {
        questionKind: kind,
        ...(kind === 'hotspot' && firstImage ? { assetId: firstImage } : {}),
      }),
  }));

  const insertGroup = (
    <RibbonGroup label={t('groupInsert')}>
      <RibbonButton icon={Type} label={t('addText')} onClick={() => addClipAt(session, 'text')} />
      <RibbonButton icon={Square} label={t('addBox')} onClick={() => addClipAt(session, 'box')} />
      <RibbonButton
        icon={Shapes}
        label={t('addShape')}
        onClick={() => addClipAt(session, 'shape')}
      />
      <RibbonButton
        icon={Highlighter}
        label={t('addHighlight')}
        onClick={() => addClipAt(session, 'highlight')}
      />
      <RibbonMenu icon={CircleHelp} label={t('insertQuestion')} items={questionItems} />
      <RibbonButton
        icon={MousePointerClick}
        label={t('addButton')}
        onClick={() => addClipAt(session, 'button')}
      />
    </RibbonGroup>
  );

  const editGroup = (
    <RibbonGroup label={t('groupEdit')}>
      <RibbonButton
        icon={Scissors}
        label={t('split')}
        hint={`${t('split')} (S)`}
        disabled={selection.length === 0}
        onClick={() => splitSelectionAtPlayhead(session)}
      />
      <RibbonStack>
        <RibbonButton
          size="small"
          icon={Copy}
          label={t('duplicate')}
          hint={`${t('duplicate')} (Ctrl+D)`}
          disabled={selection.length === 0}
          onClick={() => duplicateSelection(session)}
        />
        <RibbonButton
          size="small"
          icon={Trash2}
          label={t('delete')}
          hint={`${t('delete')} (Del)`}
          disabled={selection.length === 0}
          onClick={() => deleteSelection(session)}
        />
      </RibbonStack>
    </RibbonGroup>
  );

  const tabs: RibbonTab[] = [
    {
      id: 'file',
      label: t('tabFile'),
      content: (
        <>
          <RibbonGroup label={t('groupProject')}>
            <RibbonButton icon={FilePlus} label={t('new')} onClick={commands.newProject} />
            <RibbonButton
              icon={FolderOpen}
              label={t('open')}
              onClick={() => void commands.open()}
            />
            <RibbonButton
              icon={BookOpen}
              label={t('openExample')}
              onClick={() => void commands.openExample()}
            />
            <RibbonButton icon={Save} label={t('save')} onClick={() => void commands.save()} />
          </RibbonGroup>
          <RibbonGroup label={t('groupShare')}>
            <RibbonButton icon={PackageOpen} label={t('exportShort')} onClick={props.onExport} />
            <RibbonButton icon={Bot} label={t('aiAssistant')} onClick={props.onAi} />
          </RibbonGroup>
        </>
      ),
    },
    {
      id: 'home',
      label: t('tabHome'),
      content: (
        <>
          {insertGroup}
          <RibbonGroup label={t('groupMedia')}>
            <RibbonButton
              icon={ImagePlus}
              label={t('mediaShort')}
              hint={t('importMedia')}
              onClick={() => void commands.importMedia()}
            />
          </RibbonGroup>
          {editGroup}
          <RibbonGroup label={t('groupPlayback')}>
            <RibbonButton
              icon={playing ? Pause : Play}
              label={playing ? t('pause') : t('play')}
              hint={`${t('playPause')} (Space)`}
              onClick={() => {
                const s = store.getState();
                if (!s.playing && s.playhead >= selectChapter(s).duration) s.setPlayhead(0);
                s.setPlaying(!s.playing);
              }}
            />
          </RibbonGroup>
        </>
      ),
    },
    {
      id: 'insert',
      label: t('tabInsert'),
      content: (
        <>
          {insertGroup}
          <RibbonGroup label={t('groupMedia')}>
            <RibbonButton
              icon={ImagePlus}
              label={t('mediaShort')}
              hint={t('importMedia')}
              onClick={() => void commands.importMedia()}
            />
          </RibbonGroup>
          <RibbonGroup label={t('groupTimeline')}>
            <RibbonButton
              icon={Rows3}
              label={t('trackShort')}
              onClick={() =>
                exec(
                  'Add track',
                  addTrack(chapter.id, {
                    id: session.newId('track'),
                    name: `Track ${chapter.tracks.length + 1}`,
                  }),
                )
              }
            />
            <RibbonButton
              icon={BookmarkPlus}
              label={t('markerShort')}
              onClick={() =>
                exec(
                  'Add marker',
                  addMarker(chapter.id, {
                    id: session.newId('marker'),
                    time: store.getState().playhead,
                    title: `${t('marker')} ${(chapter.markers?.length ?? 0) + 1}`,
                  }),
                )
              }
            />
          </RibbonGroup>
          <RibbonGroup label={t('groupCourseLayer')}>
            <RibbonButton
              icon={Layers}
              label={t('courseTrackShort')}
              onClick={() =>
                exec(
                  'Add track for all chapters',
                  addCourseTrack('foreground', {
                    id: session.newId('track'),
                    name: t('allChapters'),
                  }),
                )
              }
            />
            <RibbonButton
              icon={ChartBarStacked}
              label={t('addProgress')}
              onClick={() => addProgressBar(session)}
            />
          </RibbonGroup>
          <RibbonGroup label={t('groupChapters')}>
            <RibbonMenu icon={LayoutTemplate} label={t('newChapter')} items={templateItems} />
            <RibbonButton
              icon={ListChecks}
              label={t('quizChapter')}
              onClick={() => addQuizChapter(session)}
            />
          </RibbonGroup>
        </>
      ),
    },
    {
      id: 'chapter',
      label: t('tabChapter'),
      content: (
        <>
          <RibbonGroup label={t('groupChapters')}>
            <RibbonMenu icon={LayoutTemplate} label={t('newChapter')} items={templateItems} />
            <RibbonButton
              icon={ListChecks}
              label={chapter.quiz ? t('removeQuiz') : t('makeQuiz')}
              hint={chapter.quiz ? t('removeQuiz') : t('makeQuiz')}
              onClick={() =>
                exec(
                  chapter.quiz ? 'Remove quiz' : 'Make quiz chapter',
                  setQuiz(
                    chapter.id,
                    chapter.quiz
                      ? null
                      : { questions: [createQuestion('single', session.newId('question'))] },
                  ),
                )
              }
            />
            <RibbonButton
              icon={CopyPlus}
              label={t('duplicate')}
              onClick={() => {
                let created = '';
                exec(
                  'Duplicate chapter',
                  duplicateChapter(
                    chapter.id,
                    (p) => session.newId(p),
                    (id) => (created = id),
                  ),
                );
                if (created) store.getState().setChapter(created);
              }}
            />
            <RibbonStack>
              <RibbonButton
                size="small"
                icon={ArrowUp}
                label={t('moveUp')}
                disabled={chapterIndex === 0}
                onClick={() => exec('Move chapter', moveChapter(chapter.id, chapterIndex - 1))}
              />
              <RibbonButton
                size="small"
                icon={ArrowDown}
                label={t('moveDown')}
                disabled={chapterIndex === course.chapters.length - 1}
                onClick={() => exec('Move chapter', moveChapter(chapter.id, chapterIndex + 1))}
              />
              <RibbonButton
                size="small"
                icon={Trash2}
                label={t('deleteChapter')}
                disabled={course.chapters.length <= 1}
                onClick={() => {
                  if (!window.confirm(t('confirmDeleteChapter', { title: chapter.title }))) return;
                  const next =
                    course.chapters[chapterIndex + 1] ?? course.chapters[chapterIndex - 1]!;
                  store.getState().setChapter(next.id);
                  session.run('Delete chapter', removeChapter(chapter.id));
                }}
              />
            </RibbonStack>
          </RibbonGroup>
          <RibbonGroup label={t('groupAtEnd')}>
            <RibbonButton
              icon={Pen}
              label={t('waitForContinue')}
              pressed={chapter.transition.mode === 'wait'}
              onClick={() =>
                exec(
                  'Change transition',
                  setChapterProps(chapter.id, { transition: { mode: 'wait' } }),
                )
              }
            />
            <RibbonButton
              icon={ArrowRightToLine}
              label={t('continueAuto')}
              pressed={chapter.transition.mode === 'auto'}
              onClick={() =>
                exec(
                  'Change transition',
                  setChapterProps(chapter.id, { transition: { mode: 'auto' } }),
                )
              }
            />
          </RibbonGroup>
          <RibbonGroup label={t('groupLength')}>
            <RibbonButton
              icon={Timer}
              label={t('fitToContent')}
              onClick={() => exec('Fit chapter', fitChapterToContent(chapter.id))}
            />
          </RibbonGroup>
          <RibbonGroup label={t('groupTemplates')}>
            <RibbonButton
              icon={LayoutTemplate}
              label={t('saveAsTemplate')}
              onClick={async () => {
                const name = window.prompt(t('templateName'), chapter.title)?.trim();
                if (!name) return;
                await saveChapterAsTemplate(session, chapter.id, name);
                setUserTemplates(await storage.listTemplates());
                props.onMessage(t('templateSaved', { name }));
              }}
            />
          </RibbonGroup>
        </>
      ),
    },
    {
      id: 'view',
      label: t('tabView'),
      content: (
        <>
          <RibbonGroup label={t('groupZoom')}>
            <RibbonButton
              icon={ZoomIn}
              label={t('zoomIn')}
              onClick={() => store.getState().setZoom(store.getState().zoom * 1.25)}
            />
            <RibbonButton
              icon={ZoomOut}
              label={t('zoomOut')}
              onClick={() => store.getState().setZoom(store.getState().zoom / 1.25)}
            />
            <RibbonButton
              icon={Maximize2}
              label={t('zoomFit')}
              onClick={() => {
                const lane = document.querySelector<HTMLElement>('.tl-scroll');
                const width = (lane?.clientWidth ?? 1000) - 220;
                store.getState().setZoom(Math.max(5, width / (chapter.duration / 1000)));
              }}
            />
            <RibbonButton
              icon={Magnet}
              label={t('snapping')}
              pressed={snapping}
              onClick={() => store.getState().setSnapping(!snapping)}
            />
          </RibbonGroup>
          <RibbonGroup label={t('groupPanels')}>
            <RibbonButton
              icon={PanelLeft}
              label={t('panelSidebar')}
              pressed={props.panels.sidebar}
              onClick={() => props.onTogglePanel('sidebar')}
            />
            <RibbonButton
              icon={PanelRight}
              label={t('panelProperties')}
              pressed={props.panels.inspector}
              onClick={() => props.onTogglePanel('inspector')}
            />
          </RibbonGroup>
        </>
      ),
    },
  ];

  if (selected) {
    tabs.push({
      id: 'clip',
      label: t('tabTools', { type: t(TYPE_LABEL[selected.type]) }),
      contextual: true,
      content: <ClipTools clip={selected} />,
    });
  }

  return (
    <Ribbon
      tabs={tabs}
      active={active}
      onActivate={setActive}
      collapsed={collapsed}
      onToggleCollapsed={toggleCollapsed}
    />
  );
}

/** Contextual tab: quick formatting for the selected clip. */
function ClipTools({ clip }: { clip: Clip }) {
  const session = useSession();
  const { store } = session;
  const hasText = clip.type === 'text' || clip.type === 'box';
  const visual = clip.type !== 'audio';
  const style = hasText ? (clip.style ?? {}) : {};

  const animationMenu = (phase: 'in' | 'out') => {
    if (!visual) return null;
    const current = clip.animations?.[phase]?.type ?? null;
    const choices: [AnimationType | null, MessageKey][] = [
      [null, 'animationNone'],
      ['fade', 'animationFade'],
      ['slide', 'animationSlide'],
      ['zoom', 'animationZoom'],
    ];
    return (
      <RibbonMenu
        icon={Sparkles}
        label={`${t(phase === 'in' ? 'animationIn' : 'animationOut')}: ${t(choices.find(([v]) => v === current)![1])}`}
        items={choices.map(([value, key]) => ({
          label: t(key),
          selected: value === current,
          onSelect: () => setClipAnimation(session, clip.id, phase, value),
        }))}
      />
    );
  };

  const setColor = (field: 'fill' | 'stroke' | 'color', value: string) =>
    store.getState().execute(
      'Color',
      (draft) =>
        updateClip(clip.id, (c) => {
          if (field === 'color' && c.type === 'highlight') c.color = value;
          if (
            (field === 'fill' || field === 'stroke') &&
            (c.type === 'box' || c.type === 'shape' || c.type === 'progress')
          ) {
            if (field === 'fill') c.fill = value;
            else if (c.type !== 'progress') c.stroke = value;
          }
        })(draft),
      { mergeKey: `${clip.id}:${field}` },
    );

  return (
    <>
      {visual && (
        <RibbonGroup label={t('groupAnimation')}>
          {animationMenu('in')}
          {animationMenu('out')}
        </RibbonGroup>
      )}
      {hasText && (
        <RibbonGroup label={t('groupFont')}>
          <RibbonStack>
            <RibbonButton
              size="small"
              icon={AArrowUp}
              label={t('fontLarger')}
              onClick={() =>
                editTextStyle(session, clip.id, 'Font size', (s) => ({
                  ...s,
                  fontSize: Math.min(1000, (s.fontSize ?? 48) + 8),
                }))
              }
            />
            <RibbonButton
              size="small"
              icon={AArrowDown}
              label={t('fontSmaller')}
              onClick={() =>
                editTextStyle(session, clip.id, 'Font size', (s) => ({
                  ...s,
                  fontSize: Math.max(8, (s.fontSize ?? 48) - 8),
                }))
              }
            />
            <RibbonButton
              size="small"
              icon={Bold}
              label={t('bold')}
              pressed={(style.fontWeight ?? 400) >= 700}
              onClick={() =>
                editTextStyle(session, clip.id, 'Bold', (s) => ({
                  ...s,
                  fontWeight: (s.fontWeight ?? 400) >= 700 ? 400 : 700,
                }))
              }
            />
          </RibbonStack>
          <RibbonStack>
            <RibbonButton
              size="small"
              icon={AlignLeft}
              label={t('alignLeft')}
              pressed={(style.align ?? 'left') === 'left'}
              onClick={() =>
                editTextStyle(session, clip.id, 'Align', (s) => ({ ...s, align: 'left' }))
              }
            />
            <RibbonButton
              size="small"
              icon={AlignCenter}
              label={t('alignCenter')}
              pressed={style.align === 'center'}
              onClick={() =>
                editTextStyle(session, clip.id, 'Align', (s) => ({ ...s, align: 'center' }))
              }
            />
            <RibbonButton
              size="small"
              icon={AlignRight}
              label={t('alignRight')}
              pressed={style.align === 'right'}
              onClick={() =>
                editTextStyle(session, clip.id, 'Align', (s) => ({ ...s, align: 'right' }))
              }
            />
          </RibbonStack>
          <RibbonColor
            icon={Palette}
            label={t('textColor')}
            value={style.color ?? '#ffffff'}
            onChange={(v) =>
              editTextStyle(session, clip.id, 'Text color', (s) => ({ ...s, color: v }))
            }
          />
        </RibbonGroup>
      )}
      {(clip.type === 'box' ||
        clip.type === 'shape' ||
        clip.type === 'highlight' ||
        clip.type === 'progress') && (
        <RibbonGroup label={t('groupColors')}>
          {clip.type === 'highlight' ? (
            <RibbonColor
              icon={Highlighter}
              label={t('color')}
              value={clip.color ?? '#ff5d73'}
              onChange={(v) => setColor('color', v)}
            />
          ) : (
            <RibbonColor
              icon={PaintBucket}
              label={t('fillColor')}
              value={clip.fill ?? '#000000'}
              onChange={(v) => setColor('fill', v)}
            />
          )}
          {(clip.type === 'box' || clip.type === 'shape') && (
            <RibbonColor
              icon={Pen}
              label={t('lineColor')}
              value={clip.stroke ?? '#000000'}
              onChange={(v) => setColor('stroke', v)}
            />
          )}
        </RibbonGroup>
      )}
      {visual && (
        <RibbonGroup label={t('groupArrange')}>
          <RibbonButton
            icon={BringToFront}
            label={t('bringToFront')}
            onClick={() => arrangeClip(session, clip.id, 'front')}
          />
          <RibbonButton
            icon={SendToBack}
            label={t('sendToBack')}
            onClick={() => arrangeClip(session, clip.id, 'back')}
          />
          <RibbonStack>
            <RibbonButton
              size="small"
              icon={AlignHorizontalJustifyCenter}
              label={t('centerH')}
              onClick={() => centerClip(session, clip.id, 'horizontal')}
            />
            <RibbonButton
              size="small"
              icon={AlignVerticalJustifyCenter}
              label={t('centerV')}
              onClick={() => centerClip(session, clip.id, 'vertical')}
            />
          </RibbonStack>
        </RibbonGroup>
      )}
      <RibbonGroup label={t('groupEdit')}>
        <RibbonButton
          icon={Scissors}
          label={t('split')}
          onClick={() => splitSelectionAtPlayhead(session)}
        />
        <RibbonStack>
          <RibbonButton
            size="small"
            icon={Copy}
            label={t('duplicate')}
            onClick={() => duplicateSelection(session)}
          />
          <RibbonButton
            size="small"
            icon={Trash2}
            label={t('delete')}
            onClick={() => deleteSelection(session)}
          />
        </RibbonStack>
      </RibbonGroup>
    </>
  );
}
