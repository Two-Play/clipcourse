// SPDX-License-Identifier: AGPL-3.0-only
/** Compact descriptions of a course for AI assistants and logs. */
import type { Clip, ClipAction, Course, Question, Track } from '@clipcourse/format';

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

const short = (text: string) => text.replace(/\s+/g, ' ').slice(0, 80);

/** One line per question: kind, prompt, scoring, answers with the correct ones marked. */
function questionSummary(q: Question): string {
  const scoring = [
    q.scored === false ? 'not scored' : `${q.points ?? 1} pt`,
    `attempts ${q.attempts === 0 ? 'unlimited' : (q.attempts ?? 1)}`,
  ].join(', ');
  let answers = '';
  switch (q.kind) {
    case 'single':
    case 'multiple': {
      const correct = q.kind === 'single' ? [q.correct] : q.correct;
      answers = q.choices
        .map((c) => `${correct.includes(c.id) ? '✓' : '·'}${c.id}:"${short(c.text)}"`)
        .join(' ');
      break;
    }
    case 'text':
      answers = `accepts ${q.answers.map((a) => `"${a}"`).join(' | ')}`;
      break;
    case 'order':
      answers = `order ${q.items.map((i) => `${i.id}:"${short(i.text)}"`).join(' → ')}`;
      break;
    case 'match':
      answers = q.pairs.map((p) => `${p.id}:"${short(p.left)}"="${short(p.right)}"`).join(' ');
      break;
    case 'hotspot':
      answers = `image ${q.assetId}, areas ${q.areas.map((a) => `${q.correct.includes(a.id) ? '✓' : '·'}${a.id}:"${a.label}"`).join(' ')}`;
      break;
  }
  return `${q.kind} "${short(q.prompt)}" (${scoring}) ${answers} {${q.id}}`;
}

function actionSummary(action: ClipAction, course: Course): string {
  switch (action.type) {
    case 'goToChapter':
      return `go to chapter "${course.chapters.find((c) => c.id === action.chapterId)?.title ?? '?'}" {${action.chapterId}}`;
    case 'goToMarker':
      return `go to marker {${action.markerId}} in {${action.chapterId}}`;
    case 'openPopup':
      return `open popup "${course.popups?.find((p) => p.id === action.popupId)?.title ?? '?'}" {${action.popupId}}`;
    case 'setClipVisibility':
      return `${action.visible} clip {${action.clipId}}${action.pause ? ' and pause' : ''}`;
    case 'openUrl':
      return `open ${action.url}`;
  }
}

function clipSummary(clip: Clip, course: Course): string {
  const range = `${seconds(clip.start)}–${seconds(clip.start + clip.duration)}`;
  let what: string = clip.type;
  if (clip.type === 'text') what = `text "${clip.text.replace(/\s+/g, ' ').slice(0, 80)}"`;
  else if (clip.type === 'box')
    what = `box${clip.text ? ` "${clip.text.replace(/\s+/g, ' ').slice(0, 80)}"` : ''}`;
  else if (clip.type === 'image' || clip.type === 'video' || clip.type === 'audio') {
    what = `${clip.type} ${clip.assetId} (${course.assets[clip.assetId]?.src ?? 'missing'})`;
  } else if (clip.type === 'shape') what = `shape ${clip.shape}`;
  else if (clip.type === 'highlight')
    what = `highlight ${clip.kind}${clip.label ? ` "${clip.label}"` : ''}`;
  else if (clip.type === 'question') what = `question: ${questionSummary(clip.question)}`;
  else if (clip.type === 'button') what = `button "${short(clip.text)}"`;
  const anim =
    clip.type !== 'audio' && clip.animations
      ? ` anim[${[clip.animations.in && `in:${clip.animations.in.type}`, clip.animations.out && `out:${clip.animations.out.type}`].filter(Boolean).join(',')}]`
      : '';
  const click =
    clip.type !== 'audio' && clip.action ? ` on click: ${actionSummary(clip.action, course)}` : '';
  const hidden = clip.type !== 'audio' && clip.startsHidden ? ' (starts hidden)' : '';
  return `${range} ${what}${anim}${hidden}${click} {${clip.id}}`;
}

function trackLines(tracks: Track[], course: Course, label: string): string[] {
  // Front-most first, like the editor's timeline.
  return [...tracks]
    .reverse()
    .flatMap((track) => [
      `  ${label} track "${track.name ?? track.id}" {${track.id}}${track.hidden ? ' (hidden)' : ''}${track.muted ? ' (muted)' : ''}`,
      ...(track.clips.length
        ? track.clips.map((c) => `    ${clipSummary(c, course)}`)
        : ['    (empty)']),
    ]);
}

/** A readable outline of the whole course, or of one chapter. */
export function describeTimeline(course: Course, chapterId?: string): string {
  const lines: string[] = [
    `Course "${course.title}" {${course.id}}, ${course.language}, stage ${course.stage.width}×${course.stage.height}, ${course.chapters.length} chapter(s)${course.assessment ? `, passing score ${course.assessment.passingScore} %` : ''}${course.completion?.mode === 'goal' ? ', completed when a goal chapter is reached' : ''}`,
  ];
  const chapters = chapterId ? course.chapters.filter((c) => c.id === chapterId) : course.chapters;
  if (chapterId && chapters.length === 0) throw new Error(`Unknown chapter "${chapterId}"`);
  if (course.courseLayer) {
    lines.push('All chapters (course layer):');
    lines.push(...trackLines(course.courseLayer.foreground, course, 'foreground'));
    lines.push(...trackLines(course.courseLayer.background, course, 'background'));
  }
  for (const chapter of chapters) {
    const index = course.chapters.indexOf(chapter) + 1;
    lines.push(
      `Chapter ${index} "${chapter.title}" {${chapter.id}}, ${seconds(chapter.duration)}, at the end: ${chapter.transition.mode === 'wait' ? 'wait for Continue' : 'continue automatically'}${chapter.optional ? ', optional' : ''}${chapter.goal ? ', goal' : ''}`,
    );
    if (chapter.quiz) {
      const { quiz } = chapter;
      lines.push(
        `  quiz chapter: ${quiz.questions.length} question(s)${quiz.shuffle ? ', shuffled' : ''}${quiz.retries ? `, ${quiz.retries} retr${quiz.retries === 1 ? 'y' : 'ies'}` : ''}`,
      );
      quiz.questions.forEach((q, i) => lines.push(`    ${i + 1}. ${questionSummary(q)}`));
    }
    for (const marker of chapter.markers ?? [])
      lines.push(`  marker ${seconds(marker.time)} "${marker.title}" {${marker.id}}`);
    lines.push(...trackLines(chapter.tracks, course, 'chapter'));
  }
  if (course.popups?.length) {
    lines.push('Popups:');
    for (const popup of course.popups) {
      lines.push(
        `  "${popup.title}": "${short(popup.text)}"${popup.assetId ? ` image ${popup.assetId}` : ''} {${popup.id}}`,
      );
    }
  }
  if (course.glossary?.length) {
    lines.push('Glossary:');
    for (const entry of course.glossary) {
      lines.push(
        `  ${entry.term}${entry.variants?.length ? ` (${entry.variants.join(', ')})` : ''}: ${short(entry.definition)} {${entry.id}}`,
      );
    }
  }
  const assets = Object.entries(course.assets);
  if (assets.length) {
    lines.push('Media:');
    for (const [id, asset] of assets) {
      lines.push(
        `  ${id}: ${asset.kind} ${asset.src}${asset.duration ? ` (${seconds(asset.duration)})` : ''}${asset.alt ? ` alt="${asset.alt}"` : ''}`,
      );
    }
  }
  return lines.join('\n');
}
