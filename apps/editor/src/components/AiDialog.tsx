// SPDX-License-Identifier: AGPL-3.0-only
/** Pairing dialog for the AI assistant (MCP live bridge). */
import { Bot, Unplug } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { DEFAULT_BRIDGE_URL, type AiBridge } from '../ai-bridge.js';
import { t } from '../i18n.js';

export function useBridgeStatus(bridge: AiBridge) {
  return useSyncExternalStore(
    (cb) => bridge.onStatus(cb),
    () => bridge.status,
  );
}

export function AiDialog({ bridge, onClose }: { bridge: AiBridge; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [code, setCode] = useState('');
  const [url, setUrl] = useState(DEFAULT_BRIDGE_URL);
  const status = useBridgeStatus(bridge);

  useEffect(() => {
    dialogRef.current!.showModal();
  }, []);

  useEffect(() => {
    if (status.state === 'connected') onClose();
  }, [status, onClose]);

  return (
    <dialog
      ref={dialogRef}
      className="export ai-dialog"
      aria-labelledby="ai-title"
      onClose={onClose}
      onCancel={onClose}
    >
      <h2 id="ai-title">{t('aiTitle')}</h2>
      <p>{t('aiExplain')}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          bridge.connect(code.trim(), url.trim());
        }}
      >
        <div className="field">
          <label htmlFor="ai-code">{t('aiCode')}</label>
          <input
            id="ai-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            autoFocus
          />
        </div>
        <details>
          <summary>{t('advanced')}</summary>
          <div className="field">
            <label htmlFor="ai-url">{t('aiAddress')}</label>
            <input id="ai-url" value={url} onChange={(e) => setUrl(e.target.value)} />
          </div>
        </details>
        <p className="muted">{t('aiPrivacy')}</p>
        {status.state === 'error' && (
          <div className="notice notice-error" role="alert">
            {status.message}
          </div>
        )}
        <div className="dialog-buttons">
          <button type="button" onClick={onClose}>
            {t('close')}
          </button>
          <button
            type="submit"
            className="primary"
            disabled={code.length !== 6 || status.state === 'connecting'}
          >
            {status.state === 'connecting' ? t('aiConnecting') : t('aiConnect')}
          </button>
        </div>
      </form>
    </dialog>
  );
}

/** Status line shown while an assistant is connected. */
export function AiStatus({ bridge }: { bridge: AiBridge }) {
  const status = useBridgeStatus(bridge);
  if (status.state !== 'connected') return null;
  return (
    <div className="ai-status" role="status">
      <Bot size={16} aria-hidden />
      <span>
        {t('aiConnected', { id: status.id })}
        {status.lastAction ? ` · ${status.lastAction}` : ''}
      </span>
      <button type="button" className="icon-button" onClick={() => bridge.disconnect()}>
        <Unplug size={14} aria-hidden /> {t('aiDisconnect')}
      </button>
    </div>
  );
}
