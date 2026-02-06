# mdq

CLI for indexing and searching local markdown files via Meilisearch with MCP server support.

## Quick Start

### 1. Install

```bash
curl -fsSL https://bun.sh/install | bash
bun install -g @aaronshaf/mdq
```

### 2. Start Meilisearch

```bash
docker run -d -p 7700:7700 \
  -v ~/.meilisearch/data:/meili_data \
  getmeili/meilisearch:latest
```

### 3. Index and Search

```bash
mdq index --path ~/docs
mdq search "query"
```

## Commands

```
mdq status              Check if Meilisearch is running
mdq search <query>      Search indexed content
mdq index               Build/rebuild index
mdq embed               Generate embeddings for semantic search
mdq source              Manage registered sources for MCP server
mdq token               Generate API tokens for Bearer authentication
mdq oauth               Manage OAuth 2.1 authentication
mdq mcp [sources...]    Start MCP server
```

Run `mdq <command> --help` for command-specific options.

## MCP Server

```bash
# Register sources (one-time setup)
mdq source add -s ~/docs -d "Documentation"
mdq source add -s ~/wiki -d "Team wiki"
mdq source list

# Start MCP server (uses registered sources)
mdq mcp

# Or specify sources directly (overrides registered)
mdq mcp -s ~/docs -d "Documentation"

# HTTP mode with Bearer token (simple)
mdq token generate  # Generate and save the token
export MDQ_MCP_API_KEY="<your-token>"
mdq mcp --http

# Or use OAuth 2.1 (recommended for production)
mdq oauth setup --client-id claude --name "Claude"
mdq mcp --http --oauth --cert ./cert.pem --key ./key.pem

# Add to Claude Code
claude mcp add kb -- mdq mcp
```

## Documentation

See [docs/](docs/) for comprehensive documentation:

- **[Getting Started](docs/README.md)** - Full setup guide
- **[PRD](docs/prd/)** - Product requirements and specifications
- **[ADR](docs/adr/)** - Architecture decision records

## See Also

- [qmd](https://github.com/tobi/qmd) - Similar tool with opposite tradeoffs: qmd does LLM work at query time (reranking, query expansion), while mdq does LLM work at index time (embeddings) for fast queries.
