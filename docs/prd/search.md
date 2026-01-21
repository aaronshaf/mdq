# md search - Product Requirements Document

## Problem Statement

Users with large collections of markdown files struggle to find relevant content quickly. Current options are inadequate:

1. **grep/ripgrep** - No typo tolerance, no relevance ranking, requires regex knowledge
2. **IDE search** - Limited to open projects, no metadata filtering
3. **Manual browsing** - Impractical for large collections, relies on memory

Users need fast, typo-tolerant, offline search across their markdown content with relevance ranking and filtering capabilities.

## Goals

| Goal | Metric | Target |
|------|--------|--------|
| Fast search | Query response time | < 50ms for 1000+ documents |
| Typo tolerance | Find "authentication" when typing "authentcation" | Works correctly |
| Offline capable | Search works without network | 100% offline |
| Filterable | Filter by labels, author, date | Supported (when metadata present) |
| Source agnostic | Work with markdown from any source | cn, git, manual, etc. |

## Non-Goals

- Real-time file watching (manual reindex)
- Semantic/AI search (full-text only for v1)
- Search result pagination in v1 (top N results)
- Writing or modifying files

## Solution Overview

Integrate [Meilisearch](https://www.meilisearch.com/) as a local search engine. Users run Meilisearch via Docker or binary, and `md` indexes local markdown content for fast, typo-tolerant search.

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Local Markdown │────▶│  md search index │────▶│   Meilisearch   │
│     Files       │     │                  │     │  (localhost)    │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                                                         │
                                                         ▼
┌─────────────────┐                              ┌─────────────────┐
│  md search      │─────────────────────────────▶│  Search Results │
│    "query"      │                              │  (ranked)       │
└─────────────────┘                              └─────────────────┘
```

## Prerequisites

Users must run Meilisearch locally:

```bash
# Option 1: Docker (recommended)
docker run -d -p 7700:7700 \
  -v $(pwd)/meili_data:/meili_data \
  getmeili/meilisearch:latest

# Option 2: Homebrew (macOS)
brew install meilisearch
meilisearch --db-path ./meili_data

# Option 3: Direct binary
curl -L https://install.meilisearch.com | sh
./meilisearch --db-path ./meili_data
```

## Data Model

### Indexed Document

Each markdown file is indexed as a document:

```typescript
interface SearchDocument {
  // Primary key (page_id from frontmatter, or derived from path)
  id: string

  // Searchable fields
  title: string           // From frontmatter or first # heading
  content: string         // Full markdown body (without frontmatter)

  // Filterable fields (optional - from frontmatter when present)
  labels: string[]
  author_email: string | null

  // Sortable fields (Unix timestamps, null if not in frontmatter)
  created_at: number | null
  updated_at: number | null

  // Display fields
  local_path: string      // Relative path from index root
  url: string | null      // Source URL if in frontmatter
}
```

### Title Derivation

Title is determined in this order:
1. `title` field in YAML frontmatter
2. First `# heading` in the document content
3. Filename (without .md extension)

### ID Derivation

Document ID is determined in this order:
1. `page_id` field in YAML frontmatter
2. Sanitized relative file path (e.g., `docs/api/auth.md` → `docs-api-auth`)

### Meilisearch Index Settings

```typescript
const indexSettings = {
  searchableAttributes: [
    'title',      // Highest priority
    'content'     // Lower priority
  ],
  filterableAttributes: [
    'labels',
    'author_email',
    'created_at',
    'updated_at'
  ],
  sortableAttributes: [
    'created_at',
    'updated_at'
  ],
  rankingRules: [
    'words',
    'typo',
    'proximity',
    'attribute',
    'sort',
    'exactness'
  ]
}
```

### Index Naming

Index name is derived from the full directory path relative to `$HOME`:
- `~/docs/wiki` → `md-docs-wiki`
- `~/projects/eng-docs` → `md-projects-eng-docs`
- `~/github/team/docs` → `md-github-team-docs`

If path is outside `$HOME`, uses full absolute path segments.

Sanitization: lowercase, replace non-alphanumeric with hyphen.

This ensures uniqueness - no two directories can collide.

## Configuration

No configuration file. Settings via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `MEILISEARCH_URL` | `http://localhost:7700` | Meilisearch server URL |
| `MEILISEARCH_API_KEY` | (none) | API key if Meilisearch requires auth |

## File Exclusions

The following are excluded from indexing by default:

| Pattern | Reason |
|---------|--------|
| `.*` | All dot files and folders (`.git/`, `.next/`, `.env`, etc.) |
| `node_modules/` | Package dependencies |
| `AGENTS.md` | AI agent instructions |
| `CLAUDE.md` | AI agent instructions |

No `--exclude` flag for v1. These defaults handle the common cases.

## Indexing Behavior

`md search index` always performs a **full reindex**:

1. Delete existing index for the directory
2. Scan all markdown files (respecting exclusions)
3. Create fresh index with all documents

This approach:
- Automatically handles deleted files (they're simply not re-added)
- Keeps implementation simple
- Is fast enough for typical use (1000 files in ~1-2 seconds)

No `--force` flag needed since every index operation is a full rebuild.

## Empty Query Support

An empty query (`md search ""`) returns all documents. Filters still apply:

```bash
# Find all stale documentation
md search "" --stale 90d --labels documentation

# Browse all docs with a specific label
md search "" --labels api

# Show 5 most recently updated
md search "" --limit 5 --sort -updated_at
```

## Error Handling

| Error | Exit Code | Message |
|-------|-----------|---------|
| Meilisearch not running | 9 | `Meilisearch not available at {url}. Start it with: docker run -d -p 7700:7700 getmeili/meilisearch:latest` |
| Index not found | 10 | `No search index found. Run 'md search index' first.` |
| No results | 0 | `No results found for "{query}"` |
| Invalid filter | 6 | `Invalid filter: {details}` |

## Architecture

### Files

```
src/
├── lib/
│   └── search/
│       ├── index.ts           # Search facade
│       ├── indexer.ts         # Build index from files
│       ├── client.ts          # Meilisearch client wrapper
│       ├── date-utils.ts      # Date filter helpers
│       └── types.ts           # Search types
└── cli/
    └── commands/
        └── search.ts          # md search command
```

### Dependencies

```json
{
  "dependencies": {
    "meilisearch": "^0.44.0",
    "gray-matter": "^4.0.3"
  }
}
```

## Testing Strategy

### Unit Tests

- `indexer.test.ts` - Document extraction from markdown, title derivation
- `client.test.ts` - Meilisearch client wrapper (mocked)
- `search.test.ts` - Search command parsing, filter validation

### Integration Tests

- Real Meilisearch instance (Docker in CI)
- Index creation and search queries
- Filter combinations
- Missing metadata handling

## References

- [Meilisearch Documentation](https://www.meilisearch.com/docs)
- [Meilisearch JavaScript SDK](https://github.com/meilisearch/meilisearch-js)
- [gray-matter](https://github.com/jonschlinkert/gray-matter) - Frontmatter parsing
