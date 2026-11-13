// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Course stage format: presets (16:9, 4:3, 1:1, 9:16) or a custom size.
 * Changing it scales every clip (one undo step).
 */
import { setStageSize, STAGE_PRESETS } from '@clipcourse/editor-core';
import { useId, useState } from 'react';
import { useEditor, useSession } from '../context.js';
import { t } from '../i18n.js';

export function applyStageSize(
  session: ReturnType<typeof useSession>,
  width: number,
  height: number,
) {
  if (session.run('Stage format', setStageSize(width, height)))
    session.notify(t('stageScaled', { width: Math.round(width), height: Math.round(height) }));
}

export function StageFormatField() {
  const session = useSession();
  const stage = useEditor((s) => s.course.stage);
  const id = useId();
  const preset = STAGE_PRESETS.find((p) => p.width === stage.width && p.height === stage.height);
  const [custom, setCustom] = useState(!preset);
  const [size, setSize] = useState({ width: stage.width, height: stage.height });

  return (
    <div className="field stage-format">
      <label htmlFor={id}>{t('stageFormat')}</label>
      <select
        id={id}
        value={custom ? 'custom' : (preset?.id ?? 'custom')}
        onChange={(e) => {
          const p = STAGE_PRESETS.find((x) => x.id === e.target.value);
          if (p) {
            setCustom(false);
            applyStageSize(session, p.width, p.height);
          } else {
            setCustom(true);
            setSize({ width: stage.width, height: stage.height });
          }
        }}
      >
        {STAGE_PRESETS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} ({p.width}×{p.height})
          </option>
        ))}
        <option value="custom">{t('stageCustom')}</option>
      </select>
      {custom && (
        <div className="stage-format-custom">
          <label>
            {t('stageWidth')}
            <input
              type="number"
              min={16}
              max={8192}
              value={size.width}
              onChange={(e) => setSize((s) => ({ ...s, width: Number(e.target.value) }))}
            />
          </label>
          <label>
            {t('stageHeight')}
            <input
              type="number"
              min={16}
              max={8192}
              value={size.height}
              onChange={(e) => setSize((s) => ({ ...s, height: Number(e.target.value) }))}
            />
          </label>
          <button type="button" onClick={() => applyStageSize(session, size.width, size.height)}>
            {t('stageApply')}
          </button>
        </div>
      )}
    </div>
  );
}
