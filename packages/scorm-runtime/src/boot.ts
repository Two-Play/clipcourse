// SPDX-License-Identifier: MIT
/**
 * Entry point of an exported course (index.html loads course.js, then this
 * script). course.js sets `window.CLIPCOURSE` before this runs.
 */
import type { Course } from '@clipcourse/format';
import type { ScormVersion } from './api.js';
import { runCourse } from './course.js';

interface Bootstrap {
  course: Course;
  scormVersion: ScormVersion | 'auto';
}

declare global {
  interface Window {
    CLIPCOURSE?: Bootstrap;
  }
}

function boot() {
  const data = window.CLIPCOURSE;
  const container = document.getElementById('clipcourse');
  if (!data || !container) {
    document.body.textContent = 'This course could not be started (missing course data).';
    return;
  }
  const running = runCourse(container, data.course, { scormVersion: data.scormVersion });
  (window as unknown as { clipcourse: typeof running }).clipcourse = running;
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
