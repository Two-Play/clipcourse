// SPDX-License-Identifier: MIT
/**
 * Runtime schema for the current format version (Valibot).
 *
 * This module is used by the editor, the exporter and tests. The player does
 * not import it, so exported courses do not ship a validator.
 */
import * as v from 'valibot';
import type { Course } from './types.js';

export const ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/;
/** Hex, rgb(), rgba(), hsl(), hsla() or a named color. No url() or other CSS. */
export const CONCRETE_COLOR_PATTERN =
  /^(#[0-9a-fA-F]{3,8}|(rgb|rgba|hsl|hsla)\([0-9.,%\s/+-]*\)|[a-zA-Z]{1,30})$/;
/** A concrete color or a theme role reference ("theme:accent"). */
export const COLOR_PATTERN =
  /^(#[0-9a-fA-F]{3,8}|(rgb|rgba|hsl|hsla)\([0-9.,%\s/+-]*\)|[a-zA-Z]{1,30}|theme:(background|surface|text|muted|accent|onAccent|success|error))$/;
/** Font family list without anything that could escape the CSS value. */
export const FONT_FAMILY_PATTERN = /^[A-Za-z0-9 ,'"_-]{1,200}$/;
/**
 * Relative project path (no "..", no leading slash, no backslash) or an
 * absolute http(s) URL.
 */
export const ASSET_SRC_PATTERN =
  /^(https?:\/\/[^\s]+|(?!\/)(?!.*(^|\/)\.\.(\/|$))[A-Za-z0-9_.\- /]+)$/;
export const LANGUAGE_PATTERN = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/;

const id = v.pipe(v.string(), v.regex(ID_PATTERN, 'Invalid id'));
const color = v.pipe(v.string(), v.regex(COLOR_PATTERN, 'Invalid color'));
const concreteColor = v.pipe(v.string(), v.regex(CONCRETE_COLOR_PATTERN, 'Invalid color'));
const fontStack = v.pipe(v.string(), v.regex(FONT_FAMILY_PATTERN));
const ms = v.pipe(v.number(), v.integer(), v.minValue(0));
const positiveMs = v.pipe(v.number(), v.integer(), v.minValue(1));
const finite = v.pipe(v.number(), v.finite());
const unit = v.pipe(v.number(), v.minValue(0), v.maxValue(1));
const nonNegative = v.pipe(v.number(), v.finite(), v.minValue(0));

const StageSchema = v.strictObject({
  width: v.pipe(v.number(), v.integer(), v.minValue(16), v.maxValue(8192)),
  height: v.pipe(v.number(), v.integer(), v.minValue(16), v.maxValue(8192)),
  background: color,
});

const AssetSchema = v.strictObject({
  kind: v.picklist(['image', 'video', 'audio', 'captions']),
  src: v.pipe(v.string(), v.maxLength(2048), v.regex(ASSET_SRC_PATTERN, 'Invalid asset src')),
  mime: v.exactOptional(v.pipe(v.string(), v.regex(/^[a-z]+\/[A-Za-z0-9.+-]+$/))),
  alt: v.exactOptional(v.string()),
  duration: v.exactOptional(ms),
});

const FrameSchema = v.strictObject({
  x: finite,
  y: finite,
  width: nonNegative,
  height: nonNegative,
  rotation: v.exactOptional(finite),
});

const TextStyleSchema = v.strictObject({
  fontFamily: v.exactOptional(v.pipe(v.string(), v.regex(FONT_FAMILY_PATTERN))),
  fontSize: v.exactOptional(v.pipe(v.number(), v.minValue(1), v.maxValue(1000))),
  fontWeight: v.exactOptional(v.pipe(v.number(), v.integer(), v.minValue(100), v.maxValue(900))),
  italic: v.exactOptional(v.boolean()),
  color: v.exactOptional(color),
  align: v.exactOptional(v.picklist(['left', 'center', 'right'])),
  verticalAlign: v.exactOptional(v.picklist(['top', 'middle', 'bottom'])),
  lineHeight: v.exactOptional(v.pipe(v.number(), v.minValue(0.5), v.maxValue(5))),
});

const clipBase = {
  id,
  start: ms,
  duration: positiveMs,
};

const AnimationSchema = v.strictObject({
  type: v.picklist(['fade', 'slide', 'zoom']),
  duration: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(600000)),
  direction: v.exactOptional(v.picklist(['left', 'right', 'up', 'down'])),
  easing: v.exactOptional(v.picklist(['linear', 'ease-in', 'ease-out', 'ease-in-out'])),
});

/** http(s) and mailto only: no javascript: or data: links. */
export const URL_PATTERN = /^(https?:\/\/[^\s]+|mailto:[^\s]+)$/i;

export const ClipActionSchema = v.variant('type', [
  v.strictObject({ type: v.literal('goToChapter'), chapterId: id }),
  v.strictObject({ type: v.literal('goToMarker'), chapterId: id, markerId: id }),
  v.strictObject({ type: v.literal('openPopup'), popupId: id }),
  v.strictObject({
    type: v.literal('setClipVisibility'),
    clipId: id,
    visible: v.picklist(['show', 'hide', 'toggle']),
    pause: v.exactOptional(v.boolean()),
  }),
  v.strictObject({
    type: v.literal('openUrl'),
    url: v.pipe(
      v.string(),
      v.maxLength(2048),
      v.regex(URL_PATTERN, 'Only http(s) and mailto links'),
    ),
  }),
]);

const visualBase = {
  ...clipBase,
  action: v.exactOptional(ClipActionSchema),
  actionLabel: v.exactOptional(v.pipe(v.string(), v.maxLength(500))),
  startsHidden: v.exactOptional(v.boolean()),
  frame: FrameSchema,
  opacity: v.exactOptional(unit),
  animations: v.exactOptional(
    v.strictObject({
      in: v.exactOptional(AnimationSchema),
      out: v.exactOptional(AnimationSchema),
    }),
  ),
};

const fit = v.picklist(['contain', 'cover', 'fill']);

const mediaProps = {
  assetId: id,
  trimStart: v.exactOptional(ms),
  volume: v.exactOptional(unit),
  captionsAssetId: v.exactOptional(id),
};

const ImageClipSchema = v.strictObject({
  ...visualBase,
  type: v.literal('image'),
  assetId: id,
  fit: v.exactOptional(fit),
  alt: v.exactOptional(v.string()),
});

const TextClipSchema = v.strictObject({
  ...visualBase,
  type: v.literal('text'),
  text: v.pipe(v.string(), v.maxLength(10000)),
  style: v.exactOptional(TextStyleSchema),
  role: v.exactOptional(v.picklist(['heading', 'paragraph'])),
});

const ShapeClipSchema = v.strictObject({
  ...visualBase,
  type: v.literal('shape'),
  shape: v.picklist(['rect', 'ellipse', 'line', 'arrow']),
  fill: v.exactOptional(color),
  stroke: v.exactOptional(color),
  strokeWidth: v.exactOptional(nonNegative),
  radius: v.exactOptional(nonNegative),
});

const BoxClipSchema = v.strictObject({
  ...visualBase,
  type: v.literal('box'),
  fill: v.exactOptional(color),
  stroke: v.exactOptional(color),
  strokeWidth: v.exactOptional(nonNegative),
  radius: v.exactOptional(nonNegative),
  padding: v.exactOptional(nonNegative),
  text: v.exactOptional(v.pipe(v.string(), v.maxLength(10000))),
  style: v.exactOptional(TextStyleSchema),
});

const VideoClipSchema = v.strictObject({
  ...visualBase,
  ...mediaProps,
  type: v.literal('video'),
  fit: v.exactOptional(fit),
  muted: v.exactOptional(v.boolean()),
});

const AudioClipSchema = v.strictObject({
  ...clipBase,
  ...mediaProps,
  type: v.literal('audio'),
});

const HighlightClipSchema = v.strictObject({
  ...visualBase,
  type: v.literal('highlight'),
  kind: v.picklist(['marker', 'frame', 'arrow', 'spotlight']),
  color: v.exactOptional(color),
  strokeWidth: v.exactOptional(nonNegative),
  radius: v.exactOptional(nonNegative),
  pulse: v.exactOptional(v.boolean()),
  label: v.exactOptional(v.pipe(v.string(), v.maxLength(500))),
});

const ButtonClipSchema = v.strictObject({
  ...visualBase,
  type: v.literal('button'),
  text: v.pipe(v.string(), v.maxLength(500)),
  action: ClipActionSchema,
  style: v.exactOptional(TextStyleSchema),
  fill: v.exactOptional(color),
  stroke: v.exactOptional(color),
  strokeWidth: v.exactOptional(nonNegative),
  radius: v.exactOptional(nonNegative),
});

const ProgressClipSchema = v.strictObject({
  ...visualBase,
  type: v.literal('progress'),
  fill: v.exactOptional(color),
  background: v.exactOptional(color),
  radius: v.exactOptional(nonNegative),
});

const text = (max: number) => v.pipe(v.string(), v.maxLength(max));
const ChoiceSchema = v.strictObject({
  id,
  text: v.pipe(v.string(), v.minLength(1), v.maxLength(2000)),
});
const unitNumber = v.pipe(v.number(), v.minValue(0), v.maxValue(1));

const questionBase = {
  id,
  prompt: v.pipe(v.string(), v.minLength(1), v.maxLength(5000)),
  points: v.exactOptional(v.pipe(v.number(), v.minValue(0), v.maxValue(1000))),
  scored: v.exactOptional(v.boolean()),
  attempts: v.exactOptional(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(100))),
  showSolution: v.exactOptional(v.boolean()),
  feedback: v.exactOptional(
    v.strictObject({
      correct: v.exactOptional(text(5000)),
      incorrect: v.exactOptional(text(5000)),
    }),
  ),
};

export const QuestionSchema = v.variant('kind', [
  v.strictObject({
    ...questionBase,
    kind: v.literal('single'),
    choices: v.pipe(v.array(ChoiceSchema), v.minLength(2), v.maxLength(20)),
    correct: id,
  }),
  v.strictObject({
    ...questionBase,
    kind: v.literal('multiple'),
    choices: v.pipe(v.array(ChoiceSchema), v.minLength(2), v.maxLength(20)),
    correct: v.pipe(v.array(id), v.minLength(1)),
  }),
  v.strictObject({
    ...questionBase,
    kind: v.literal('text'),
    answers: v.pipe(
      v.array(v.pipe(v.string(), v.minLength(1), v.maxLength(500))),
      v.minLength(1),
      v.maxLength(50),
    ),
    caseSensitive: v.exactOptional(v.boolean()),
  }),
  v.strictObject({
    ...questionBase,
    kind: v.literal('order'),
    items: v.pipe(v.array(ChoiceSchema), v.minLength(2), v.maxLength(20)),
  }),
  v.strictObject({
    ...questionBase,
    kind: v.literal('match'),
    pairs: v.pipe(
      v.array(
        v.strictObject({
          id,
          left: v.pipe(v.string(), v.minLength(1), v.maxLength(500)),
          right: v.pipe(v.string(), v.minLength(1), v.maxLength(500)),
        }),
      ),
      v.minLength(2),
      v.maxLength(20),
    ),
  }),
  v.strictObject({
    ...questionBase,
    kind: v.literal('hotspot'),
    assetId: id,
    alt: v.exactOptional(text(1000)),
    areas: v.pipe(
      v.array(
        v.strictObject({
          id,
          label: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
          x: unitNumber,
          y: unitNumber,
          width: unitNumber,
          height: unitNumber,
        }),
      ),
      v.minLength(1),
      v.maxLength(30),
    ),
    correct: v.pipe(v.array(id), v.minLength(1)),
  }),
]);

const QuestionClipSchema = v.strictObject({
  ...visualBase,
  type: v.literal('question'),
  question: QuestionSchema,
});

const ClipSchema = v.variant('type', [
  ImageClipSchema,
  ButtonClipSchema,
  TextClipSchema,
  ShapeClipSchema,
  BoxClipSchema,
  VideoClipSchema,
  AudioClipSchema,
  HighlightClipSchema,
  ProgressClipSchema,
  QuestionClipSchema,
]);

const TrackSchema = v.strictObject({
  id,
  name: v.exactOptional(v.pipe(v.string(), v.maxLength(200))),
  hidden: v.exactOptional(v.boolean()),
  muted: v.exactOptional(v.boolean()),
  clips: v.array(ClipSchema),
});

const ChapterSchema = v.strictObject({
  id,
  title: v.pipe(v.string(), v.minLength(1), v.maxLength(500)),
  duration: positiveMs,
  transition: v.variant('mode', [
    v.strictObject({ mode: v.literal('wait') }),
    v.strictObject({ mode: v.literal('auto') }),
  ]),
  background: v.exactOptional(color),
  markers: v.exactOptional(
    v.array(
      v.strictObject({
        id,
        time: ms,
        title: v.pipe(v.string(), v.minLength(1), v.maxLength(500)),
      }),
    ),
  ),
  optional: v.exactOptional(v.boolean()),
  goal: v.exactOptional(v.boolean()),
  tracks: v.array(TrackSchema),
  quiz: v.exactOptional(
    v.strictObject({
      questions: v.pipe(v.array(QuestionSchema), v.minLength(1), v.maxLength(200)),
      shuffle: v.exactOptional(v.boolean()),
      retries: v.exactOptional(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(100))),
    }),
  ),
});

export const CourseSchema = v.strictObject({
  formatVersion: v.literal(5),
  id,
  title: v.pipe(v.string(), v.minLength(1), v.maxLength(500)),
  language: v.pipe(v.string(), v.regex(LANGUAGE_PATTERN, 'Invalid language tag')),
  stage: StageSchema,
  assets: v.record(id, AssetSchema),
  courseLayer: v.exactOptional(
    v.strictObject({
      background: v.array(TrackSchema),
      foreground: v.array(TrackSchema),
    }),
  ),
  chapters: v.pipe(v.array(ChapterSchema), v.minLength(1, 'A course needs at least one chapter')),
  assessment: v.exactOptional(
    v.strictObject({ passingScore: v.pipe(v.number(), v.minValue(0), v.maxValue(100)) }),
  ),
  theme: v.exactOptional(
    v.strictObject({
      preset: v.exactOptional(v.pipe(v.string(), v.maxLength(100))),
      colors: v.strictObject({
        background: concreteColor,
        surface: concreteColor,
        text: concreteColor,
        muted: concreteColor,
        accent: concreteColor,
        onAccent: concreteColor,
        success: concreteColor,
        error: concreteColor,
      }),
      headingFont: fontStack,
      bodyFont: fontStack,
      radius: v.pipe(v.number(), v.minValue(0), v.maxValue(200)),
    }),
  ),
  completion: v.exactOptional(
    v.variant('mode', [
      v.strictObject({ mode: v.literal('required') }),
      v.strictObject({ mode: v.literal('goal') }),
    ]),
  ),
  popups: v.exactOptional(
    v.pipe(
      v.array(
        v.strictObject({
          id,
          title: v.pipe(v.string(), v.minLength(1), v.maxLength(500)),
          text: v.pipe(v.string(), v.maxLength(10000)),
          assetId: v.exactOptional(id),
          alt: v.exactOptional(v.pipe(v.string(), v.maxLength(1000))),
        }),
      ),
      v.maxLength(500),
    ),
  ),
  glossary: v.exactOptional(
    v.pipe(
      v.array(
        v.strictObject({
          id,
          term: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
          variants: v.exactOptional(
            v.pipe(v.array(v.pipe(v.string(), v.minLength(1), v.maxLength(200))), v.maxLength(20)),
          ),
          definition: v.pipe(v.string(), v.minLength(1), v.maxLength(5000)),
        }),
      ),
      v.maxLength(1000),
    ),
  ),
  extensions: v.exactOptional(v.record(v.string(), v.unknown())),
});

// Compile-time check: the schema output and the hand-written types agree.
type SchemaCourse = v.InferOutput<typeof CourseSchema>;
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const schemaMatchesTypes: Equals<SchemaCourse, Course> = true;
void schemaMatchesTypes;
