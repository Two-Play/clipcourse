// SPDX-License-Identifier: AGPL-3.0-only
import type { EditorActions, EditorState } from '@clipcourse/editor-core';
import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import { useStore } from 'zustand';
import type { EditorSession } from './session.js';

const SessionContext = createContext<EditorSession | null>(null);

export function SessionProvider({
  session,
  children,
}: {
  session: EditorSession;
  children: ReactNode;
}) {
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

export function useSession(): EditorSession {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession outside SessionProvider');
  return session;
}

/** Subscribes to a slice of the editor state. */
export function useEditor<T>(selector: (state: EditorState & EditorActions) => T): T {
  return useStore(useSession().store, selector);
}

/** Re-renders when project files change (import, open). */
export function useFilesVersion(): number {
  const session = useSession();
  return useSyncExternalStore(
    (cb) => session.subscribeFiles(cb),
    () => session.fileVersion,
  );
}
