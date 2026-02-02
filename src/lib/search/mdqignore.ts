import path from 'node:path';
import { Minimatch } from 'minimatch';

/**
 * Parse .mdqignore file contents into ignore patterns.
 * Supports gitignore-style syntax:
 * - Lines starting with # are comments
 * - Blank lines are ignored
 * - Patterns can use glob syntax (*, **, ?, etc.)
 * - Patterns ending with / match directories only
 * - ! prefix negates a pattern (includes previously excluded files)
 */
export function parseMdqignore(content: string): string[] {
	const lines = content.split('\n');
	const patterns: string[] = [];

	for (let line of lines) {
		// Trim whitespace
		line = line.trim();

		// Skip comments and empty lines
		if (line === '' || line.startsWith('#')) {
			continue;
		}

		patterns.push(line);
	}

	return patterns;
}

/**
 * Read .mdqignore file from base directory.
 * Returns patterns, or empty array if file doesn't exist.
 */
export async function readMdqignore(basePath: string): Promise<string[]> {
	const mdqignorePath = path.join(basePath, '.mdqignore');

	try {
		const file = Bun.file(mdqignorePath);
		if (!(await file.exists())) {
			return [];
		}

		const content = await file.text();
		return parseMdqignore(content);
	} catch {
		// If we can't read the file, treat it as empty
		return [];
	}
}

/**
 * Check if a file path should be ignored based on .mdqignore patterns.
 * Paths should be relative to the base directory.
 *
 * @param relativePath - Path relative to base directory (e.g., "docs/README.md")
 * @param patterns - Array of ignore patterns from .mdqignore
 * @returns true if the file should be ignored
 */
export function shouldIgnore(relativePath: string, patterns: string[]): boolean {
	// Always ignore .mdqignore itself
	if (relativePath === '.mdqignore') {
		return true;
	}

	// Track whether file is currently ignored
	let ignored = false;

	for (let pattern of patterns) {
		// Handle negation patterns (!)
		const isNegation = pattern.startsWith('!');
		if (isNegation) {
			pattern = pattern.slice(1);
		}

		// Handle directory patterns (ending with /)
		// Convert "dir/" to "dir/**" to match all files in directory
		if (pattern.endsWith('/')) {
			pattern = `${pattern}**`;
		}

		const matcher = new Minimatch(pattern, {
			dot: true, // Match files starting with .
			matchBase: false, // Don't match basename only
		});

		if (matcher.match(relativePath)) {
			ignored = !isNegation;
		}
	}

	return ignored;
}

/**
 * Filter a list of file paths based on .mdqignore patterns.
 * All paths should be relative to the base directory.
 *
 * @param files - Array of relative file paths
 * @param patterns - Array of ignore patterns from .mdqignore
 * @returns Filtered array of files that should NOT be ignored
 */
export function filterIgnored(files: string[], patterns: string[]): string[] {
	if (patterns.length === 0) {
		// Optimization: still need to filter .mdqignore itself
		return files.filter((file) => file !== '.mdqignore');
	}

	return files.filter((file) => !shouldIgnore(file, patterns));
}
