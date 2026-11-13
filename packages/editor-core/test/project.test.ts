// SPDX-License-Identifier: AGPL-3.0-only
import { strToU8, zipSync } from 'fflate';
import { describe, expect, test } from 'vitest';
import {
  assetIdFromName,
  exportProjectZip,
  importProjectZip,
  missingFiles,
  prepareAsset,
  ProjectError,
  sanitizeFileName,
  type Project,
} from '../src/project.js';
import { testCourse } from './helpers.js';

const bytes = (s: string) => strToU8(s);

function project(): Project {
  return {
    course: testCourse(),
    files: new Map([
      ['assets/v.mp4', bytes('video')],
      ['assets/i.png', bytes('image')],
      ['assets/orphan.png', bytes('unused')],
    ]),
  };
}

describe('zip round trip', () => {
  test('exports and imports a project', () => {
    const zip = exportProjectZip(project());
    const back = importProjectZip(zip);
    expect(back.course).toEqual(testCourse());
    expect([...back.files.keys()].sort()).toEqual(['assets/i.png', 'assets/v.mp4']);
    expect(new TextDecoder().decode(back.files.get('assets/v.mp4'))).toBe('video');
  });

  test('accepts a single top-level folder', () => {
    const zip = zipSync({
      'my-course/course.json': bytes(JSON.stringify(testCourse())),
      'my-course/assets/v.mp4': bytes('v'),
      'my-course/assets/i.png': bytes('i'),
    });
    expect(importProjectZip(zip).files.size).toBe(2);
  });

  test.each([
    ['not a zip', bytes('hello'), /not a valid .zip/],
    ['no course', zipSync({ 'x.txt': bytes('x') }), /No course.json/],
    ['bad json', zipSync({ 'course.json': bytes('{') }), /not valid JSON/],
    ['invalid course', zipSync({ 'course.json': bytes('{"formatVersion":1}') }), /not a valid course/],
    ['missing media', zipSync({ 'course.json': bytes(JSON.stringify(testCourse())) }), /Missing file/],
  ])('rejects %s', (_name, data, message) => {
    expect(() => importProjectZip(data)).toThrow(ProjectError);
    expect(() => importProjectZip(data)).toThrow(message);
  });

  test('ignores external assets when collecting files', () => {
    const course = testCourse();
    course.assets.img = { kind: 'image', src: 'https://example.com/i.png' };
    const zip = zipSync({ 'course.json': bytes(JSON.stringify(course)), 'assets/v.mp4': bytes('v') });
    expect(importProjectZip(zip).files.size).toBe(1);
  });
});

describe('assets', () => {
  test('sanitizes file names', () => {
    expect(sanitizeFileName('Mein Bild (1).PNG')).toBe('mein-bild-1.png');
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('Übung – Größe.jpg')).toBe('ubung-grosse.jpg');
    expect(sanitizeFileName('.hidden')).toBe('hidden');
  });

  test('asset ids are valid and unique', () => {
    expect(assetIdFromName('1 Intro.mp4', new Set())).toBe('asset_1_intro');
    expect(assetIdFromName('logo.png', new Set(['logo']))).toBe('logo_2');
  });

  test('prepareAsset picks unique paths and kinds', () => {
    const p = project();
    expect(prepareAsset(p, 'V.mp4')).toEqual({
      assetId: 'v',
      asset: { kind: 'video', src: 'assets/v-2.mp4', mime: 'video/mp4' },
      path: 'assets/v-2.mp4',
    });
    expect(prepareAsset(p, 'talk.vtt').asset.kind).toBe('captions');
    expect(() => prepareAsset(p, 'virus.exe')).toThrow(/Unsupported/);
  });

  test('missingFiles', () => {
    const p = project();
    p.files.delete('assets/i.png');
    expect(missingFiles(p)).toEqual(['assets/i.png']);
  });
});
