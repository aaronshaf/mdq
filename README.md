# md

CLI for indexing and searching local markdown files via Meilisearch with MCP server support.

## Getting Started

### Step 1: Install Bun runtime

```bash
curl -fsSL https://bun.sh/install | bash
```

### Step 2: Install md

```bash
bun install -g @aaronshaf/md
```

### Step 3: Start Meilisearch

```bash
docker run -d -p 7700:7700 getmeili/meilisearch:latest
```

### Step 4: Index your markdown files

```bash
md search index --path ~/docs
```

### Step 5: Search

```bash
md search "query"
```

## CLI

```
md status             Check if Meilisearch is running
md search <query>     Search indexed content
md search index       Build/rebuild index (always full reindex)
md search status      Check index status
md mcp [sources...]   Start MCP server
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

# MCP options
-s, --source <path>   Add source directory (can use name:path format)
-d, --desc <text>     Description for preceding source
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
child_count: 5
---
```

**Field descriptions:**
- `child_count`: Number of direct child pages (useful for identifying hub pages vs leaf pages)

**Derivation rules:**
- Title: `frontmatter.title` > first `# heading` > filename
- ID: `frontmatter.page_id` > sanitized path (e.g., `docs-api-auth`)

## MCP Server

```bash
md mcp ~/docs
```

### Source Formats

```bash
# Single directory
md mcp ~/docs

# Multiple directories (names auto-derived, collisions auto-resolved)
md mcp ~/docs ~/wiki ~/notes

# With descriptions using -s/-d flags (recommended)
md mcp -s ~/notes -d "Personal journal" -s ~/wiki -d "Team docs"

# Explicit names to avoid collisions
md mcp -s work:~/work/docs -d "Work documentation" -s personal:~/docs -d "Personal notes"
```

> **Note:** `~` is expanded to your home directory. Descriptions help Claude know *when* to search each source.

**Name collisions:** Derived names (from directory basename) auto-resolve by adding parent path segments. Explicit names (e.g., `wiki:~/path`) error on collision.

### Tools

**search** - Query with filters, returns snippets (200 chars)

**read_page** - Read full content by `path` or `id`

### Claude Code CLI

```bash
# Single directory
claude mcp add kb -- md mcp ~/docs

# Multiple directories
claude mcp add kb -- md mcp ~/docs ~/wiki ~/notes

# With descriptions (recommended)
claude mcp add kb -- md mcp \
  -s ~/notes -d "Personal journal" \
  -s ~/wiki -d "Team knowledge base" \
  -s ~/docs/eng -d "Engineering docs and RFCs"
```

**Scope options:**
- `--scope local` (default) - just this project
- `--scope user` - all your projects
- `--scope project` - shared via `.mcp.json`

**Management:**

```bash
claude mcp list          # view all
claude mcp get kb        # get details
claude mcp remove kb     # remove
```

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "kb": {
      "command": "md",
      "args": ["mcp", "-s", "~/notes", "-d", "Personal journal", "-s", "~/wiki", "-d", "Team docs"]
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
git clone https://github.com/aaronshaf/md
cd md
bun install

bun test              # Run tests
bun run typecheck     # Type check
bun run lint          # Lint
bun run lint:fix      # Lint and fix
```
