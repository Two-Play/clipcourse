// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Course-wide content in the sidebar: popups (opened by click actions) and
 * the glossary (terms marked in text clips). One item is edited at a time.
 */
import {
  addGlossaryEntry,
  addPopup,
  removeGlossaryEntry,
  removePopup,
  updateGlossaryEntry,
  updatePopup,
} from '@clipcourse/editor-core';
import { BookA, MessageSquareText, Plus, Trash2 } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { useEditor, useSession } from '../context.js';
import { t } from '../i18n.js';

function Row({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children(id)}
    </div>
  );
}

function ItemList<T extends { id: string }>({
  items,
  label,
  open,
  onOpen,
  onDelete,
  name,
}: {
  items: T[];
  label: string;
  open: string | null;
  onOpen: (id: string | null) => void;
  onDelete: (id: string) => void;
  name: (item: T) => string;
}) {
  return (
    <ul className="side-list" aria-label={label}>
      {items.map((item) => (
        <li key={item.id} className={item.id === open ? 'is-open' : ''}>
          <button
            type="button"
            className="side-list-item"
            aria-expanded={item.id === open}
            onClick={() => onOpen(item.id === open ? null : item.id)}
          >
            {name(item)}
          </button>
          <button
            type="button"
            className="icon"
            aria-label={`${t('delete')}: ${name(item)}`}
            title={t('delete')}
            onClick={() => onDelete(item.id)}
          >
            <Trash2 size={14} aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}

export function PopupPanel() {
  const session = useSession();
  const popups = useEditor((s) => s.course.popups) ?? [];
  const assets = useEditor((s) => s.course.assets);
  const [open, setOpen] = useState<string | null>(null);
  const current = popups.find((p) => p.id === open);
  const images = Object.entries(assets).filter(([, a]) => a.kind === 'image');
  const edit = (field: string, props: Parameters<typeof updatePopup>[1]) =>
    current &&
    session.run('Edit popup', updatePopup(current.id, props), {
      mergeKey: `popup:${current.id}:${field}`,
    });

  return (
    <section className="side-panel" aria-labelledby="popups-title">
      <div className="panel-title">
        <h2 id="popups-title">
          <MessageSquareText size={14} aria-hidden /> {t('popups')}
        </h2>
        <button
          type="button"
          className="icon-button"
          onClick={() => {
            const id = session.newId('popup');
            session.run(
              'Add popup',
              addPopup({ id, title: t('newPopupTitle'), text: t('newPopupText') }),
            );
            setOpen(id);
          }}
        >
          <Plus size={14} aria-hidden /> {t('addPopup')}
        </button>
      </div>
      <ItemList
        items={popups}
        label={t('popups')}
        open={open}
        onOpen={setOpen}
        onDelete={(id) => session.run('Delete popup', removePopup(id))}
        name={(p) => p.title}
      />
      {current && (
        <div className="side-editor" key={current.id}>
          <Row label={t('popupTitle')}>
            {(id) => (
              <input
                id={id}
                type="text"
                value={current.title}
                onChange={(e) => e.target.value.trim() && edit('title', { title: e.target.value })}
              />
            )}
          </Row>
          <Row label={t('popupText')}>
            {(id) => (
              <textarea
                id={id}
                rows={4}
                value={current.text}
                onChange={(e) => edit('text', { text: e.target.value })}
              />
            )}
          </Row>
          <Row label={t('popupImage')}>
            {(id) => (
              <select
                id={id}
                value={current.assetId ?? ''}
                onChange={(e) => edit('image', { assetId: e.target.value || null })}
              >
                <option value="">{t('none')}</option>
                {images.map(([assetId, asset]) => (
                  <option key={assetId} value={assetId}>
                    {asset.src.split('/').pop()}
                  </option>
                ))}
              </select>
            )}
          </Row>
          {current.assetId && (
            <Row label={t('altText')}>
              {(id) => (
                <input
                  id={id}
                  type="text"
                  value={current.alt ?? assets[current.assetId!]?.alt ?? ''}
                  onChange={(e) => edit('alt', { alt: e.target.value })}
                />
              )}
            </Row>
          )}
        </div>
      )}
    </section>
  );
}

export function GlossaryPanel() {
  const session = useSession();
  const glossary = useEditor((s) => s.course.glossary) ?? [];
  const [open, setOpen] = useState<string | null>(null);
  const current = glossary.find((g) => g.id === open);
  const edit = (field: string, props: Parameters<typeof updateGlossaryEntry>[1]) =>
    current &&
    session.run('Edit term', updateGlossaryEntry(current.id, props), {
      mergeKey: `term:${current.id}:${field}`,
    });

  return (
    <section className="side-panel" aria-labelledby="glossary-title">
      <div className="panel-title">
        <h2 id="glossary-title">
          <BookA size={14} aria-hidden /> {t('glossary')}
        </h2>
        <button
          type="button"
          className="icon-button"
          onClick={() => {
            const id = session.newId('term');
            session.run(
              'Add term',
              addGlossaryEntry({ id, term: t('newTerm'), definition: t('newDefinition') }),
            );
            setOpen(id);
          }}
        >
          <Plus size={14} aria-hidden /> {t('addTerm')}
        </button>
      </div>
      {glossary.length === 0 && <p className="field-hint">{t('glossaryHint')}</p>}
      <ItemList
        items={[...glossary].sort((a, b) => a.term.localeCompare(b.term))}
        label={t('glossary')}
        open={open}
        onOpen={setOpen}
        onDelete={(id) => session.run('Delete term', removeGlossaryEntry(id))}
        name={(g) => g.term}
      />
      {current && (
        <div className="side-editor" key={current.id}>
          <Row label={t('term')}>
            {(id) => (
              <input
                id={id}
                type="text"
                value={current.term}
                onChange={(e) => e.target.value.trim() && edit('term', { term: e.target.value })}
              />
            )}
          </Row>
          <Row label={t('termVariants')}>
            {(id) => (
              <input
                id={id}
                type="text"
                defaultValue={(current.variants ?? []).join(', ')}
                onBlur={(e) =>
                  edit('variants', {
                    variants: e.target.value
                      .split(',')
                      .map((v) => v.trim())
                      .filter(Boolean),
                  })
                }
              />
            )}
          </Row>
          <Row label={t('definition')}>
            {(id) => (
              <textarea
                id={id}
                rows={3}
                value={current.definition}
                onChange={(e) =>
                  e.target.value.trim() && edit('definition', { definition: e.target.value })
                }
              />
            )}
          </Row>
        </div>
      )}
    </section>
  );
}
