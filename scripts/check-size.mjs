// SPDX-License-Identifier: AGPL-3.0-only
// Fails if a built file's gzip size exceeds a budget: node check-size.mjs <file> <maxGzipBytes>
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const [file, max] = process.argv.slice(2);
if (!file || !max) {
  console.error('usage: check-size.mjs <file> <maxGzipBytes>');
  process.exit(2);
}
const raw = readFileSync(file);
const gz = gzipSync(raw, { level: 9 }).length;
const ok = gz <= Number(max);
console.log(`${file}: ${raw.length} B raw, ${gz} B gzip (budget ${max} B) ${ok ? 'OK' : 'TOO LARGE'}`);
process.exit(ok ? 0 : 1);
