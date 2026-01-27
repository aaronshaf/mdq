# md Documentation

Complete guide for indexing and searching local markdown files.

## Table of Contents

- [Installation](#installation)
- [Search](#search)
- [Ignoring Files](#ignoring-files)
- [Summarization](#summarization)
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

### Step 2: Install md

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
md index --path ~/docs
md search "query"
```

## Search

### Basic Usage

```bash
md search "authentication"
md search "auth" --limit 20
md search "" --labels api,docs    # Browse by label
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
md search "api" --json    # JSON output
md search "api" --xml     # XML output (LLM-friendly)
```

### Examples

```bash
md search "api" --labels docs --limit 5
md search "" --stale 90d                    # Find stale content
md search "security" --sort -updated_at     # Most recently updated
```

## Ignoring Files

Create `.mdignore` in your directory root to exclude files from indexing. Uses gitignore-style syntax.

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
- Run `md index` after adding patterns to remove newly-ignored files

## Summarization

Enhance your index with AI-generated summaries and vector embeddings for semantic search.

### Prerequisites

1. Basic index exists: `md index --path ~/docs`
2. Ollama running with models:
   - LLM for summaries (default: `qwen2.5:7b`)
   - Embedding model (default: `all-minilm:latest`)

```bash
ollama pull all-minilm
md summarize status    # Check readiness
```

### Usage

```bash
md summarize --path ~/docs --verbose
```

This runs two passes per document:
1. Generate concise summary (LLM)
2. Generate vector embedding from title + summary

Once embeddings exist, `md search` automatically uses hybrid search (keyword + semantic).

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
md summarize --path ~/docs --batch-size 20 --verbose

# Or use time limits
md summarize --path ~/docs --time-limit 10 --verbose
```

### Configuration

```bash
# LLM for summaries
export MD_LLM_ENDPOINT="http://localhost:11434/v1"
export MD_LLM_MODEL="qwen2.5:7b"

# Embedding model
export MD_EMBEDDING_ENDPOINT="http://localhost:11434"
export MD_EMBEDDING_MODEL="all-minilm:latest"
export MD_EMBEDDING_DIMENSIONS="384"

# For Claude/OpenAI
export MD_LLM_ENDPOINT="https://api.anthropic.com/v1"
export MD_LLM_MODEL="claude-3-5-sonnet-20241022"
export MD_LLM_API_KEY="your-key"
```

### Embedding Models

Multiple embedding providers are supported. The provider is auto-detected from the endpoint URL.

#### Ollama (Default)

Local embedding with Ollama. No API key required.

```bash
export MD_EMBEDDING_ENDPOINT="http://localhost:11434"
export MD_EMBEDDING_MODEL="all-minilm:latest"
export MD_EMBEDDING_DIMENSIONS="384"
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
- **Changing models requires reindex**: Meilisearch embedder dimensions are immutable once set. Use `md summarize --reset` after changing models
- **API key fallback**: `MD_EMBEDDING_API_KEY` falls back to `MD_LLM_API_KEY` if not set
- **Provider detection**: Endpoints containing `localhost:11434` use Ollama protocol; all others use OpenAI protocol

## MCP Server

Expose your markdown content to AI assistants via Model Context Protocol.

### Basic Usage

```bash
md mcp ~/docs
```

### Multiple Sources

```bash
# Multiple directories
md mcp ~/docs ~/wiki ~/notes

# With descriptions (recommended)
md mcp -s ~/notes -d "Personal journal" -s ~/wiki -d "Team docs"

# Explicit names
md mcp -s work:~/work/docs -d "Work docs" -s personal:~/docs -d "Personal notes"
```

### Tools

| Tool | Description |
|------|-------------|
| `search` | Query with filters, returns snippets (200 chars) |
| `read_page` | Read full content by path or id |

### Claude Code CLI

```bash
# Add MCP server
claude mcp add kb -- md mcp ~/docs

# With descriptions
claude mcp add kb -- md mcp \
  -s ~/notes -d "Personal journal" \
  -s ~/wiki -d "Team knowledge base"

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

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "kb": {
      "command": "md",
      "args": ["mcp", "-s", "~/notes", "-d", "Personal journal"]
    }
  }
}
```

### HTTP Mode (Remote Access)

Run the MCP server over HTTP for Claude web UI or remote clients:

```bash
# Generate API key
export MD_MCP_API_KEY="$(openssl rand -hex 32)"

# Start HTTP server
md mcp --http ~/docs

# Custom port/host
md mcp --http --port 8080 --host 0.0.0.0 ~/docs
```

**Expose to internet:**

```bash
# Cloudflare Tunnel (recommended)
cloudflared tunnel --url http://localhost:3000

# Or ngrok
ngrok http 3000
```

**Connect from Claude web UI:**
1. Settings > Connectors > "Add custom connector"
2. Name: `My Docs`, URL: `https://your-tunnel-url.com/mcp`
3. Provide your `MD_MCP_API_KEY` when prompted

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `MEILISEARCH_HOST` | `http://localhost:7700` | Meilisearch server URL |
| `MEILISEARCH_API_KEY` | - | Meilisearch API key |
| `MD_MCP_API_KEY` | - | API key for HTTP mode |
| `MD_MCP_PORT` | `3000` | HTTP mode port |
| `MD_MCP_HOST` | `127.0.0.1` | HTTP mode host |
| `MD_MCP_CORS_ORIGIN` | `https://claude.ai` | Allowed CORS origin |
| `MD_LLM_ENDPOINT` | `http://localhost:11434/v1` | LLM API endpoint |
| `MD_LLM_MODEL` | `qwen2.5:7b` | LLM model name |
| `MD_LLM_API_KEY` | - | LLM API key |
| `MD_EMBEDDING_ENDPOINT` | `http://localhost:11434` | Embedding endpoint |
| `MD_EMBEDDING_MODEL` | `all-minilm:latest` | Embedding model |
| `MD_EMBEDDING_DIMENSIONS` | `384` | Embedding dimensions |
| `MD_EMBEDDING_API_KEY` | - | Embedding API key |

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
---
```

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
