import os from 'node:os';
import path from 'node:path';

/**
 * Expand leading ~ to user's home directory.
 * Handles `~` and `~/path` but not:
 *   - `~user/path` (different user's home - not supported)
 *   - `foo/~/bar` (~ in middle of path - not expanded)
 */
export function expandTilde(p: string): string {
	if (p === '~') return os.homedir();
	if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
	return p;
}
