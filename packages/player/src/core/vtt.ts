// SPDX-License-Identifier: MIT
/**
 * Minimal WebVTT parser for captions.
 *
 * Supports cue timings and text. Cue settings, styles, regions and NOTE
 * blocks are ignored. Inline tags (<v Speaker>, <i>, …) are stripped; the
 * renderer only ever inserts plain text.
 */

export interface Cue {
  /** ms */
  start: number;
  /** ms */
  end: number;
  text: string;
}

const TIMING = /^((?:\d+:)?\d{1,2}:\d{2}[.,]\d{3})\s+-->\s+((?:\d+:)?\d{1,2}:\d{2}[.,]\d{3})/;

export function parseTimestamp(value: string): number {
  const parts = value.replace(',', '.').split(':');
  let seconds = 0;
  for (const part of parts) seconds = seconds * 60 + parseFloat(part);
  return Math.round(seconds * 1000);
}

export function parseVtt(source: string): Cue[] {
  const lines = source
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  const cues: Cue[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!.trim();
    const match = TIMING.exec(line);
    if (!match) {
      i++;
      continue;
    }
    const start = parseTimestamp(match[1]!);
    const end = parseTimestamp(match[2]!);
    i++;
    const text: string[] = [];
    while (i < lines.length && lines[i]!.trim() !== '') {
      text.push(stripTags(lines[i]!));
      i++;
    }
    if (end > start) cues.push({ start, end, text: text.join('\n') });
  }
  return cues.sort((a, b) => a.start - b.start);
}

function stripTags(line: string): string {
  return line
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/** Text of all cues active at `time` (ms), joined by line breaks. */
export function cueTextAt(cues: readonly Cue[], time: number): string {
  const active: string[] = [];
  for (const cue of cues) {
    if (cue.start > time) break;
    if (time < cue.end) active.push(cue.text);
  }
  return active.join('\n');
}
