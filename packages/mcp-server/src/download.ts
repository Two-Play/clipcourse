// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Downloads media from http(s) URLs for import_media, defending against
 * server-side request forgery (SSRF):
 *
 * - only http and https, no credentials in the URL
 * - the host name is resolved once, every address is checked, and the
 *   connection is pinned to the checked address (no DNS rebinding between
 *   check and request)
 * - loopback, private, link-local, CGNAT, multicast and other special
 *   ranges are refused, also for every redirect
 * - size, time and content type are limited
 */
import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import { kindFromMime, mimeFromName } from '@clipcourse/editor-core';
import { mp4Duration, type MediaFile } from './media.js';

export const DEFAULT_DOWNLOAD_LIMIT = 200 * 1024 * 1024;
const MAX_REDIRECTS = 5;

/** Address ranges that a download must never reach. */
const BLOCKED = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  BLOCKED.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  BLOCKED.addSubnet(net, prefix, 'ipv6');
}

/** "::ffff:7f00:1" or "::ffff:127.0.0.1" → "127.0.0.1"; null for other addresses. */
function mappedIPv4(address: string): string | null {
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (dotted) return dotted[1]!;
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(address);
  if (!hex) return null;
  const high = parseInt(hex[1]!, 16);
  const low = parseInt(hex[2]!, 16);
  return [high >> 8, high & 255, low >> 8, low & 255].join('.');
}

export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return BLOCKED.check(address, 'ipv4');
  if (family === 6) {
    const v4 = mappedIPv4(address);
    if (v4) return BLOCKED.check(v4, 'ipv4');
    return BLOCKED.check(address, 'ipv6');
  }
  return true;
}

export class DownloadError extends Error {
  override name = 'DownloadError';
}

export interface DownloadOptions {
  maxBytes?: number;
  timeoutMs?: number;
  /** For tests: resolve host names differently. */
  resolve?: (host: string) => Promise<string[]>;
  /** For tests only: addresses that are allowed even though they are private. */
  allowAddresses?: string[];
}

async function resolveHost(host: string, options: DownloadOptions): Promise<string> {
  const bare = host.replace(/^\[|\]$/g, '');
  const addresses = isIP(bare)
    ? [bare]
    : options.resolve
      ? await options.resolve(bare)
      : (await dnsLookup(bare, { all: true, verbatim: true })).map((a) => a.address);
  if (addresses.length === 0) throw new DownloadError(`Cannot resolve ${host}`);
  for (const address of addresses) {
    if (isBlockedAddress(address) && !options.allowAddresses?.includes(address)) {
      throw new DownloadError(
        `Refusing to download from ${host}: it points to a private or reserved address`,
      );
    }
  }
  return addresses[0]!;
}

function fileNameFor(url: URL, disposition: string | undefined, mime: string): string {
  let name = '';
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition ?? '');
  if (match) {
    try {
      name = decodeURIComponent(match[1]!);
    } catch {
      name = match[1]!;
    }
  }
  if (!name) name = decodeURIComponent(url.pathname.split('/').pop() ?? '') || 'download';
  name = name.split(/[\\/]/).pop()!;
  if (!mimeFromName(name)) {
    const ext: Record<string, string> = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/svg+xml': 'svg',
      'video/mp4': 'mp4',
      'video/webm': 'webm',
      'audio/mpeg': 'mp3',
      'audio/mp4': 'm4a',
      'audio/ogg': 'ogg',
      'audio/wav': 'wav',
      'text/vtt': 'vtt',
    };
    if (ext[mime]) name = `${name.replace(/\.[^.]*$/, '')}.${ext[mime]}`;
  }
  return name;
}

function get(url: URL, address: string, timeoutMs: number): Promise<IncomingMessage> {
  // Pin the connection to the checked address; keep the original host for TLS and Host header.
  const lookup: LookupFunction = (_host, opts, callback) => {
    const family = isIP(address);
    if (opts && typeof opts === 'object' && 'all' in opts && opts.all) {
      (callback as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [
        { address, family },
      ]);
    } else {
      callback(null, address, family);
    }
  };
  const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: 'GET',
        lookup,
        timeout: timeoutMs,
        headers: { 'user-agent': 'clipcourse-mcp', accept: 'image/*,video/*,audio/*,text/vtt' },
      },
      resolve,
    );
    req.on('timeout', () => req.destroy(new DownloadError('The download timed out')));
    req.on('error', reject);
    req.end();
  });
}

export async function downloadMedia(
  input: string,
  options: DownloadOptions = {},
): Promise<MediaFile> {
  const maxBytes = options.maxBytes ?? DEFAULT_DOWNLOAD_LIMIT;
  const timeoutMs = options.timeoutMs ?? 60000;
  const deadline = Date.now() + timeoutMs;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new DownloadError(`Invalid URL: ${input}`);
  }

  for (let redirects = 0; ; redirects++) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:')
      throw new DownloadError('Only http and https URLs are allowed');
    if (url.username || url.password)
      throw new DownloadError('URLs with credentials are not allowed');
    const address = await resolveHost(url.hostname, options);
    const response = await get(url, address, Math.max(1000, deadline - Date.now()));
    const status = response.statusCode ?? 0;

    if (status >= 300 && status < 400 && response.headers.location) {
      response.resume();
      if (redirects >= MAX_REDIRECTS) throw new DownloadError('Too many redirects');
      url = new URL(response.headers.location, url);
      continue;
    }
    if (status !== 200) {
      response.resume();
      throw new DownloadError(`The server answered with HTTP ${status}`);
    }

    const declared = Number(response.headers['content-length'] ?? 0);
    if (declared > maxBytes) {
      response.destroy();
      throw new DownloadError(
        `The file is too large (${Math.round(declared / 1e6)} MB, limit ${Math.round(maxBytes / 1e6)} MB)`,
      );
    }
    let mime = String(response.headers['content-type'] ?? '')
      .split(';')[0]!
      .trim()
      .toLowerCase();
    if (
      !mime ||
      mime === 'application/octet-stream' ||
      mime === 'binary/octet-stream' ||
      mime === 'text/plain'
    ) {
      mime = mimeFromName(url.pathname) ?? mime;
    }
    if (!kindFromMime(mime)) {
      response.destroy();
      throw new DownloadError(
        `Unsupported content type "${mime || 'unknown'}" (images, video, audio and .vtt captions are allowed)`,
      );
    }

    const chunks: Buffer[] = [];
    let size = 0;
    await new Promise<void>((resolve, reject) => {
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) {
          response.destroy(
            new DownloadError(`The file is too large (limit ${Math.round(maxBytes / 1e6)} MB)`),
          );
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', resolve);
      response.on('error', reject);
      response.on('close', () => {
        if (!response.complete) reject(new DownloadError('The download was interrupted'));
      });
    });
    const data = new Uint8Array(Buffer.concat(chunks));
    const fileName = fileNameFor(url, response.headers['content-disposition'], mime);
    const duration = mp4Duration(data);
    return { fileName, mime, data, ...(duration ? { duration } : {}) };
  }
}
