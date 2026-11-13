// SPDX-License-Identifier: MIT
/**
 * Renders a question as an accessible form. Every kind works with the
 * keyboard alone: radio buttons and checkboxes, a text field, up/down
 * buttons for ordering (drag and drop as an extra for mice), select boxes
 * for matching, and labelled area buttons for hotspots.
 */
import type { Asset, Question } from '@clipcourse/format';
import { allowedAttempts, shuffled, type AnswerState, type Response } from '../core/quiz.js';
import { format, type PlayerStrings } from '../i18n.js';

export interface QuestionViewOptions {
  question: Question;
  state: AnswerState | undefined;
  strings: PlayerStrings;
  /** Resolves the hotspot image. */
  imageUrl: (asset: Asset, assetId: string) => string;
  assets: Record<string, Asset>;
  /** Static preview (editor): inputs disabled, no submit. */
  interactive: boolean;
  onSubmit?: (response: Response) => void;
  /** Shown once the question is done ("Continue", "Next question", …). */
  continueLabel?: string;
  onContinue?: () => void;
  /** Focus the feedback after rendering (after an attempt). */
  focusFeedback?: boolean;
}

let uid = 0;

export function renderQuestion(doc: Document, options: QuestionViewOptions): HTMLElement {
  const { question, state, strings, interactive } = options;
  const done = state?.done === true;
  const disabled = !interactive || done;
  const id = `ccq${++uid}`;
  const h = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string) => {
    const el = doc.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  };

  const form = h('form', 'ccp-q');
  form.dataset.questionId = question.id;
  form.noValidate = true;
  const fieldset = h('fieldset');
  const legend = h('legend', 'ccp-q-prompt', question.prompt);
  fieldset.append(legend);
  form.append(fieldset);

  /** Reads the current response from the form, or null if incomplete. */
  let read: () => Response | null = () => null;

  switch (question.kind) {
    case 'single':
    case 'multiple': {
      const multiple = question.kind === 'multiple';
      const list = h('div', 'ccp-q-choices');
      const selected = new Set(
        state?.response?.kind === 'single'
          ? [state.response.choice]
          : state?.response?.kind === 'multiple'
            ? state.response.choices
            : [],
      );
      for (const choice of question.choices) {
        const label = h('label', 'ccp-q-choice');
        const input = h('input');
        input.type = multiple ? 'checkbox' : 'radio';
        input.name = `${id}-choice`;
        input.value = choice.id;
        input.checked = selected.has(choice.id);
        input.disabled = disabled;
        label.append(input, h('span', '', choice.text));
        if (done && options.question.showSolution !== false) {
          const correct = multiple
            ? (question as { correct: string[] }).correct.includes(choice.id)
            : question.correct === choice.id;
          if (correct) label.classList.add('is-solution');
        }
        list.append(label);
      }
      if (multiple) fieldset.append(h('p', 'ccp-q-hint', strings.selectAll));
      fieldset.append(list);
      read = () => {
        const checked = [...list.querySelectorAll<HTMLInputElement>('input:checked')].map(
          (i) => i.value,
        );
        if (checked.length === 0) return null;
        return multiple
          ? { kind: 'multiple', choices: checked }
          : { kind: 'single', choice: checked[0]! };
      };
      break;
    }
    case 'text': {
      const label = h('label', 'ccp-q-textlabel', strings.yourAnswer);
      const input = h('input', 'ccp-q-text');
      input.type = 'text';
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.disabled = disabled;
      input.value = state?.response?.kind === 'text' ? state.response.text : '';
      label.append(input);
      fieldset.append(label);
      read = () => (input.value.trim() ? { kind: 'text', text: input.value } : null);
      if (done && !state?.correct && question.showSolution !== false) {
        fieldset.append(
          h('p', 'ccp-q-solution', format(strings.solution, { answer: question.answers[0]! })),
        );
      }
      break;
    }
    case 'order': {
      const list = h('ol', 'ccp-q-order');
      const initial =
        state?.response?.kind === 'order'
          ? state.response.items
              .map((itemId) => question.items.find((i) => i.id === itemId)!)
              .filter(Boolean)
          : shuffled(question.items, question.id);
      const order = done && question.showSolution !== false ? question.items : initial;
      const renderList = (focusId?: string, focusDirection?: 'up' | 'down') => {
        list.replaceChildren();
        current.forEach((item, index) => {
          const li = h('li', 'ccp-q-orderitem');
          li.dataset.itemId = item.id;
          li.draggable = !disabled;
          const text = h('span', 'ccp-q-ordertext', item.text);
          li.append(text);
          if (!disabled) {
            const up = h('button', 'ccp-q-move', '↑');
            up.type = 'button';
            up.setAttribute('aria-label', format(strings.moveUp, { item: item.text }));
            up.disabled = index === 0;
            up.addEventListener('click', () => move(index, -1, 'up'));
            const down = h('button', 'ccp-q-move', '↓');
            down.type = 'button';
            down.setAttribute('aria-label', format(strings.moveDown, { item: item.text }));
            down.disabled = index === current.length - 1;
            down.addEventListener('click', () => move(index, 1, 'down'));
            li.append(up, down);
            li.addEventListener('dragstart', (e) => {
              e.dataTransfer?.setData('text/plain', item.id);
              li.classList.add('is-dragging');
            });
            li.addEventListener('dragend', () => li.classList.remove('is-dragging'));
            li.addEventListener('dragover', (e) => e.preventDefault());
            li.addEventListener('drop', (e) => {
              e.preventDefault();
              const from = current.findIndex((i) => i.id === e.dataTransfer?.getData('text/plain'));
              if (from < 0 || from === index) return;
              const [moved] = current.splice(from, 1);
              current.splice(index, 0, moved!);
              renderList();
            });
          }
          list.append(li);
          if (item.id === focusId) {
            const target = li.querySelector<HTMLButtonElement>(
              `.ccp-q-move:nth-of-type(${focusDirection === 'up' ? 1 : 2})`,
            );
            (target && !target.disabled
              ? target
              : li.querySelector<HTMLButtonElement>('.ccp-q-move:not(:disabled)')
            )?.focus();
          }
        });
      };
      const current = [...order];
      const move = (index: number, delta: number, direction: 'up' | 'down') => {
        const [item] = current.splice(index, 1);
        current.splice(index + delta, 0, item!);
        renderList(item!.id, direction);
      };
      renderList();
      fieldset.append(list);
      read = () => ({ kind: 'order', items: current.map((i) => i.id) });
      break;
    }
    case 'match': {
      const rights = shuffled(question.pairs, question.id);
      const table = h('div', 'ccp-q-match');
      const given = state?.response?.kind === 'match' ? state.response.pairs : {};
      for (const pair of question.pairs) {
        const row = h('label', 'ccp-q-matchrow');
        const select = h('select');
        select.disabled = disabled;
        select.dataset.pairId = pair.id;
        const empty = h('option', '', strings.choose);
        empty.value = '';
        select.append(
          empty,
          ...rights.map((r) => {
            const option = h('option', '', r.right);
            option.value = r.id;
            return option;
          }),
        );
        select.value = done && question.showSolution !== false ? pair.id : (given[pair.id] ?? '');
        row.append(h('span', 'ccp-q-left', pair.left), select);
        table.append(row);
      }
      fieldset.append(table);
      read = () => {
        const pairs: Record<string, string> = {};
        for (const select of table.querySelectorAll('select')) {
          if (!select.value) return null;
          pairs[select.dataset.pairId!] = select.value;
        }
        return { kind: 'match', pairs };
      };
      break;
    }
    case 'hotspot': {
      const asset = options.assets[question.assetId];
      const box = h('div', 'ccp-q-hotspot');
      const img = h('img');
      if (asset) img.src = options.imageUrl(asset, question.assetId);
      img.alt = question.alt ?? asset?.alt ?? '';
      img.draggable = false;
      box.append(img);
      let point: { x: number; y: number } | null =
        state?.response?.kind === 'hotspot' ? { x: state.response.x, y: state.response.y } : null;
      const markerEl = h('span', 'ccp-q-pin');
      markerEl.setAttribute('aria-hidden', 'true');
      const placeMarker = () => {
        markerEl.hidden = !point;
        if (point) {
          markerEl.style.left = `${point.x * 100}%`;
          markerEl.style.top = `${point.y * 100}%`;
        }
      };
      box.append(markerEl);
      placeMarker();
      if (done && question.showSolution !== false) {
        for (const area of question.areas.filter((a) => question.correct.includes(a.id))) {
          const outline = h('span', 'ccp-q-area-solution');
          Object.assign(outline.style, {
            left: `${area.x * 100}%`,
            top: `${area.y * 100}%`,
            width: `${area.width * 100}%`,
            height: `${area.height * 100}%`,
          });
          box.append(outline);
        }
      }
      if (!disabled) {
        img.addEventListener('click', (e) => {
          const rect = img.getBoundingClientRect();
          point = {
            x: (e.clientX - rect.left) / rect.width,
            y: (e.clientY - rect.top) / rect.height,
          };
          placeMarker();
          submit.disabled = false;
        });
      }
      fieldset.append(box);
      // Keyboard alternative: pick one of the labelled areas.
      const areas = h('div', 'ccp-q-areas');
      areas.setAttribute('role', 'group');
      areas.setAttribute('aria-label', strings.hotspotAreas);
      for (const area of question.areas) {
        const button = h('button', 'ccp-q-areabtn', area.label);
        button.type = 'button';
        button.disabled = disabled;
        button.addEventListener('click', () => {
          point = { x: area.x + area.width / 2, y: area.y + area.height / 2 };
          placeMarker();
          areas
            .querySelectorAll('button')
            .forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
          submit.disabled = false;
        });
        areas.append(button);
      }
      fieldset.append(areas);
      read = () => (point ? { kind: 'hotspot', x: point.x, y: point.y } : null);
      break;
    }
  }

  // Feedback and actions.
  const feedback = h('div', 'ccp-q-feedback');
  feedback.setAttribute('role', 'status');
  feedback.tabIndex = -1;
  if (state && state.attempts > 0) {
    const max = allowedAttempts(question);
    const left = max > 0 ? max - state.attempts : null;
    let message = state.correct
      ? (question.feedback?.correct ?? strings.correct)
      : (question.feedback?.incorrect ?? strings.incorrect);
    if (!state.correct && !done && left !== null)
      message += ` ${format(strings.attemptsLeft, { count: left })}`;
    if (!state.correct && !done && left === null) message += ` ${strings.tryAgain}`;
    feedback.textContent = message;
    feedback.classList.add(state.correct ? 'is-correct' : 'is-incorrect');
  }
  form.append(feedback);

  const actions = h('div', 'ccp-q-actions');
  const submit = h('button', 'ccp-q-submit', strings.checkAnswer);
  submit.type = 'submit';
  submit.hidden = done || !interactive;
  actions.append(submit);
  if (done && options.continueLabel && options.onContinue) {
    const next = h('button', 'ccp-q-continue', options.continueLabel);
    next.type = 'button';
    next.addEventListener('click', () => options.onContinue!());
    actions.append(next);
  }
  form.append(actions);

  const update = () => {
    if (question.kind !== 'order' && question.kind !== 'hotspot') submit.disabled = read() === null;
    if (question.kind === 'hotspot') submit.disabled = read() === null;
  };
  form.addEventListener('input', update);
  form.addEventListener('change', update);
  update();

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (disabled) return;
    const response = read();
    if (response) options.onSubmit?.(response);
  });
  // Keys inside the form must not reach the player's shortcuts.
  form.addEventListener('keydown', (event) => event.stopPropagation());

  if (options.focusFeedback) {
    queueMicrotask(() => {
      const target =
        form.querySelector<HTMLElement>('.ccp-q-continue') ??
        (feedback.textContent ? feedback : null);
      target?.focus();
    });
  }
  return form;
}
