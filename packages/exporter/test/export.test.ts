// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
import type { Course } from '@clipcourse/format';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, test } from 'vitest';
import {
  buildCourseData,
  buildIndexHtml,
  ExportError,
  exportScorm,
  packageFileName,
} from '../src/export.js';
import { buildManifest } from '../src/manifest.js';

const course: Course = {
  formatVersion: 4,
  id: 'my_course',
  title: 'Sicherheit & <Schutz> "2026"',
  language: 'de',
  stage: { width: 1920, height: 1080, background: '#000' },
  assets: {
    logo: { kind: 'image', src: 'assets/logo.svg', mime: 'image/svg+xml' },
    clip: { kind: 'video', src: 'assets/my clip.mp4', mime: 'video/mp4' },
  },
  chapters: [
    {
      id: 'ch1',
      title: 'Eins',
      duration: 1000,
      transition: { mode: 'wait' },
      tracks: [
        {
          id: 't',
          clips: [
            {
              id: 'i',
              type: 'image',
              assetId: 'logo',
              start: 0,
              duration: 1000,
              frame: { x: 0, y: 0, width: 1, height: 1 },
            },
          ],
        },
      ],
    },
  ],
};

const files = new Map([
  ['assets/logo.svg', new TextEncoder().encode('<svg/>')],
  ['assets/my clip.mp4', new Uint8Array([0, 1, 2])],
]);

const parseXml = (xml: string) => {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
  return doc;
};

describe.each(['1.2', '2004'] as const)('SCORM %s package', (version) => {
  const result = exportScorm({ course, files }, { version, runtime: 'console.log("runtime")' });
  const unzipped = unzipSync(result.zip);

  test('contains manifest, launch page, data, runtime and media', () => {
    expect(Object.keys(unzipped).sort()).toEqual(
      [
        'assets/logo.svg',
        'assets/my clip.mp4',
        'clipcourse-runtime.js',
        'course.js',
        'imsmanifest.xml',
        'index.html',
      ].sort(),
    );
    expect(result.files[0]).toBe('imsmanifest.xml');
  });

  test('manifest is well-formed and lists every file', () => {
    const doc = parseXml(strFromU8(unzipped['imsmanifest.xml']!));
    const schemaversion = doc.getElementsByTagName('schemaversion')[0]!.textContent;
    expect(schemaversion).toBe(version === '1.2' ? '1.2' : '2004 4th Edition');
    const hrefs = [...doc.getElementsByTagName('file')].map((f) =>
      decodeURIComponent(f.getAttribute('href')!),
    );
    expect(hrefs.sort()).toEqual(
      Object.keys(unzipped)
        .filter((f) => f !== 'imsmanifest.xml')
        .sort(),
    );
    const resource = doc.getElementsByTagName('resource')[0]!;
    expect(resource.getAttribute('href')).toBe('index.html');
    expect(resource.getAttribute(version === '1.2' ? 'adlcp:scormtype' : 'adlcp:scormType')).toBe(
      'sco',
    );
    expect(doc.getElementsByTagName('title')[0]!.textContent).toBe(course.title);
    if (version === '2004') {
      expect(
        doc
          .getElementsByTagName('imsss:deliveryControls')[0]!
          .getAttribute('completionSetByContent'),
      ).toBe('true');
    }
  });

  test('course data declares the SCORM version', () => {
    const js = strFromU8(unzipped['course.js']!);
    const data = new Function('window', `${js}; return window.CLIPCOURSE;`)({});
    expect(data).toEqual({ course, scormVersion: version });
    expect(js).not.toContain('<');
  });
});

test('index.html escapes the title and loads the scripts in order', () => {
  const html = buildIndexHtml(course);
  expect(html).toContain('<html lang="de">');
  expect(html).toContain('<title>Sicherheit &amp; &lt;Schutz&gt; &quot;2026&quot;</title>');
  expect(html.indexOf('course.js')).toBeLessThan(html.indexOf('clipcourse-runtime.js'));
});

test('course data cannot break out of a script tag', () => {
  const evil = { ...course, title: '</script><script>alert(1)</script>' };
  expect(buildCourseData(evil, '1.2')).not.toContain('</script>');
});

test('refuses invalid courses and missing media', () => {
  expect(() =>
    exportScorm({ course: { ...course, chapters: [] }, files }, { version: '1.2', runtime: 'x' }),
  ).toThrow(ExportError);
  try {
    exportScorm({ course, files: new Map() }, { version: '1.2', runtime: 'x' });
    expect.unreachable();
  } catch (error) {
    expect((error as ExportError).details).toEqual(['assets/logo.svg', 'assets/my clip.mp4']);
  }
  expect(() => exportScorm({ course, files }, { version: '1.2', runtime: '' })).toThrow(/runtime/);
});

test('external media is not packaged and produces a warning', () => {
  const external = {
    ...course,
    assets: {
      ...course.assets,
      logo: { kind: 'image' as const, src: 'https://cdn.example.com/logo.svg' },
    },
  };
  const result = exportScorm({ course: external, files }, { version: '2004', runtime: 'x' });
  expect(Object.keys(unzipSync(result.zip))).not.toContain('assets/logo.svg');
  expect(result.warnings.join()).toMatch(/external/);
});

test('manifest ids are valid xs:IDs', () => {
  const xml = buildManifest({ ...course, id: 'a.b-c' }, '1.2', ['index.html']);
  expect(xml).toContain('identifier="MANIFEST_a.b-c"');
});

test('package file names', () => {
  expect(packageFileName(course, '1.2')).toBe('Sicherheit_Schutz_2026-scorm12.zip');
  expect(packageFileName({ ...course, title: '***' }, '2004')).toBe('course-scorm2004.zip');
});
