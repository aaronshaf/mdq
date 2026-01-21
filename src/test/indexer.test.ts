import { describe, expect, test } from 'bun:test';
import { deriveIndexName } from '../lib/search/indexer.js';

describe('deriveIndexName', () => {
	test('creates index name from path relative to home', () => {
		// Using a generic path pattern
		const result = deriveIndexName('/tmp/test-docs');
		expect(result).toMatch(/^md-/);
		expect(result).toContain('test-docs');
	});

	test('sanitizes special characters', () => {
		const result = deriveIndexName('/tmp/my docs (v2)');
		expect(result).not.toContain(' ');
		expect(result).not.toContain('(');
		expect(result).not.toContain(')');
	});

	test('converts to lowercase', () => {
		const result = deriveIndexName('/tmp/MyDocs');
		expect(result).toBe(result.toLowerCase());
	});

	test('removes leading/trailing dashes', () => {
		const result = deriveIndexName('/tmp/-docs-');
		expect(result).not.toMatch(/^md--/);
		expect(result).not.toMatch(/-$/);
	});

	test('handles deeply nested paths', () => {
		const result = deriveIndexName('/home/user/projects/my-project/docs');
		expect(result).toMatch(/^md-/);
		// Should create a reasonable index name
		expect(result.length).toBeLessThan(100);
	});
});
