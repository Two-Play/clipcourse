// SPDX-License-Identifier: AGPL-3.0-only
/** Media library: import files, drag them onto the timeline or add at the playhead. */
import { assetUsage, removeAsset } from '@clipcourse/editor-core';
import { useState } from 'react';
import { addAssetClip } from '../actions.js';
import { useEditor, useFilesVersion, useSession } from '../context.js';
import { t } from '../i18n.js';
import { probeMediaDuration } from '../session.js';
import { ASSET_MIME } from './Timeline.js';

const ACCEPT = 'image/*,video/*,audio/*,.vtt,text/vtt';
const ICON: Record<string, string> = { image: '🖼', video: '🎬', audio: '🔈', captions: 'CC' };

export function AssetPanel() {
  const session = useSession();
  const assets = useEditor((s) => s.course.assets);
  const course = useEditor((s) => s.course);
  useFilesVersion();
  const [errors, setErrors] = useState<string[]>([]);

  const importFiles = async (files: { name: string; mime: string; data: Uint8Array }[]) => {
    const result = await session.importFiles(files, probeMediaDuration);
    setErrors(result.errors);
  };

  const pick = async () => importFiles(await session.storage.pickFiles(ACCEPT));

  return (
    <aside
      className="assets"
      aria-label={t('assets')}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault();
      }}
      onDrop={async (e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        const files = await Promise.all(
          [...e.dataTransfer.files].map(async (f) => ({
            name: f.name,
            mime: f.type,
            data: new Uint8Array(await f.arrayBuffer()),
          })),
        );
        await importFiles(files);
      }}
    >
      <div className="panel-title">
        <h2>{t('assets')}</h2>
        <button type="button" onClick={pick}>
          {t('importMedia')}
        </button>
      </div>
      {errors.length > 0 && (
        <div className="notice notice-error" role="alert">
          {t('importFailed')}
          <ul>
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      {Object.keys(assets).length === 0 ? (
        <p className="muted">{t('noAssets')}</p>
      ) : (
        <ul className="asset-list">
          {Object.entries(assets).map(([id, asset]) => {
            const name = asset.src.split('/').pop() ?? id;
            const thumb = asset.kind === 'image' ? session.urls.get(asset) : '';
            const inUse = assetUsage(course, id).length > 0;
            const placeable = asset.kind !== 'captions';
            return (
              <li
                key={id}
                className="asset"
                draggable={placeable}
                onDragStart={(e) => {
                  e.dataTransfer.setData(ASSET_MIME, id);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                data-asset-id={id}
              >
                <span className="asset-thumb" aria-hidden="true">
                  {thumb ? <img src={thumb} alt="" /> : ICON[asset.kind]}
                </span>
                <span className="asset-name" title={asset.src}>
                  {name}
                  {asset.duration ? <small> · {(asset.duration / 1000).toFixed(1)} s</small> : null}
                </span>
                {placeable && (
                  <button
                    type="button"
                    className="icon"
                    aria-label={`Add ${name} at playhead`}
                    title="Add at playhead"
                    onClick={() => addAssetClip(session, id)}
                  >
                    ＋
                  </button>
                )}
                <button
                  type="button"
                  className="icon"
                  aria-label={`Remove ${name}`}
                  title={inUse ? 'In use' : 'Remove'}
                  disabled={inUse}
                  onClick={() => session.store.getState().execute('Remove media', removeAsset(id))}
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
