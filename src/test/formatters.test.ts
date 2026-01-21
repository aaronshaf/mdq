import { describe, expect, test } from 'bun:test';
import { HumanFormatter, JsonFormatter, XmlFormatter, getFormatter } from '../lib/formatters.js';

describe('JsonFormatter', () => {
	const formatter = new JsonFormatter();

	test('formats object as pretty JSON', () => {
		const result = formatter.format({ key: 'value' });
		expect(result).toBe('{\n  "key": "value"\n}');
	});

	test('formats array as pretty JSON', () => {
		const result = formatter.format([1, 2, 3]);
		expect(result).toBe('[\n  1,\n  2,\n  3\n]');
	});

	test('formats error as JSON object', () => {
		const result = formatter.formatError({ message: 'Something went wrong' });
		expect(result).toBe('{\n  "error": "Something went wrong"\n}');
	});
});

describe('XmlFormatter', () => {
	const formatter = new XmlFormatter();

	test('formats object as XML', () => {
		const result = formatter.format({ title: 'Test', count: 5 });
		expect(result).toContain('<title>Test</title>');
		expect(result).toContain('<count>5</count>');
	});

	test('formats array as XML with item elements', () => {
		const result = formatter.format([{ name: 'one' }, { name: 'two' }]);
		expect(result).toContain('<item>');
		expect(result).toContain('<name>one</name>');
		expect(result).toContain('<name>two</name>');
	});

	test('escapes special XML characters', () => {
		const result = formatter.format({ text: '<script>alert("xss")</script>' });
		expect(result).toContain('&lt;script&gt;');
		expect(result).toContain('&quot;');
	});

	test('formats error as XML', () => {
		const result = formatter.formatError({ message: 'Error message' });
		expect(result).toBe('<error>Error message</error>');
	});
});

describe('HumanFormatter', () => {
	const formatter = new HumanFormatter();

	test('formats search result with title and path', () => {
		const result = formatter.format({
			title: 'My Document',
			path: 'docs/readme.md',
			snippet: 'Some content preview...',
		});
		expect(result).toContain('My Document');
		expect(result).toContain('docs/readme.md');
		expect(result).toContain('Some content preview...');
	});

	test('formats status response with checkmark', () => {
		const result = formatter.format({
			status: 'ok',
			message: 'Connected',
			documentCount: 42,
		});
		expect(result).toContain('✓');
		expect(result).toContain('Connected');
		expect(result).toContain('42');
	});

	test('formats index result', () => {
		const result = formatter.format({ indexed: 10, total: 12 });
		expect(result).toBe('Indexed 10/12 files');
	});

	test('formats array of items', () => {
		const result = formatter.format([
			{ title: 'Doc 1', path: 'a.md' },
			{ title: 'Doc 2', path: 'b.md' },
		]);
		expect(result).toContain('Doc 1');
		expect(result).toContain('Doc 2');
	});
});

describe('getFormatter', () => {
	test('returns JsonFormatter for json', () => {
		const formatter = getFormatter('json');
		expect(formatter).toBeInstanceOf(JsonFormatter);
	});

	test('returns XmlFormatter for xml', () => {
		const formatter = getFormatter('xml');
		expect(formatter).toBeInstanceOf(XmlFormatter);
	});

	test('returns HumanFormatter for human', () => {
		const formatter = getFormatter('human');
		expect(formatter).toBeInstanceOf(HumanFormatter);
	});
});
