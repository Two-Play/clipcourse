// SPDX-License-Identifier: AGPL-3.0-only
/** Compact descriptions of a course for AI assistants and logs. */
import type { Clip, Course, Track } from '@clipcourse/format';

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

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
  const anim =
    clip.type !== 'audio' && clip.animations
      ? ` anim[${[clip.animations.in && `in:${clip.animations.in.type}`, clip.animations.out && `out:${clip.animations.out.type}`].filter(Boolean).join(',')}]`
      : '';
  return `${range} ${what}${anim} {${clip.id}}`;
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
    `Course "${course.title}" {${course.id}}, ${course.language}, stage ${course.stage.width}×${course.stage.height}, ${course.chapters.length} chapter(s)`,
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
      `Chapter ${index} "${chapter.title}" {${chapter.id}}, ${seconds(chapter.duration)}, at the end: ${chapter.transition.mode === 'wait' ? 'wait for Continue' : 'continue automatically'}`,
    );
    for (const marker of chapter.markers ?? [])
      lines.push(`  marker ${seconds(marker.time)} "${marker.title}" {${marker.id}}`);
    lines.push(...trackLines(chapter.tracks, course, 'chapter'));
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
