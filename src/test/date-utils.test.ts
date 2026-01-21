import { describe, expect, test } from 'bun:test';
import {
	buildDateFilters,
	durationToMs,
	filtersToMeilisearchString,
	parseDuration,
	timestampFromDuration,
} from '../lib/search/date-utils.js';

describe('parseDuration', () => {
	test('parses days', () => {
		expect(parseDuration('30d')).toEqual({ value: 30, unit: 'd' });
	});

	test('parses weeks', () => {
		expect(parseDuration('2w')).toEqual({ value: 2, unit: 'w' });
	});

	test('parses months', () => {
		expect(parseDuration('3m')).toEqual({ value: 3, unit: 'm' });
	});

	test('parses years', () => {
		expect(parseDuration('1y')).toEqual({ value: 1, unit: 'y' });
	});

	test('is case insensitive', () => {
		expect(parseDuration('30D')).toEqual({ value: 30, unit: 'd' });
		expect(parseDuration('2W')).toEqual({ value: 2, unit: 'w' });
	});

	test('returns null for invalid input', () => {
		expect(parseDuration('invalid')).toBeNull();
		expect(parseDuration('30')).toBeNull();
		expect(parseDuration('d30')).toBeNull();
		expect(parseDuration('')).toBeNull();
	});
});

describe('durationToMs', () => {
	const msPerDay = 24 * 60 * 60 * 1000;

	test('converts days to milliseconds', () => {
		expect(durationToMs({ value: 1, unit: 'd' })).toBe(msPerDay);
		expect(durationToMs({ value: 30, unit: 'd' })).toBe(30 * msPerDay);
	});

	test('converts weeks to milliseconds', () => {
		expect(durationToMs({ value: 1, unit: 'w' })).toBe(7 * msPerDay);
		expect(durationToMs({ value: 2, unit: 'w' })).toBe(14 * msPerDay);
	});

	test('converts months to milliseconds', () => {
		expect(durationToMs({ value: 1, unit: 'm' })).toBe(30 * msPerDay);
	});

	test('converts years to milliseconds', () => {
		expect(durationToMs({ value: 1, unit: 'y' })).toBe(365 * msPerDay);
	});
});

describe('timestampFromDuration', () => {
	test('returns null for invalid duration', () => {
		expect(timestampFromDuration('invalid', 'before')).toBeNull();
	});

	test('calculates timestamp before now', () => {
		const now = Date.now();
		const result = timestampFromDuration('1d', 'before');
		expect(result).not.toBeNull();
		// Should be approximately 1 day ago (within 1 second tolerance)
		const expected = now - 24 * 60 * 60 * 1000;
		expect(Math.abs(result! - expected)).toBeLessThan(1000);
	});
});

describe('buildDateFilters', () => {
	test('builds created_within filter', () => {
		const filters = buildDateFilters({ createdWithin: '30d' });
		expect(filters).toHaveLength(1);
		expect(filters[0]!.field).toBe('created_at');
		expect(filters[0]!.operator).toBe('>=');
	});

	test('builds stale filter (updated_at <=)', () => {
		const filters = buildDateFilters({ stale: '90d' });
		expect(filters).toHaveLength(1);
		expect(filters[0]!.field).toBe('updated_at');
		expect(filters[0]!.operator).toBe('<=');
	});

	test('combines multiple filters', () => {
		const filters = buildDateFilters({
			createdWithin: '30d',
			updatedWithin: '7d',
		});
		expect(filters).toHaveLength(2);
	});

	test('returns empty array for no filters', () => {
		const filters = buildDateFilters({});
		expect(filters).toEqual([]);
	});
});

describe('filtersToMeilisearchString', () => {
	test('formats single filter', () => {
		const result = filtersToMeilisearchString([
			{ field: 'created_at', operator: '>=', value: 1000 },
		]);
		expect(result).toBe('created_at >= 1000');
	});

	test('joins multiple filters with AND', () => {
		const result = filtersToMeilisearchString([
			{ field: 'created_at', operator: '>=', value: 1000 },
			{ field: 'updated_at', operator: '<=', value: 2000 },
		]);
		expect(result).toBe('created_at >= 1000 AND updated_at <= 2000');
	});

	test('returns empty string for no filters', () => {
		const result = filtersToMeilisearchString([]);
		expect(result).toBe('');
	});
});
