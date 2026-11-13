// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Path safety: the server only touches files inside the configured root
 * folders. Paths are resolved with realpath, so neither ".." nor symlinks
 * can escape a root.
 */
import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

export class PathError extends Error {
  override name = 'PathError';
}

/** Canonical absolute paths of the roots (they must exist). */
export function normalizeRoots(roots: readonly string[]): string[] {
  if (roots.length === 0) throw new PathError('At least one root folder is required (--root)');
  return roots.map((root) => {
    const absolute = resolve(root);
    if (!existsSync(absolute)) throw new PathError(`Root folder does not exist: ${absolute}`);
    return realpathSync(absolute);
  });
}

function isInside(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** realpath of the deepest existing ancestor, plus the not-yet-existing rest. */
function canonical(path: string): string {
  let existing = path;
  const rest: string[] = [];
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) break;
    rest.unshift(existing.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)));
    existing = parent;
  }
  const base = existsSync(existing) ? realpathSync(existing) : existing;
  return rest.length ? resolve(base, ...rest) : base;
}

/**
 * Resolves a user-supplied path (absolute, or relative to the first root)
 * and checks that it stays inside one of the roots.
 */
export function resolveInRoots(roots: readonly string[], path: string): string {
  if (!path || path.includes('\0')) throw new PathError('Invalid path');
  const absolute = isAbsolute(path) ? resolve(path) : resolve(roots[0]!, path);
  const real = canonical(absolute);
  if (!roots.some((root) => isInside(real, root))) {
    throw new PathError(
      `Access denied: ${path} is outside the allowed folders (${roots.join(', ')})`,
    );
  }
  return real;
}

/** Display form: relative to the root it is in. */
export function displayPath(roots: readonly string[], path: string): string {
  const root = roots.find((r) => isInside(path, r));
  if (!root) return path;
  const rel = relative(root, path);
  return roots.length > 1 ? `${root}${sep}${rel}` : rel || '.';
}
