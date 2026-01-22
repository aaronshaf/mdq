import { describe, expect, test } from 'bun:test';
import { SearchClient, createSearchClient } from '../lib/search/client.js';

describe('createSearchClient', () => {
	test('creates client with default config', () => {
		const client = createSearchClient();
		expect(client).toBeInstanceOf(SearchClient);
	});

	test('creates client with custom host', () => {
		const client = createSearchClient({ host: 'http://custom:7700' });
		expect(client).toBeInstanceOf(SearchClient);
	});
});

describe('SearchClient.checkHealth', () => {
	test('returns unhealthy when Meilisearch is not running', async () => {
		// Use a port that's unlikely to have anything running
		const client = createSearchClient({ host: 'http://localhost:59999' });
		const result = await client.checkHealth();

		expect(result.healthy).toBe(false);
		expect(result.message).toContain('Cannot connect to Meilisearch');
	});

	// Note: Testing healthy state requires a running Meilisearch instance
	// which is outside the scope of unit tests
});
