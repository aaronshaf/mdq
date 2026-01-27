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
| Semantic search | Find by meaning, not just keywords | Optional (via `md embed`) |

## Non-Goals

- Real-time file watching (manual reindex)
- Search result pagination in v1 (top N results)
- Writing or modifying files

## Solution Overview

Integrate [Meilisearch](https://www.meilisearch.com/) as a local search engine. Users run Meilisearch via Docker or binary, and `md` indexes local markdown content for fast, typo-tolerant search.

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Local Markdown │────▶│    md index      │────▶│   Meilisearch   │
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
# Docker (recommended)
docker run -d -p 7700:7700 \
  -v ~/.meilisearch/data:/meili_data \
  getmeili/meilisearch:latest

# Homebrew (macOS)
brew install meilisearch
meilisearch --db-path ./meili_data

# Direct binary
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
  reference: string | null // Citation string for source attribution
  child_count: number | null // Number of child pages (for hub detection)

  // Embedding fields (optional - from md embed)
  embedded_at: number | null    // Timestamp when embeddings were generated
  // Note: Embeddings stored in separate chunks index
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

Sanitization: lowercase, replace non-alphanumeric with hyphen.

## Hybrid Search

When documents have embeddings (via `md embed`), search automatically uses hybrid mode:

1. **Keyword search**: Traditional full-text with typo tolerance
2. **Semantic search**: Vector similarity using embeddings

Results are merged and ranked. No flags needed - hybrid search activates automatically when embeddings exist.

## Configuration

No configuration file. Settings via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `MEILISEARCH_HOST` | `http://localhost:7700` | Meilisearch server URL |
| `MEILISEARCH_API_KEY` | (none) | API key if Meilisearch requires auth |

## File Exclusions

The following are excluded from indexing by default:

| Pattern | Reason |
|---------|--------|
| `.*` | All dot files and folders |
| `node_modules/` | Package dependencies |
| `AGENTS.md` | AI agent instructions |
| `CLAUDE.md` | AI agent instructions |
| `.mdignore` patterns | User-defined exclusions |

### .mdignore

Users can create a `.mdignore` file with gitignore-style patterns:

```
# Ignore drafts
*.draft.md

# Ignore directories
temp/
archive/

# Exceptions
!archive/important.md
```

## Indexing Behavior

`md index` always performs a **full reindex**:

1. Delete existing index for the directory
2. Scan all markdown files (respecting exclusions)
3. Create fresh index with all documents

This approach:
- Automatically handles deleted files
- Keeps implementation simple
- Is fast enough for typical use (1000 files in ~1-2 seconds)

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
| Meilisearch not running | 9 | `Meilisearch not available at {url}` |
| Index not found | 10 | `No search index found. Run 'md index' first.` |
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
│       ├── smart-indexer.ts   # Embeddings for semantic search
│       ├── client.ts          # Meilisearch client wrapper
│       ├── date-utils.ts      # Date filter helpers
│       └── types.ts           # Search types
└── cli/
    └── commands/
        ├── search.ts          # md search command
        └── embed.ts           # md embed command
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
- Hybrid search with embeddings

## References

- [Meilisearch Documentation](https://www.meilisearch.com/docs)
- [Meilisearch JavaScript SDK](https://github.com/meilisearch/meilisearch-js)
- [Meilisearch Hybrid Search](https://www.meilisearch.com/docs/learn/experimental/vector_search)
- [gray-matter](https://github.com/jonschlinkert/gray-matter) - Frontmatter parsing
