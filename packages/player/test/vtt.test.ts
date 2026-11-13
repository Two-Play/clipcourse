// SPDX-License-Identifier: MIT
import { expect, test } from 'vitest';
import { cueTextAt, parseVtt } from '../src/core/vtt.js';

const source = `\uFEFFWEBVTT

NOTE this is ignored

intro
00:00.000 --> 00:02.500 align:center
<v Anna>Hello &amp; welcome</v>

00:00:02.500 --> 00:00:05.000
Line one
<i>Line two</i>
`;

test('parses cues with and without hours, ids and settings', () => {
  expect(parseVtt(source)).toEqual([
    { start: 0, end: 2500, text: 'Hello & welcome' },
    { start: 2500, end: 5000, text: 'Line one\nLine two' },
  ]);
});

test('finds the cue text for a time', () => {
  const cues = parseVtt(source);
  expect(cueTextAt(cues, 0)).toBe('Hello & welcome');
  expect(cueTextAt(cues, 2500)).toBe('Line one\nLine two');
  expect(cueTextAt(cues, 5000)).toBe('');
});

test('handles CRLF line endings', () => {
  expect(parseVtt('WEBVTT\r\n\r\n00:01.000 --> 00:02.000\r\nHi\r\n')).toHaveLength(1);
});
