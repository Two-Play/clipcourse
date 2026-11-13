// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import { AssetPanel } from './components/AssetPanel.js';
import { ChapterPanel } from './components/ChapterPanel.js';
import { ExportDialog } from './components/ExportDialog.js';
import { Inspector } from './components/Inspector.js';
import { PreviewDialog } from './components/PreviewDialog.js';
import { StageView } from './components/StageView.js';
import { Timeline } from './components/Timeline.js';
import { Toolbar } from './components/Toolbar.js';
import { SessionProvider } from './context.js';
import { useAutosave, usePlayback, useShortcuts } from './hooks.js';
import { t } from './i18n.js';
import type { EditorSession } from './session.js';

export function App({ session, notice }: { session: EditorSession; notice?: string }) {
  const [preview, setPreview] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState<string | null>(notice ?? null);
  usePlayback(session);
  useShortcuts(session, !preview && !exporting);
  useAutosave(session);

  return (
    <SessionProvider session={session}>
      <div className="app">
        <Toolbar
          onPreview={() => {
            session.store.getState().setPlaying(false);
            setPreview(true);
          }}
          onExport={() => {
            session.store.getState().setPlaying(false);
            setExporting(true);
          }}
          onError={setMessage}
        />
        {message && (
          <div className="notice" role="status">
            <span>{message}</span>
            <button
              type="button"
              className="icon"
              aria-label="Dismiss"
              onClick={() => setMessage(null)}
            >
              ✕
            </button>
          </div>
        )}
        <main className="workspace">
          <div className="sidebar">
            <ChapterPanel onMessage={setMessage} />
            <AssetPanel />
          </div>
          <section className="stage-area" aria-label={t('stage')}>
            <StageView />
          </section>
          <Inspector />
        </main>
        <Timeline />
        <footer className="statusbar">{t('shortcuts')}</footer>
        {preview && <PreviewDialog onClose={() => setPreview(false)} />}
        {exporting && <ExportDialog onClose={() => setExporting(false)} />}
      </div>
    </SessionProvider>
  );
}
