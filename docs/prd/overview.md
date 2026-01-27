# md - Markdown Search CLI

## Overview

`md` is a CLI tool for indexing and searching local markdown files. It provides fast, typo-tolerant search across markdown content via Meilisearch, with optional AI-powered summaries and vector embeddings for semantic search, plus MCP server integration for AI assistants.

## Goals

1. **Fast local search** - Sub-50ms queries across thousands of markdown files
2. **Typo tolerance** - Find content even with misspellings
3. **Semantic search** - Find documents by meaning via vector embeddings (optional)
4. **Flexible frontmatter** - Work with any YAML frontmatter structure
5. **Filter by metadata** - Search by labels, author, dates when available
6. **AI integration** - Expose content to AI assistants via MCP server (stdio or HTTP)

## Non-Goals

- Syncing content from external sources (use other tools like `cn` or git)
- Writing or modifying markdown files
- Real-time file watching or auto-reindexing

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Language | TypeScript/Bun | Fast runtime, native TypeScript support |
| Error handling | Effect library | Type-safe errors, composable operations |
| Search engine | Meilisearch | Typo tolerance, fast, rich filtering, vector support |
| Frontmatter | Flexible YAML | Work with various markdown sources |
| Title fallback | First `#` heading | Derive title when frontmatter missing |
| Config | Environment variables | No config file needed, simple setup |
| MCP transport | stdio + HTTP | Local and remote access |
| Output formats | Text, JSON, XML | Human, scripting, and LLM consumption |
| AI summaries | Ollama (default) | Local-first, optional cloud providers |

## Commands

| Command | Description |
|---------|-------------|
| `md status` | Check if Meilisearch is running |
| `md search <query>` | Search indexed content |
| `md search status` | Check index status |
| `md index` | Build/rebuild the search index |
| `md summarize` | Generate AI summaries and embeddings |
| `md summarize status` | Check LLM and embedding connectivity |
| `md mcp [sources...]` | Start MCP server for AI assistants |

## Frontmatter Support

md works with any YAML frontmatter. These fields are recognized when present:

| Field | Type | Usage |
|-------|------|-------|
| `title` | string | Document title (or derived from first `#` heading) |
| `labels` | string[] | Filterable tags |
| `author_email` | string | Filterable author |
| `created_at` | ISO 8601 | Sortable/filterable creation date |
| `updated_at` | ISO 8601 | Sortable/filterable update date |
| `url` | string | Source URL (for display) |
| `page_id` | string | Unique ID (or derived from file path) |
| `child_count` | number | Number of direct child pages |

Documents with missing fields are still indexed - filters simply won't match them.

## Configuration

No configuration file required. Settings via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `MEILISEARCH_HOST` | `http://localhost:7700` | Meilisearch server URL |
| `MEILISEARCH_API_KEY` | (none) | API key if Meilisearch requires auth |

## User Flows

### Index and Search

```
$ md index --path ~/docs/wiki
Indexing markdown files...
  Found 142 files
  Connecting to Meilisearch...

Indexed 142 documents in 1.2s

$ md search "authentication"
Found 3 results for "authentication"

1. Authentication Guide
   getting-started/authentication.md
   ...handles OAuth2 authentication flows for the API...

2. API Security
   api-reference/security.md
   ...token-based authentication using JWT...
```

### Add Semantic Search

```
$ md summarize --path ~/docs/wiki --verbose
Processing 142 documents...
  [1/142] Authentication Guide - generating summary...
  [1/142] Authentication Guide - generating embedding...
  ...

Processed 142 documents in 5m 23s
```

### MCP Integration

```bash
# Add to Claude Code
claude mcp add kb -- md mcp ~/docs

# Or configure directly in ~/.claude/mcp.json
{
  "mcpServers": {
    "my-docs": {
      "command": "md",
      "args": ["mcp", "/path/to/docs"]
    }
  }
}
```

## Success Metrics

- Index 1000+ documents in < 5 seconds
- Query response < 50ms
- Work with markdown from any source (cn, git, manual)

## References

- [Meilisearch](https://www.meilisearch.com/) - Search engine
- [Model Context Protocol](https://modelcontextprotocol.io/) - AI integration
- [Ollama](https://ollama.ai/) - Local LLM and embedding models
