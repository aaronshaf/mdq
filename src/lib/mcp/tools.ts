import { Schema } from 'effect';

export const SearchToolParams = Schema.Struct({
	query: Schema.String.annotations({ description: 'Search query (supports typo tolerance)' }),
	limit: Schema.optionalWith(
		Schema.Int.pipe(Schema.greaterThanOrEqualTo(1), Schema.lessThanOrEqualTo(100)),
		{ default: () => 10 },
	).annotations({ description: 'Maximum results to return' }),
	source: Schema.optional(Schema.String).annotations({
		description: 'Filter by source name (omit to search all sources)',
	}),
	labels: Schema.optional(Schema.Array(Schema.String)).annotations({
		description: 'Filter by labels (OR logic)',
	}),
	author: Schema.optional(Schema.String).annotations({ description: 'Filter by author email' }),
	created_after: Schema.optional(Schema.String).annotations({
		description: 'Filter: created after date (YYYY-MM-DD)',
	}),
	created_before: Schema.optional(Schema.String).annotations({
		description: 'Filter: created before date (YYYY-MM-DD)',
	}),
	created_within: Schema.optional(Schema.String).annotations({
		description: 'Filter: created within duration (e.g., 30d, 2w, 3m, 1y)',
	}),
	updated_after: Schema.optional(Schema.String).annotations({
		description: 'Filter: updated after date (YYYY-MM-DD)',
	}),
	updated_before: Schema.optional(Schema.String).annotations({
		description: 'Filter: updated before date (YYYY-MM-DD)',
	}),
	updated_within: Schema.optional(Schema.String).annotations({
		description: 'Filter: updated within duration (e.g., 7d, 2w, 1m)',
	}),
	stale: Schema.optional(Schema.String).annotations({
		description: 'Filter: NOT updated within duration - find stale content (e.g., 90d, 6m)',
	}),
	sort: Schema.optional(
		Schema.Literal('created_at', '-created_at', 'updated_at', '-updated_at'),
	).annotations({ description: 'Sort order (prefix with - for descending)' }),
});

const ReadToolParamsBase = Schema.Struct({
	path: Schema.optional(Schema.String).annotations({
		description: 'Relative path to the markdown file (e.g., "getting-started/authentication.md")',
	}),
	id: Schema.optional(Schema.String).annotations({
		description: 'Page ID from frontmatter or search results',
	}),
	source: Schema.optional(Schema.String).annotations({
		description: 'Source name (required if multiple sources have pages with same path/id)',
	}),
});

export const ReadToolParams = ReadToolParamsBase.pipe(
	Schema.filter((params) => {
		if (!params.path && !params.id) {
			return {
				path: ['path'],
				message: 'Either path or id must be provided',
			};
		}
		return undefined;
	}),
);

export type SearchToolParams = typeof SearchToolParams.Type;
export type ReadToolParams = typeof ReadToolParams.Type;
