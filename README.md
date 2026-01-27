# md

CLI for indexing and searching local markdown files via Meilisearch with MCP server support.

## Quick Start

### 1. Install

```bash
curl -fsSL https://bun.sh/install | bash
bun install -g @aaronshaf/md
```

### 2. Start Meilisearch

```bash
docker run -d -p 7700:7700 \
  -v ~/.meilisearch/data:/meili_data \
  getmeili/meilisearch:latest
```

### 3. Index and Search

```bash
md index --path ~/docs
md search "query"
```

## Commands

```
md status              Check if Meilisearch is running
md search <query>      Search indexed content
md index               Build/rebuild index
md embed               Generate embeddings for semantic search
md mcp [sources...]    Start MCP server
```

Run `md <command> --help` for command-specific options.

## MCP Server

```bash
# Single directory
md mcp ~/docs

# Multiple directories with descriptions
md mcp -s ~/notes -d "Personal journal" -s ~/wiki -d "Team docs"

# Add to Claude Code
claude mcp add kb -- md mcp ~/docs
```

## Documentation

See [docs/](docs/) for comprehensive documentation:

- **[Getting Started](docs/README.md)** - Full setup guide
- **[PRD](docs/prd/)** - Product requirements and specifications
- **[ADR](docs/adr/)** - Architecture decision records

## See Also

- [qmd](https://github.com/tobi/qmd) - Similar tool with opposite tradeoffs: qmd does LLM work at query time (reranking, query expansion), while md does LLM work at index time (embeddings) for fast queries.
