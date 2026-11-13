// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { downloadMedia, isBlockedAddress, type DownloadOptions } from '../src/download.js';

const mp4 = readFileSync(
  fileURLToPath(new URL('../../../examples/welcome/assets/testpattern.mp4', import.meta.url)),
);
let server: Server;
let port: number;

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = req.url ?? '/';
    if (path === '/video') {
      res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': mp4.length });
      res.end(mp4);
    } else if (path === '/named') {
      res.writeHead(200, {
        'content-type': 'image/png',
        'content-disposition': 'attachment; filename="Pretty Picture.png"',
      });
      res.end(Buffer.from([1, 2, 3]));
    } else if (path === '/noext') {
      res.writeHead(200, { 'content-type': 'image/jpeg' });
      res.end(Buffer.from([1]));
    } else if (path === '/html') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<script>');
    } else if (path === '/big') {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(Buffer.alloc(5000));
    } else if (path === '/redirect') {
      res.writeHead(302, { location: '/video' });
      res.end();
    } else if (path === '/to-internal') {
      res.writeHead(302, { location: 'http://internal.test/secret.png' });
      res.end();
    } else if (path === '/loop') {
      res.writeHead(302, { location: '/loop' });
      res.end();
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as { port: number }).port;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

// "media.test" stands for a public host; it resolves to the local test server.
const options: DownloadOptions = {
  resolve: async (host) =>
    host === 'media.test' ? ['127.0.0.1'] : host === 'internal.test' ? ['10.1.2.3'] : [],
  allowAddresses: ['127.0.0.1'],
};
const url = (path: string) => `http://media.test:${port}${path}`;

describe('downloadMedia', () => {
  test('downloads video with duration', async () => {
    const file = await downloadMedia(url('/video'), options);
    expect(file).toMatchObject({ fileName: 'video.mp4', mime: 'video/mp4', duration: 8000 });
    expect(file.data.length).toBe(mp4.length);
  });

  test('uses Content-Disposition names and adds missing extensions', async () => {
    expect((await downloadMedia(url('/named'), options)).fileName).toBe('Pretty Picture.png');
    expect((await downloadMedia(url('/noext'), options)).fileName).toBe('noext.jpg');
  });

  test('follows redirects, but not too many', async () => {
    expect((await downloadMedia(url('/redirect'), options)).mime).toBe('video/mp4');
    await expect(downloadMedia(url('/loop'), options)).rejects.toThrow(/Too many redirects/);
  });

  test('refuses private targets, also behind redirects', async () => {
    await expect(downloadMedia(url('/to-internal'), options)).rejects.toThrow(
      /private or reserved/,
    );
    await expect(downloadMedia(`http://127.0.0.1:${port}/video`)).rejects.toThrow(
      /private or reserved/,
    );
    await expect(downloadMedia('http://[::1]/x.png')).rejects.toThrow(/private or reserved/);
    await expect(downloadMedia('http://169.254.169.254/latest/meta-data')).rejects.toThrow(
      /private or reserved/,
    );
  });

  test('refuses other schemes, credentials, wrong types and oversized files', async () => {
    await expect(downloadMedia('file:///etc/passwd', options)).rejects.toThrow(/Only http/);
    await expect(downloadMedia(`http://user:pw@media.test:${port}/video`, options)).rejects.toThrow(
      /credentials/,
    );
    await expect(downloadMedia(url('/html'), options)).rejects.toThrow(
      /Unsupported content type "text\/html"/,
    );
    await expect(downloadMedia(url('/big'), { ...options, maxBytes: 1000 })).rejects.toThrow(
      /too large/,
    );
    await expect(downloadMedia(url('/missing'), options)).rejects.toThrow(/HTTP 404/);
  });
});

test.each([
  ['127.0.0.1', true],
  ['10.0.0.1', true],
  ['172.20.1.1', true],
  ['192.168.1.1', true],
  ['169.254.169.254', true],
  ['100.64.0.1', true],
  ['0.0.0.0', true],
  ['::1', true],
  ['fe80::1', true],
  ['fd00::1', true],
  ['::ffff:127.0.0.1', true],
  ['::ffff:7f00:1', true],
  ['not-an-ip', true],
  ['93.184.216.34', false],
  ['2606:2800:220:1:248:1893:25c8:1946', false],
])('isBlockedAddress(%s) = %s', (address, blocked) => {
  expect(isBlockedAddress(address)).toBe(blocked);
});
