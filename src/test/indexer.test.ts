import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSearchClient } from '../lib/search/client.js';
import { deriveIndexName, indexDirectory } from '../lib/search/indexer.js';

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

describe('indexDirectory', () => {
	let testDir: string;
	let client: ReturnType<typeof createSearchClient>;

	beforeEach(() => {
		testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-test-'));
		client = createSearchClient();
	});

	afterEach(async () => {
		// Clean up test directory
		fs.rmSync(testDir, { recursive: true, force: true });
		// Clean up test index
		const indexName = deriveIndexName(testDir);
		try {
			await client.deleteIndex(indexName);
		} catch {
			// Ignore errors if index doesn't exist
		}
	});

	test('prioritizes frontmatter dates over filesystem dates', async () => {
		// Create a test markdown file with frontmatter dates
		const testFile = path.join(testDir, 'test.md');
		const frontmatterDate = '2024-01-15T10:00:00Z';
		const content = `---
title: Test Document
created_at: ${frontmatterDate}
updated_at: 2024-01-20T15:30:00Z
---

# Test Document

This is a test document.
`;

		fs.writeFileSync(testFile, content);

		// Index the directory
		const result = await indexDirectory(testDir, client);
		expect(result.indexed).toBe(1);

		// Get document by ID to verify dates
		const indexName = deriveIndexName(testDir);
		const doc = await client.getDocumentById(indexName, 'test');

		expect(doc).not.toBeNull();
		// Verify that frontmatter dates were used (not filesystem dates)
		expect(doc?.created_at).toBe(new Date(frontmatterDate).getTime());
		expect(doc?.updated_at).toBe(new Date('2024-01-20T15:30:00Z').getTime());
	});

	test('falls back to filesystem dates when frontmatter missing', async () => {
		// Create a test markdown file without frontmatter dates
		const testFile = path.join(testDir, 'nodate.md');
		const content = `# Test Document

This is a test document without frontmatter dates.
`;

		fs.writeFileSync(testFile, content);

		// Index the directory
		const result = await indexDirectory(testDir, client);
		expect(result.indexed).toBe(1);

		// Get document by ID to verify dates exist (ID is derived from filename)
		const indexName = deriveIndexName(testDir);
		const doc = await client.getDocumentById(indexName, 'nodate');

		expect(doc).not.toBeNull();
		// Verify that dates were populated from filesystem
		expect(doc?.created_at).toBeGreaterThan(0);
		expect(doc?.updated_at).toBeGreaterThan(0);
	});

	test('handles invalid date in frontmatter by falling back to filesystem', async () => {
		// Create a test markdown file with invalid date
		const testFile = path.join(testDir, 'invalid-date.md');
		const content = `---
title: Invalid Date Test
created_at: not-a-real-date
updated_at: invalid
---

# Invalid Date Test

This has invalid dates.
`;

		fs.writeFileSync(testFile, content);

		// Index the directory
		const result = await indexDirectory(testDir, client);
		expect(result.indexed).toBe(1);

		// Get document by ID
		const indexName = deriveIndexName(testDir);
		const doc = await client.getDocumentById(indexName, 'invalid-date');

		expect(doc).not.toBeNull();
		// Should fall back to filesystem dates (not NaN)
		expect(doc?.created_at).toBeGreaterThan(0);
		expect(doc?.updated_at).toBeGreaterThan(0);
		expect(Number.isNaN(doc?.created_at)).toBe(false);
		expect(Number.isNaN(doc?.updated_at)).toBe(false);
	});

	test('handles empty string dates by falling back to filesystem', async () => {
		// Create a test markdown file with empty string dates
		const testFile = path.join(testDir, 'empty-date.md');
		const content = `---
title: Empty Date Test
created_at: ""
updated_at: "   "
---

# Empty Date Test

Empty string dates should be ignored.
`;

		fs.writeFileSync(testFile, content);

		// Index the directory
		const result = await indexDirectory(testDir, client);
		expect(result.indexed).toBe(1);

		// Get document by ID
		const indexName = deriveIndexName(testDir);
		const doc = await client.getDocumentById(indexName, 'empty-date');

		expect(doc).not.toBeNull();
		// Should fall back to filesystem dates
		expect(doc?.created_at).toBeGreaterThan(0);
		expect(doc?.updated_at).toBeGreaterThan(0);
	});

	test('handles partial frontmatter dates (only created_at)', async () => {
		// Create a test markdown file with only created_at
		const testFile = path.join(testDir, 'partial-created.md');
		const createdDate = '2024-02-01T08:00:00Z';
		const content = `---
title: Partial Date Test
created_at: ${createdDate}
---

# Partial Date Test

Only created_at is specified.
`;

		fs.writeFileSync(testFile, content);

		// Index the directory
		const result = await indexDirectory(testDir, client);
		expect(result.indexed).toBe(1);

		// Get document by ID
		const indexName = deriveIndexName(testDir);
		const doc = await client.getDocumentById(indexName, 'partial-created');

		expect(doc).not.toBeNull();
		// created_at should use frontmatter
		expect(doc?.created_at).toBe(new Date(createdDate).getTime());
		// updated_at should fall back to filesystem
		expect(doc?.updated_at).toBeGreaterThan(0);
	});

	test('handles partial frontmatter dates (only updated_at)', async () => {
		// Create a test markdown file with only updated_at
		const testFile = path.join(testDir, 'partial-updated.md');
		const updatedDate = '2024-02-15T12:30:00Z';
		const content = `---
title: Partial Date Test
updated_at: ${updatedDate}
---

# Partial Date Test

Only updated_at is specified.
`;

		fs.writeFileSync(testFile, content);

		// Index the directory
		const result = await indexDirectory(testDir, client);
		expect(result.indexed).toBe(1);

		// Get document by ID
		const indexName = deriveIndexName(testDir);
		const doc = await client.getDocumentById(indexName, 'partial-updated');

		expect(doc).not.toBeNull();
		// created_at should fall back to filesystem
		expect(doc?.created_at).toBeGreaterThan(0);
		// updated_at should use frontmatter
		expect(doc?.updated_at).toBe(new Date(updatedDate).getTime());
	});

	test('handles date-only format without time component', async () => {
		// Create a test markdown file with date-only format
		const testFile = path.join(testDir, 'date-only.md');
		const dateOnly = '2024-03-20';
		const content = `---
title: Date Only Test
created_at: ${dateOnly}
---

# Date Only Test

Date without time component.
`;

		fs.writeFileSync(testFile, content);

		// Index the directory
		const result = await indexDirectory(testDir, client);
		expect(result.indexed).toBe(1);

		// Get document by ID
		const indexName = deriveIndexName(testDir);
		const doc = await client.getDocumentById(indexName, 'date-only');

		expect(doc).not.toBeNull();
		// Should parse successfully
		expect(doc?.created_at).toBe(new Date(dateOnly).getTime());
		expect(Number.isNaN(doc?.created_at)).toBe(false);
	});
});
