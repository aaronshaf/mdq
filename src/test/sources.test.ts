import { describe, expect, test } from 'bun:test';
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
