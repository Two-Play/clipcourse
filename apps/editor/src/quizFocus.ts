// SPDX-License-Identifier: AGPL-3.0-only
/** Which quiz question the inspector is editing, so the stage can preview it. */
import { useSyncExternalStore } from 'react';

let current: string | null = null;
const listeners = new Set<() => void>();

export function setQuizFocus(questionId: string | null) {
  if (current === questionId) return;
  current = questionId;
  for (const listener of listeners) listener();
}

export function useQuizFocus(): string | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}
