import { describe, expect, test } from 'bun:test';
import { deriveId, deriveTitle, parseMarkdown } from '../lib/markdown/parser.js';

describe('deriveTitle', () => {
	test('returns frontmatter title when present', () => {
		const result = deriveTitle(
			'# Some Heading\nContent',
			{ title: 'Frontmatter Title' },
			'/path/file.md',
		);
		expect(result).toBe('Frontmatter Title');
	});

	test('returns first heading when no frontmatter title', () => {
		const result = deriveTitle('# First Heading\n\n## Second Heading', {}, '/path/file.md');
		expect(result).toBe('First Heading');
	});

	test('returns filename when no title or heading', () => {
		const result = deriveTitle('Just some content without headings', {}, '/path/my-document.md');
		expect(result).toBe('my-document');
	});

	test('handles nested paths for filename fallback', () => {
		const result = deriveTitle('Content', {}, '/deep/nested/path/readme.md');
		expect(result).toBe('readme');
	});
});

describe('deriveId', () => {
	test('returns frontmatter page_id when present', () => {
		const result = deriveId('/base/docs/file.md', { page_id: 'custom-id' }, '/base');
		expect(result).toBe('custom-id');
	});

	test('generates id from relative path', () => {
		const result = deriveId('/base/docs/api/auth.md', {}, '/base');
		expect(result).toBe('docs-api-auth');
	});

	test('sanitizes special characters', () => {
		const result = deriveId('/base/docs/My File (1).md', {}, '/base');
		expect(result).toBe('docs-my-file-1');
	});

	test('handles deeply nested paths', () => {
		const result = deriveId('/home/user/docs/category/subcategory/file.md', {}, '/home/user/docs');
		expect(result).toBe('category-subcategory-file');
	});
});

describe('parseMarkdown', () => {
	test('parses frontmatter and content', () => {
		const content = `---
title: Test Document
labels:
  - api
  - docs
author_email: test@example.com
---

# Introduction

This is the content.
`;
		const result = parseMarkdown(content, '/base/test.md', '/base');

		expect(result.title).toBe('Test Document');
		expect(result.frontmatter.labels).toEqual(['api', 'docs']);
		expect(result.frontmatter.author_email).toBe('test@example.com');
		expect(result.content).toContain('# Introduction');
		expect(result.content).toContain('This is the content.');
		expect(result.path).toBe('test.md');
	});

	test('normalizes string labels to array', () => {
		const content = `---
labels: single-label
---
Content`;
		const result = parseMarkdown(content, '/base/test.md', '/base');
		expect(result.frontmatter.labels).toEqual(['single-label']);
	});

	test('handles missing frontmatter', () => {
		const content = '# Just Content\n\nNo frontmatter here.';
		const result = parseMarkdown(content, '/base/readme.md', '/base');

		expect(result.title).toBe('Just Content');
		expect(result.id).toBe('readme');
		expect(result.frontmatter).toEqual({});
	});

	test('preserves valid child_count', () => {
		const content = `---
child_count: 5
---
Content`;
		const result = parseMarkdown(content, '/base/test.md', '/base');
		expect(result.frontmatter.child_count).toBe(5);
	});

	test('preserves child_count of zero', () => {
		const content = `---
child_count: 0
---
Content`;
		const result = parseMarkdown(content, '/base/test.md', '/base');
		expect(result.frontmatter.child_count).toBe(0);
	});

	test('converts string child_count to number', () => {
		const content = `---
child_count: "10"
---
Content`;
		const result = parseMarkdown(content, '/base/test.md', '/base');
		expect(result.frontmatter.child_count).toBe(10);
	});

	test('rejects negative child_count', () => {
		const content = `---
child_count: -5
---
Content`;
		const result = parseMarkdown(content, '/base/test.md', '/base');
		expect(result.frontmatter.child_count).toBeUndefined();
	});

	test('rejects non-integer child_count', () => {
		const content = `---
child_count: 3.5
---
Content`;
		const result = parseMarkdown(content, '/base/test.md', '/base');
		expect(result.frontmatter.child_count).toBeUndefined();
	});

	test('rejects invalid string child_count', () => {
		const content = `---
child_count: "not-a-number"
---
Content`;
		const result = parseMarkdown(content, '/base/test.md', '/base');
		expect(result.frontmatter.child_count).toBeUndefined();
	});
});
