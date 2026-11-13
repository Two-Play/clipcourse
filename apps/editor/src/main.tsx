// SPDX-License-Identifier: AGPL-3.0-only
import { createEmptyCourse } from '@clipcourse/editor-core';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { t } from './i18n.js';
import { createBrowserStorage } from './platform/browser.js';
import { EditorSession } from './session.js';
import './styles.css';

declare global {
  interface Window {
    __session?: EditorSession;
  }
}

async function start() {
  const storage = createBrowserStorage();
  const params = new URLSearchParams(location.search);
  if (params.has('fresh')) await storage.clearDraft().catch(() => {});
  const draft = await storage.loadDraft();
  const session = new EditorSession(createEmptyCourse(), storage);
  if (draft) session.load(draft);
  window.__session = session;
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App session={session} {...(draft ? { notice: t('draftRestored') } : {})} />
    </StrictMode>,
  );
}

void start();
