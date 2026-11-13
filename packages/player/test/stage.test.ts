// SPDX-License-Identifier: MIT
// @vitest-environment happy-dom
import { produce } from 'immer';
import { expect, test } from 'vitest';
import type { Course } from '@clipcourse/format';
import { evaluate } from '../src/core/evaluate.js';
import { Stage } from '../src/dom/stage.js';
import { course } from './fixtures.js';

const withVideo = (): Course =>
  course(
    [
      {
        id: 'ch',
        title: 'Ch',
        duration: 5000,
        transition: { mode: 'wait' },
        tracks: [
          {
            id: 't',
            clips: [
              {
                id: 'v',
                type: 'video',
                assetId: 'vid',
                start: 0,
                duration: 5000,
                frame: { x: 0, y: 0, width: 100, height: 100 },
              },
              {
                id: 'b',
                type: 'box',
                text: 'Hi',
                start: 0,
                duration: 5000,
                frame: { x: 0, y: 0, width: 100, height: 100 },
              },
            ],
          },
        ],
      },
    ],
    { assets: { vid: { kind: 'video', src: 'v.mp4' } } },
  );

function makeStage(c: Course) {
  return new Stage(document, c, {
    resolveAsset: (a) => `blob:${a.src}`,
    onPlayBlocked: () => {},
    onMediaError: () => {},
  });
}

test('setCourse rebuilds clips and reuses media elements with the same source', () => {
  const c1 = withVideo();
  const stage = makeStage(c1);
  stage.render(evaluate(c1, 0, 100), false);
  const video = stage.element.querySelector('video');
  expect(video).not.toBeNull();

  const c2 = produce(c1, (d) => {
    const box = d.chapters[0]!.tracks[0]!.clips[1]!;
    if (box.type === 'box') box.text = 'Changed';
    const v = d.chapters[0]!.tracks[0]!.clips[0]!;
    if (v.type === 'video') v.frame = { x: 50, y: 0, width: 100, height: 100 };
  });
  stage.setCourse(c2);
  stage.render(evaluate(c2, 0, 100), false);

  expect(stage.element.querySelector('video')).toBe(video);
  expect(stage.element.querySelectorAll('video')).toHaveLength(1);
  expect(stage.element.textContent).toContain('Changed');
  expect((stage.element.querySelector('[data-clip-id="v"]') as HTMLElement).style.left).toBe(
    '50px',
  );
});

test('setCourse updates the stage size', () => {
  const c1 = withVideo();
  const stage = makeStage(c1);
  stage.setCourse(produce(c1, (d) => void (d.stage.width = 1280)));
  expect(stage.element.style.width).toBe('1280px');
});
