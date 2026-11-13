// SPDX-License-Identifier: MIT
/**
 * Runtime schema for format version 1 (Valibot).
 *
 * This module is used by the editor, the exporter and tests. The player does
 * not import it, so exported courses do not ship a validator.
 */
import * as v from 'valibot';
import type { Course } from './types.js';

export const ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/;
/** Hex, rgb(), rgba(), hsl(), hsla() or a named color. No url() or other CSS. */
export const COLOR_PATTERN = /^(#[0-9a-fA-F]{3,8}|(rgb|rgba|hsl|hsla)\([0-9.,%\s/+-]*\)|[a-zA-Z]{1,30})$/;
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

const visualBase = {
  ...clipBase,
  frame: FrameSchema,
  opacity: v.exactOptional(unit),
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

const ClipSchema = v.variant('type', [
  ImageClipSchema,
  TextClipSchema,
  ShapeClipSchema,
  BoxClipSchema,
  VideoClipSchema,
  AudioClipSchema,
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
  tracks: v.array(TrackSchema),
});

export const CourseSchema = v.strictObject({
  formatVersion: v.literal(1),
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
  extensions: v.exactOptional(v.record(v.string(), v.unknown())),
});

// Compile-time check: the schema output and the hand-written types agree.
type SchemaCourse = v.InferOutput<typeof CourseSchema>;
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const schemaMatchesTypes: Equals<SchemaCourse, Course> = true;
void schemaMatchesTypes;
