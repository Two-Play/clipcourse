// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Development/test page that behaves like a minimal LMS: it exposes the
 * SCORM API on its window and launches the package at /pkg/index.html in an
 * iframe. LMS data survives reloads (sessionStorage), so relaunching tests
 * resume. Not part of the production build.
 */
import {
  createLmsRecord,
  createMockLms,
  type LmsRecord,
  type MockLms,
} from '@clipcourse/scorm-runtime/testing';

declare global {
  interface Window {
    lms?: MockLms<unknown>;
  }
}

const params = new URLSearchParams(location.search);
const version = params.get('version') === '2004' ? '2004' : '1.2';
const KEY = `lms-harness:${version}`;

let record: LmsRecord = createLmsRecord();
try {
  const stored = sessionStorage.getItem(KEY);
  if (stored) record = JSON.parse(stored) as LmsRecord;
} catch {
  // start fresh
}

const lms = createMockLms(version, record) as MockLms<unknown>;
lms.onChange = () => {
  sessionStorage.setItem(KEY, JSON.stringify(lms.record));
  document.getElementById('info')!.textContent = `SCORM ${version} · ${lms.state} · status ${
    lms.values[version === '1.2' ? 'cmi.core.lesson_status' : 'cmi.completion_status'] ?? '?'
  }`;
};
window.lms = lms;
if (version === '1.2') (window as unknown as { API: unknown }).API = lms.api;
else (window as unknown as { API_1484_11: unknown }).API_1484_11 = lms.api;

(document.getElementById('sco') as HTMLIFrameElement).src = '/pkg/index.html';
