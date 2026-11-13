// SPDX-License-Identifier: AGPL-3.0-only
/** Reading media files for import. */
import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { kindFromMime, mimeFromName } from '@clipcourse/editor-core';

/** Largest media file the server imports. */
export const MAX_MEDIA_BYTES = 500 * 1024 * 1024;

export interface MediaFile {
  fileName: string;
  mime: string;
  data: Uint8Array;
  /** Duration in ms, if it could be read (MP4/M4A/MOV). */
  duration?: number;
}

export function readLocalMedia(path: string): MediaFile {
  const stat = statSync(path);
  if (!stat.isFile()) throw new Error(`Not a file: ${path}`);
  if (stat.size > MAX_MEDIA_BYTES)
    throw new Error(
      `File too large (${Math.round(stat.size / 1e6)} MB, limit ${MAX_MEDIA_BYTES / 1e6} MB)`,
    );
  const fileName = basename(path);
  const mime = mimeFromName(fileName);
  if (!mime || !kindFromMime(mime)) {
    throw new Error(
      `Unsupported file type: ${fileName} (images, video, audio and .vtt captions are supported)`,
    );
  }
  const data = new Uint8Array(readFileSync(path));
  const duration = mp4Duration(data);
  return { fileName, mime, data, ...(duration ? { duration } : {}) };
}

/**
 * Reads the duration from an ISO base media file (MP4, M4A, MOV) by
 * finding the movie header box ("mvhd"). Returns null for anything else.
 */
export function mp4Duration(data: Uint8Array): number | null {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const findBox = (start: number, end: number, type: string): [number, number] | null => {
    let offset = start;
    while (offset + 8 <= end) {
      let size = view.getUint32(offset);
      const name = String.fromCharCode(
        data[offset + 4]!,
        data[offset + 5]!,
        data[offset + 6]!,
        data[offset + 7]!,
      );
      let header = 8;
      if (size === 1 && offset + 16 <= end) {
        size = Number(view.getBigUint64(offset + 8));
        header = 16;
      } else if (size === 0) {
        size = end - offset;
      }
      if (size < header) return null;
      if (name === type) return [offset + header, offset + size];
      offset += size;
    }
    return null;
  };
  const moov = findBox(0, data.length, 'moov');
  if (!moov) return null;
  const mvhd = findBox(moov[0], moov[1], 'mvhd');
  if (!mvhd) return null;
  const [p] = mvhd;
  const version = data[p]!;
  if (version === 1) {
    if (p + 32 > data.length) return null;
    const timescale = view.getUint32(p + 20);
    const duration = Number(view.getBigUint64(p + 24));
    return timescale ? Math.round((duration / timescale) * 1000) : null;
  }
  if (p + 20 > data.length) return null;
  const timescale = view.getUint32(p + 12);
  const duration = view.getUint32(p + 16);
  return timescale ? Math.round((duration / timescale) * 1000) : null;
}
