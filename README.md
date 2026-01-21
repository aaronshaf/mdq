# md

CLI for indexing and searching local markdown files via Meilisearch with MCP server support.

## Requirements

- Bun 1.2.0+
- Meilisearch

## Setup

```bash
bun install

# Start Meilisearch
docker run -d -p 7700:7700 getmeili/meilisearch:latest

# Index and search
bun run src/cli.ts search index --path ~/docs
bun run src/cli.ts search "query"
```

## CLI

```
md search <query>     Search indexed content
md search index       Build/rebuild index (always full reindex)
md search status      Check Meilisearch connection
md mcp [path]         Start MCP server
```

### Options

```
--help, -h            Show help
--version, -v         Show version
--verbose             Verbose output
--json                JSON output
--xml                 XML output
--path <dir>          Target directory (default: cwd)
--limit <n>           Max results (default: 10)
--labels <a,b>        Filter by labels (OR logic)
--author <email>      Filter by author
--created-after       Date filter (YYYY-MM-DD)
--created-before      Date filter (YYYY-MM-DD)
--created-within      Duration filter (30d, 2w, 3m, 1y)
--updated-after       Date filter
--updated-before      Date filter
--updated-within      Duration filter
--stale <dur>         NOT updated within duration
--sort <field>        created_at, -created_at, updated_at, -updated_at
```

### Examples

```bash
md search "auth"
md search "" --labels api,docs --limit 20
md search "" --stale 90d
md search "api" --json
```

## Frontmatter

```yaml
---
title: Page Title
page_id: custom-id
labels: [api, docs]
author_email: user@example.com
---
```

Title derivation: `frontmatter.title` > first `# heading` > filename

ID derivation: `frontmatter.page_id` > sanitized path (e.g., `docs-api-auth`)

## MCP Server

```bash
md mcp ~/docs
```

### Tools

**search** - Query with filters, returns snippets (200 chars)

**read_page** - Read full content by `path` or `id`

### Claude Desktop Config

`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "md": {
      "command": "bun",
      "args": ["run", "/path/to/md/src/cli.ts", "mcp", "/path/to/docs"]
    }
  }
}
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `MEILISEARCH_HOST` | `http://localhost:7700` | Server URL |
| `MEILISEARCH_API_KEY` | - | API key if auth enabled |

Index naming: `~/docs/wiki` becomes `md-docs-wiki`

Excluded: `node_modules/`, `.*`, `AGENTS.md`, `CLAUDE.md`

## Development

```bash
bun test              # Run tests
bun run typecheck     # Type check
bun run lint          # Lint
bun run lint:fix      # Lint and fix
```
