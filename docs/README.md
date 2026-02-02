# mdq Documentation

Complete guide for indexing and searching local markdown files.

## Table of Contents

- [Installation](#installation)
- [Search](#search)
- [Ignoring Files](#ignoring-files)
- [Embeddings](#embeddings-semantic-search)
- [Source Management](#source-management)
- [MCP Server](#mcp-server)
- [Configuration](#configuration)
- [Frontmatter](#frontmatter)
- [Development](#development)

## Installation

### Prerequisites

- [Bun](https://bun.sh/) runtime
- [Meilisearch](https://www.meilisearch.com/) (via Docker recommended)

### Step 1: Install Bun

```bash
curl -fsSL https://bun.sh/install | bash
```

### Step 2: Install mdq

```bash
bun install -g @aaronshaf/md
```

### Step 3: Start Meilisearch

```bash
docker run -d -p 7700:7700 \
  -v ~/.meilisearch/data:/meili_data \
  getmeili/meilisearch:latest
```

Data persists at `~/.meilisearch/data` across container removals and restarts.

> **Note:** Vector/semantic search requires Meilisearch v1.3+. The `latest` tag satisfies this.

### Step 4: Index and Search

```bash
mdq index --path ~/docs
mdq search "query"
```

## Search

### Basic Usage

```bash
mdq search "authentication"
mdq search "auth" --limit 20
mdq search "" --labels api,docs    # Browse by label
```

### Filtering Options

| Option | Description |
|--------|-------------|
| `--limit <n>` | Max results (default: 10) |
| `--labels <a,b>` | Filter by labels (OR logic) |
| `--author <email>` | Filter by author |
| `--created-after` | Date filter (YYYY-MM-DD) |
| `--created-before` | Date filter (YYYY-MM-DD) |
| `--created-within` | Duration filter (30d, 2w, 3m, 1y) |
| `--updated-after` | Date filter |
| `--updated-before` | Date filter |
| `--updated-within` | Duration filter |
| `--stale <dur>` | NOT updated within duration |
| `--sort <field>` | created_at, -created_at, updated_at, -updated_at |

### Output Formats

```bash
mdq search "api" --json    # JSON output
mdq search "api" --xml     # XML output (LLM-friendly)
```

### Examples

```bash
mdq search "api" --labels docs --limit 5
mdq search "" --stale 90d                    # Find stale content
mdq search "security" --sort -updated_at     # Most recently updated
```

## Ignoring Files

Create `.mdqignore` in your directory root to exclude files from indexing. Uses gitignore-style syntax.

### Syntax

```
# Comments start with #
*.draft.md              # Ignore by pattern
temp/                   # Ignore directory
archive/old.md          # Ignore specific file
!important.draft.md     # Negate (include exception)
```

### Example

```
# Drafts and work-in-progress
*.draft.md
*.wip.md

# Temporary files
temp/
scratch/

# Archives (except important ones)
archive/
!archive/important.md
```

### Notes

- Patterns evaluated in order (later patterns can override earlier)
- Directory patterns must end with `/`
- Run `mdq index` after adding patterns to remove newly-ignored files

## Embeddings (Semantic Search)

Enhance your index with vector embeddings for semantic search. Documents are chunked and each chunk is embedded, enabling search by meaning rather than just keywords.

### Prerequisites

1. Basic index exists: `mdq index --path ~/docs`
2. Ollama running with embedding model (default: `nomic-embed-text:latest`)

```bash
ollama pull nomic-embed-text
mdq embed status    # Check readiness
```

### Usage

```bash
mdq embed --path ~/docs --verbose
```

This chunks each document and generates vector embeddings for semantic search. Once embeddings exist, `mdq search` automatically uses hybrid search (keyword + semantic).

### Options

| Option | Description |
|--------|-------------|
| `--batch-size <n>` | Process N documents then stop |
| `--time-limit <min>` | Stop after N minutes |
| `--reset` | Reprocess everything from scratch |
| `--dry-run` | Preview what would be processed |
| `--verbose` | Show detailed progress |

### Incremental Processing

```bash
# Process in batches
mdq embed --path ~/docs --batch-size 20 --verbose

# Or use time limits
mdq embed --path ~/docs --time-limit 10 --verbose
```

### Configuration

```bash
# Embedding model (Ollama - default)
export MD_EMBEDDING_ENDPOINT="http://localhost:11434"
export MD_EMBEDDING_MODEL="nomic-embed-text:latest"
export MD_EMBEDDING_DIMENSIONS="768"
```

### Embedding Models

Multiple embedding providers are supported. The provider is auto-detected from the endpoint URL.

#### Ollama (Default)

Local embedding with Ollama. No API key required.

```bash
export MD_EMBEDDING_ENDPOINT="http://localhost:11434"
export MD_EMBEDDING_MODEL="nomic-embed-text:latest"
export MD_EMBEDDING_DIMENSIONS="768"
```

Popular Ollama embedding models:

| Model | Dimensions | Notes |
|-------|------------|-------|
| `all-minilm:latest` | 384 | Fast, good for general use |
| `nomic-embed-text` | 768 | Higher quality, larger |
| `mxbai-embed-large` | 1024 | Best quality, slowest |

#### OpenAI

```bash
export MD_EMBEDDING_ENDPOINT="https://api.openai.com/v1"
export MD_EMBEDDING_MODEL="text-embedding-3-small"
export MD_EMBEDDING_DIMENSIONS="1536"
export MD_EMBEDDING_API_KEY="sk-..."
```

OpenAI embedding models:

| Model | Dimensions | Notes |
|-------|------------|-------|
| `text-embedding-3-small` | 1536 | Cost-effective |
| `text-embedding-3-large` | 3072 | Higher quality |
| `text-embedding-ada-002` | 1536 | Legacy |

#### OpenAI-Compatible APIs

Any OpenAI-compatible embedding API works (e.g., Azure OpenAI, local servers):

```bash
export MD_EMBEDDING_ENDPOINT="https://your-server.com/v1"
export MD_EMBEDDING_MODEL="your-model"
export MD_EMBEDDING_DIMENSIONS="768"  # Match your model
export MD_EMBEDDING_API_KEY="your-key"
```

#### Important Notes

- **Dimensions must match**: Set `MD_EMBEDDING_DIMENSIONS` to your model's output size
- **Changing models requires reindex**: Meilisearch embedder dimensions are immutable once set. Use `mdq embed --reset` after changing models
- **API key fallback**: `MD_EMBEDDING_API_KEY` falls back to `MD_LLM_API_KEY` if not set
- **Provider detection**: Endpoints containing `localhost:11434` use Ollama protocol; all others use OpenAI protocol

## Source Management

Register sources for the MCP server, eliminating the need to specify them on each invocation.

### Commands

```bash
mdq source add -s <path> [-d <description>]
mdq source add -s name:path [-d <description>]
mdq source list
mdq source remove <name>
```

### Usage

```bash
# Register sources
mdq source add -s ~/docs -d "Documentation"
mdq source add -s kb:~/wiki -d "Team knowledge base"

# List registered sources
mdq source list

# Remove a source
mdq source remove kb
```

### Notes

- Sources stored in `~/.config/mdq/sources.json` (or `$XDG_CONFIG_HOME/mdq/sources.json`)
- Name defaults to directory basename (lowercase)
- Use `name:path` syntax for explicit names
- CLI sources to `mdq mcp` override registered sources

## MCP Server

Expose your markdown content to AI assistants via Model Context Protocol.

### Basic Usage

```bash
# Using registered sources (recommended)
mdq source add -s ~/docs -d "Documentation"
mdq mcp

# Or specify sources directly
mdq mcp -s ~/docs -d "Documentation"
```

### Source Resolution

1. If CLI sources provided → use those (registered sources ignored)
2. If no CLI sources → use registered sources
3. If no registered sources → error with helpful message

### Multiple Sources (CLI)

```bash
# Multiple sources with descriptions
mdq mcp -s ~/notes -d "Personal journal" -s ~/wiki -d "Team docs"

# Explicit names
mdq mcp -s work:~/work/docs -d "Work docs" -s personal:~/docs -d "Personal notes"
```

### Tools

| Tool | Description |
|------|-------------|
| `search` | Query with filters, returns snippets. Use `source` param to filter by source. |
| `read_page` | Read full content by path or id. Use `source` param when multiple sources share paths. |

### Claude Code CLI

```bash
# Register sources first (one-time)
mdq source add -s ~/notes -d "Personal journal"
mdq source add -s ~/wiki -d "Team knowledge base"

# Add MCP server (uses registered sources)
claude mcp add kb -- mdq mcp

# Scope options
--scope local      # Just this project (default)
--scope user       # All your projects
--scope project    # Shared via .mcp.json

# Management
claude mcp list          # View all
claude mcp get kb        # Get details
claude mcp remove kb     # Remove
```

### Claude Desktop

Edit the Claude Desktop config file:

| OS | Path |
|----|------|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |

**If installed via bun** (most common):
```json
{
  "mcpServers": {
    "kb": {
      "command": "/Users/YOU/.bun/bin/bun",
      "args": ["run", "/Users/YOU/.bun/bin/mdq", "mcp"]
    }
  }
}
```

**If installed via npm/node:**
```json
{
  "mcpServers": {
    "kb": {
      "command": "node",
      "args": ["/path/to/node_modules/@aaronshaf/md/src/cli.js", "mcp"]
    }
  }
}
```

**Auto-generate config:**
```bash
mdq mcp --print-config
```

This outputs the correct JSON for your installation method (bun or node) with full paths.

**Important:** Claude Desktop doesn't inherit your shell PATH.

Note: Register sources first with `mdq source add -s <path> -d <description>`.

### Quick Setup via Claude

First, find your paths:
```bash
which bun  # e.g., /Users/you/.bun/bin/bun
which mdq   # e.g., /Users/you/.bun/bin/mdq
```

Then ask Claude:

**Claude Code:**
> Add MCP server "kb" with command `mdq mcp` (user scope)

**Claude Desktop (bun install):**
> Add MCP server "kb" to Claude Desktop config using command `/Users/you/.bun/bin/bun` with args `["run", "/Users/you/.bun/bin/mdq", "mcp"]`

Note: Claude Desktop requires full paths and bun installs need bun as the command (not md directly) since it doesn't inherit your shell PATH.

### HTTP Mode (Remote Access)

Run the MCP server over HTTP for Claude web UI or remote clients.

#### Option 1: Bearer Token Authentication (Simple)

Best for quick testing or single-user scenarios:

```bash
# Generate API key
export MDQ_MCP_API_KEY="$(openssl rand -hex 32)"

# Start HTTP server
mdq mcp --http -s ~/docs -d "Documentation"

# Custom port/host
mdq mcp --http --port 8080 --host 0.0.0.0 -s ~/docs -d "Documentation"
```

#### Option 2: OAuth 2.1 Authentication (Recommended)

Best for production use with Claude web UI. Provides secure authorization code flow with PKCE:

```bash
# 1. Generate self-signed certificate for testing (or use real cert)
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes

# 2. Set up OAuth client
mdq oauth setup --client-id claude --name "Claude"

# 3. Start HTTPS server with OAuth
mdq mcp --http --oauth --cert ./cert.pem --key ./key.pem -s ~/docs -d "Documentation"
```

**OAuth Client Management:**

```bash
mdq oauth setup [--client-id <id>] [--name <name>]   # Create OAuth client
mdq oauth list                                        # List configured clients
mdq oauth status                                      # Show OAuth status
mdq oauth remove <client-id>                          # Remove client
```

**OAuth Configuration:**
- OAuth clients: `~/.config/mdq/oauth.json` (chmod 0600)
- OAuth tokens: `~/.config/mdq/oauth-tokens.json` (chmod 0600)
- Access tokens expire after 1 hour (configurable via `MDQ_OAUTH_TOKEN_EXPIRY`)
- Refresh tokens expire after 30 days (configurable via `MDQ_OAUTH_REFRESH_TOKEN_EXPIRY`)
- Token revocation supported via `/oauth/revoke` endpoint (RFC 7009)

**Expose to internet:**

```bash
# Cloudflare Tunnel (recommended - provides HTTPS)
cloudflared tunnel --url https://localhost:3000

# Or ngrok
ngrok http https://localhost:3000
```

**Connect from Claude web UI:**

*With OAuth (recommended):*
1. Settings > Connectors > "Add custom connector"
2. Name: `My Docs`, URL: `https://your-tunnel-url.com/mcp`
3. Claude will auto-discover OAuth endpoints
4. Authorize in browser when prompted

*With Bearer token:*
1. Settings > Connectors > "Add custom connector"
2. Name: `My Docs`, URL: `https://your-tunnel-url.com/mcp`
3. Provide your `MDQ_MCP_API_KEY` when prompted

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MEILISEARCH_HOST` | `http://localhost:7700` | Meilisearch server URL |
| `MEILISEARCH_API_KEY` | - | Meilisearch API key |
| `MDQ_MCP_API_KEY` | - | API key for HTTP mode (Bearer token) |
| `MDQ_MCP_PORT` | `3000` | HTTP mode port |
| `MDQ_MCP_HOST` | `127.0.0.1` | HTTP mode host |
| `MDQ_MCP_CORS_ORIGIN` | `https://claude.ai` | Allowed CORS origin |
| `MDQ_OAUTH_TOKEN_EXPIRY` | `3600` | OAuth access token lifetime (seconds) |
| `MD_EMBEDDING_ENDPOINT` | `http://localhost:11434` | Embedding endpoint |
| `MD_EMBEDDING_MODEL` | `nomic-embed-text:latest` | Embedding model |
| `MD_EMBEDDING_DIMENSIONS` | `768` | Embedding dimensions |
| `MD_EMBEDDING_API_KEY` | - | Embedding API key (for cloud providers) |

### Config Files

| File | Description |
|------|-------------|
| `~/.config/mdq/sources.json` | Registered sources for MCP server |
| `~/.config/mdq/oauth.json` | OAuth client configurations (chmod 0600) |
| `~/.config/mdq/oauth-tokens.json` | OAuth authorization codes and access tokens (chmod 0600) |

The `XDG_CONFIG_HOME` environment variable is respected for config file location.

### Notes

**Index naming:** `~/docs/wiki` becomes `md-docs-wiki`

**Excluded by default:** `node_modules/`, `.*`, `AGENTS.md`, `CLAUDE.md`

## Frontmatter

```yaml
---
title: Page Title
page_id: custom-id
labels: [api, docs]
author_email: user@example.com
child_count: 5
reference: "Author, Title, Publication, Date"
---
```

| Field | Description |
|-------|-------------|
| `title` | Page title (or derived from first `# heading` or filename) |
| `page_id` | Unique ID (or derived from sanitized path) |
| `labels` | Array of labels for filtering |
| `author_email` | Author email for filtering |
| `child_count` | Number of child pages (for hub detection) |
| `reference` | Chicago-style citation for source attribution |

**Derivation rules:**
- Title: `frontmatter.title` > first `# heading` > filename
- ID: `frontmatter.page_id` > sanitized path (e.g., `docs-api-auth`)

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

## Further Reading

- [PRD](prd/) - Product requirements
- [ADR](adr/) - Architecture decisions
