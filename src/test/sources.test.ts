import { describe, expect, test } from 'bun:test';
import os from 'node:os';
import path from 'node:path';
import { parseSourceArg, parseSources } from '../lib/mcp/sources.js';

describe('parseSourceArg', () => {
	test('derives name from directory basename', () => {
		const result = parseSourceArg('/home/user/docs/confluence');
		expect(result.name).toBe('confluence');
		expect(result.path).toBe('/home/user/docs/confluence');
	});

	test('handles explicit name:path syntax', () => {
		const result = parseSourceArg('notes:/home/user/my-notes');
		expect(result.name).toBe('notes');
		expect(result.path).toBe('/home/user/my-notes');
	});

	test('normalizes name to lowercase', () => {
		const result = parseSourceArg('MyNotes:/home/user/notes');
		expect(result.name).toBe('mynotes');
	});

	test('resolves relative paths', () => {
		const result = parseSourceArg('./docs');
		expect(result.name).toBe('docs');
		expect(result.path).toBe(path.resolve('./docs'));
	});

	test('handles Windows-style paths with backslash (C:\\)', () => {
		// On non-Windows, path.resolve will handle this differently,
		// but the key is that C: is recognized as a drive letter, not a name
		const result = parseSourceArg('C:\\Users\\docs');
		// Should not treat 'C' as the name
		expect(result.name).not.toBe('c');
	});

	test('handles Windows-style paths with forward slash (C:/)', () => {
		const result = parseSourceArg('C:/Users/docs');
		// Should not treat 'C' as the name
		expect(result.name).not.toBe('c');
	});

	test('handles Windows path with description', () => {
		const result = parseSourceArg('C:/Users/docs|My documents');
		// Should not treat 'C' as the name
		expect(result.name).not.toBe('c');
		expect(result.description).toBe('My documents');
	});

	test('handles path with colons in directory name', () => {
		// name:path where path contains colons
		const result = parseSourceArg('docs:/home/user/foo:bar');
		expect(result.name).toBe('docs');
		// Only the first colon is used as separator
		expect(result.path).toBe(path.resolve('/home/user/foo:bar'));
	});

	test('handles unicode in names', () => {
		const result = parseSourceArg('日本語:/home/user/docs');
		expect(result.name).toBe('日本語');
		expect(result.path).toBe('/home/user/docs');
	});

	test('handles unicode in paths', () => {
		const result = parseSourceArg('/home/user/документы');
		expect(result.name).toBe('документы');
	});

	test('parses description with pipe delimiter', () => {
		const result = parseSourceArg('notes:/home/user/notes|Personal journal and ideas');
		expect(result.name).toBe('notes');
		expect(result.path).toBe('/home/user/notes');
		expect(result.description).toBe('Personal journal and ideas');
	});

	test('parses description with derived name', () => {
		const result = parseSourceArg('/home/user/wiki|Team knowledge base');
		expect(result.name).toBe('wiki');
		expect(result.path).toBe('/home/user/wiki');
		expect(result.description).toBe('Team knowledge base');
	});

	test('handles description with colons', () => {
		const result = parseSourceArg('wiki:/docs/wiki|Team wiki: docs and runbooks');
		expect(result.name).toBe('wiki');
		expect(result.path).toBe('/docs/wiki');
		expect(result.description).toBe('Team wiki: docs and runbooks');
	});

	test('trims whitespace from description', () => {
		const result = parseSourceArg('notes:/docs|  Spaced description  ');
		expect(result.description).toBe('Spaced description');
	});

	test('returns undefined for empty description', () => {
		const result = parseSourceArg('notes:/docs|');
		expect(result.description).toBeUndefined();
	});

	test('returns undefined for whitespace-only description', () => {
		const result = parseSourceArg('notes:/docs|   ');
		expect(result.description).toBeUndefined();
	});

	test('treats pipe in path as description delimiter (limitation)', () => {
		// NOTE: | is reserved for descriptions and cannot be used in paths
		// If a path contains |, everything after it is treated as description
		const result = parseSourceArg('/home/user/notes|archive');
		expect(result.path).toBe('/home/user/notes');
		expect(result.description).toBe('archive');
	});

	test('returns undefined when no description provided', () => {
		const result = parseSourceArg('notes:/docs');
		expect(result.description).toBeUndefined();
	});

	test('expands ~ to home directory', () => {
		const result = parseSourceArg('~/docs');
		expect(result.name).toBe('docs');
		expect(result.path).toBe(path.join(os.homedir(), 'docs'));
	});

	test('expands ~ in explicit name:path syntax', () => {
		const result = parseSourceArg('notes:~/my-notes');
		expect(result.name).toBe('notes');
		expect(result.path).toBe(path.join(os.homedir(), 'my-notes'));
	});

	test('expands ~ with description', () => {
		const result = parseSourceArg('wiki:~/docs|Team knowledge base');
		expect(result.name).toBe('wiki');
		expect(result.path).toBe(path.join(os.homedir(), 'docs'));
		expect(result.description).toBe('Team knowledge base');
	});

	test('expands bare ~ to home directory', () => {
		const result = parseSourceArg('~');
		expect(result.path).toBe(os.homedir());
	});
});

describe('parseSources', () => {
	test('parses multiple sources', () => {
		const { sources, errors } = parseSources(['/docs/confluence', '/docs/notes']);
		expect(errors).toHaveLength(0);
		expect(sources).toHaveLength(2);
		expect(sources[0]!.name).toBe('confluence');
		expect(sources[1]!.name).toBe('notes');
	});

	test('detects name collisions', () => {
		const { sources, errors } = parseSources(['/docs/notes', '/other/notes']);
		expect(errors).toHaveLength(1);
		expect(errors[0]).toContain('collision');
		expect(errors[0]).toContain('notes');
		expect(sources).toHaveLength(1); // Only first one is kept
	});

	test('allows explicit naming to avoid collisions', () => {
		const { sources, errors } = parseSources([
			'work-notes:/docs/notes',
			'personal-notes:/other/notes',
		]);
		expect(errors).toHaveLength(0);
		expect(sources).toHaveLength(2);
		expect(sources[0]!.name).toBe('work-notes');
		expect(sources[1]!.name).toBe('personal-notes');
	});

	test('handles mixed explicit and derived names', () => {
		const { sources, errors } = parseSources(['/docs/confluence', 'notes:/home/user/my-notes']);
		expect(errors).toHaveLength(0);
		expect(sources).toHaveLength(2);
		expect(sources[0]!.name).toBe('confluence');
		expect(sources[1]!.name).toBe('notes');
	});

	test('rejects empty source name from explicit syntax', () => {
		const { sources, errors } = parseSources([':/home/user/docs']);
		expect(errors).toHaveLength(1);
		expect(errors[0]).toContain('cannot be empty');
		expect(sources).toHaveLength(0);
	});

	test('handles empty array', () => {
		const { sources, errors } = parseSources([]);
		expect(errors).toHaveLength(0);
		expect(sources).toHaveLength(0);
	});

	test('handles single source', () => {
		const { sources, errors } = parseSources(['/docs/notes']);
		expect(errors).toHaveLength(0);
		expect(sources).toHaveLength(1);
		expect(sources[0]!.name).toBe('notes');
	});
});
