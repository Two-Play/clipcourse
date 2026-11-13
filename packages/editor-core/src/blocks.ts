// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Building blocks for templates: text, boxes and buttons in theme colors,
 * laid out on the stage in fractions of its size, so templates fit any
 * stage and follow the course theme.
 */
import {
  themeOf,
  type ButtonClip,
  type Chapter,
  type ClipAction,
  type Course,
  type TextClip,
  type BoxClip,
  type Question,
  type QuestionClip,
  type Track,
  type VisualClip,
} from '@clipcourse/format';
import type { IdFactory } from './document.js';

export interface Area {
  /** Fractions of the stage (0–1). */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TextOptions {
  size?: number;
  heading?: boolean;
  align?: 'left' | 'center' | 'right';
  color?: string;
  start?: number;
  duration?: number;
  startsHidden?: boolean;
}

export function blocks(course: Pick<Course, 'stage' | 'theme'>, newId: IdFactory) {
  const { width: sw, height: sh } = course.stage;
  const theme = themeOf(course);
  const frame = (a: Area) => ({
    x: Math.round(a.x * sw),
    y: Math.round(a.y * sh),
    width: Math.round(a.w * sw),
    height: Math.round(a.h * sh),
  });
  const timing = (o: { start?: number; duration?: number }, chapterLength: number) => {
    const start = o.start ?? 0;
    return {
      start,
      duration: Math.max(500, (o.duration ?? chapterLength) - (o.duration ? 0 : start)),
    };
  };
  const fade = { in: { type: 'fade' as const, duration: 500 } };

  return {
    theme,
    text(value: string, area: Area, o: TextOptions = {}, length = 8000): TextClip {
      return {
        id: newId('clip'),
        type: 'text',
        text: value,
        ...timing(o, length),
        frame: frame(area),
        role: o.heading ? 'heading' : 'paragraph',
        style: {
          fontSize: o.size ?? (o.heading ? 80 : 44),
          color: o.color ?? (o.heading ? 'theme:text' : 'theme:text'),
          align: o.align ?? (o.heading ? 'center' : 'left'),
          verticalAlign: 'middle',
          ...(o.heading ? { fontWeight: 700 } : {}),
        },
        animations: fade,
        ...(o.startsHidden ? { startsHidden: true } : {}),
      };
    },
    box(
      value: string,
      area: Area,
      o: TextOptions & { fill?: string } = {},
      length = 8000,
    ): BoxClip {
      return {
        id: newId('clip'),
        type: 'box',
        ...timing(o, length),
        frame: frame(area),
        fill: o.fill ?? 'theme:surface',
        radius: theme.radius,
        padding: 32,
        text: value,
        style: {
          fontSize: o.size ?? 40,
          color: o.color ?? 'theme:text',
          align: o.align ?? 'left',
          verticalAlign: 'middle',
        },
        animations: fade,
        ...(o.startsHidden ? { startsHidden: true } : {}),
      };
    },
    button(
      value: string,
      area: Area,
      action: ClipAction,
      o: TextOptions = {},
      length = 8000,
    ): ButtonClip {
      return {
        id: newId('clip'),
        type: 'button',
        text: value,
        ...timing(o, length),
        frame: frame(area),
        fill: 'theme:accent',
        radius: theme.radius,
        style: {
          fontSize: o.size ?? 40,
          color: 'theme:onAccent',
          align: 'center',
          verticalAlign: 'middle',
        },
        action,
        animations: fade,
      };
    },
    question(question: Question, area: Area, o: TextOptions = {}, length = 8000): QuestionClip {
      return {
        id: newId('clip'),
        type: 'question',
        ...timing(o, length),
        frame: frame(area),
        question,
      };
    },
    track(name: string, ...clips: VisualClip[]): Track {
      return { id: newId('track'), name, clips };
    },
    chapter(title: string, tracks: Track[], extra: Partial<Chapter> = {}, length = 8000): Chapter {
      return {
        id: newId('chapter'),
        title,
        duration: length,
        transition: { mode: 'wait' },
        tracks,
        ...extra,
      };
    },
  };
}

export type Blocks = ReturnType<typeof blocks>;

/** Common layouts. */
export const AREA = {
  title: { x: 0.1, y: 0.3, w: 0.8, h: 0.2 },
  subtitle: { x: 0.15, y: 0.52, w: 0.7, h: 0.1 },
  heading: { x: 0.08, y: 0.06, w: 0.84, h: 0.14 },
  bullet: (i: number): Area => ({ x: 0.1, y: 0.28 + i * 0.16, w: 0.8, h: 0.13 }),
  left: { x: 0.08, y: 0.26, w: 0.4, h: 0.6 },
  right: { x: 0.52, y: 0.26, w: 0.4, h: 0.6 },
  center: { x: 0.15, y: 0.3, w: 0.7, h: 0.3 },
  buttonLeft: { x: 0.2, y: 0.72, w: 0.27, h: 0.1 },
  buttonRight: { x: 0.53, y: 0.72, w: 0.27, h: 0.1 },
  buttonCenter: { x: 0.35, y: 0.75, w: 0.3, h: 0.1 },
} satisfies Record<string, Area | ((i: number) => Area)>;
