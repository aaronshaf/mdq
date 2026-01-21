# md - Markdown Search CLI

## Overview

`md` is a CLI tool for indexing and searching local markdown files. It provides fast, typo-tolerant search across markdown content via Meilisearch, with MCP server integration for AI assistants.

## Goals

1. **Fast local search** - Sub-50ms queries across thousands of markdown files
2. **Typo tolerance** - Find content even with misspellings
3. **Flexible frontmatter** - Work with any YAML frontmatter structure (only title required, can be derived from first heading)
4. **Filter by metadata** - Search by labels, author, dates when available
5. **AI integration** - Expose content to AI assistants via MCP server

## Non-Goals

- Syncing content from external sources (use other tools like `cn` or git)
- Writing or modifying markdown files
- Real-time file watching or auto-reindexing
- Remote/networked MCP access

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Language | TypeScript/Bun | Fast runtime, matches cn project |
| Error handling | Effect library | Type-safe errors, composable operations |
| Search engine | Meilisearch | Typo tolerance, fast, rich filtering |
| Frontmatter | Flexible YAML | Work with various markdown sources |
| Title fallback | First `#` heading | Derive title when frontmatter missing |
| Config | Environment variables | No config file needed, simple setup |
| MCP transport | stdio | Local only, secure |
| Output formats | Text, JSON, XML | Human, scripting, and LLM consumption |

## Commands

| Command | Description |
|---------|-------------|
| `md search <query>` | Search indexed content |
| `md search index` | Build/rebuild the search index |
| `md search status` | Check Meilisearch connection |
| `md mcp [path]` | Start MCP server for AI assistants |

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

Documents with missing fields are still indexed - filters simply won't match them.

## Configuration

No configuration file required. Settings via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `MEILISEARCH_URL` | `http://localhost:7700` | Meilisearch server URL |
| `MEILISEARCH_API_KEY` | (none) | API key if Meilisearch requires auth |

## User Flows

### Index and Search

```
$ cd ~/docs/wiki
$ md search index
Indexing markdown files...
  Found 142 files
  Connecting to Meilisearch...
  Indexing documents...

✓ Indexed 142 documents in 1.2s

$ md search "authentication"
Found 3 results for "authentication"

1. Authentication Guide
   getting-started/authentication.md
   ...handles OAuth2 authentication flows for the API...

2. API Security
   api-reference/security.md
   ...token-based authentication using JWT...
```

### MCP Integration

```bash
# Add to Claude Code config (~/.claude/mcp.json)
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

- [cn project](https://github.com/aaronshaf/cn) - Design patterns reference
- [Meilisearch](https://www.meilisearch.com/) - Search engine
- [Model Context Protocol](https://modelcontextprotocol.io/) - AI integration
