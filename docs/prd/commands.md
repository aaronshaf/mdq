# mdq CLI Commands

## Global Options

| Option | Description |
|--------|-------------|
| `--help, -h` | Show help |
| `--version, -v` | Show version |
| `--verbose` | Enable verbose output |
| `--json` | Output as JSON |
| `--xml` | Output as XML |
| `--path <dir>` | Target directory (default: current directory) |

## Commands

### mdq status

Check if Meilisearch is running.

```
mdq status [options]
```

**Output (connected):**

```
Meilisearch: healthy (http://localhost:7700)
```

**Output (not connected):**

```
Meilisearch: not available
```

### mdq search

Search indexed markdown content.

```
mdq search <query> [options]
mdq search status    Check index status
```

**Options:**

| Option | Description |
|--------|-------------|
| `--labels <label>` | Filter by labels (comma-separated, OR logic) |
| `--author <email>` | Filter by author email |
| `--created-after <date>` | Documents created after date (YYYY-MM-DD) |
| `--created-before <date>` | Documents created before date (YYYY-MM-DD) |
| `--updated-after <date>` | Documents updated after date (YYYY-MM-DD) |
| `--updated-before <date>` | Documents updated before date (YYYY-MM-DD) |
| `--created-within <duration>` | Created within duration (e.g., 30d, 2w, 3m, 1y) |
| `--updated-within <duration>` | Updated within duration (e.g., 7d, 2w) |
| `--stale <duration>` | Not updated within duration (e.g., 90d, 6m) |
| `--sort <field>` | Sort by created_at or updated_at (prefix with - for desc) |
| `--limit <n>` | Max results (default: 10) |

**Examples:**

```bash
# Basic search
mdq search "authentication"

# Search with typo (still finds "authentication")
mdq search "authentcation"

# Filter by label
mdq search "api" --labels documentation

# Date filtering
mdq search "api" --updated-within 30d

# Find stale content
mdq search "" --stale 90d --labels documentation

# Browse all docs with a label
mdq search "" --labels api

# Sort by most recently updated
mdq search "security" --sort -updated_at --limit 10

# JSON output for scripting
mdq search "error handling" --json

# Search in specific directory
mdq search "setup" --path ~/docs/wiki
```

**Output (text):**

```
Found 3 results for "authentication"

1. Authentication Guide
   getting-started/authentication.md
   ...handles OAuth2 authentication flows for the API...

2. API Security
   api-reference/security.md
   ...token-based authentication using JWT...
```

### mdq index

Build the search index. Always performs a full reindex.

```
mdq index [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--path <dir>` | Directory to index (default: current directory) |
| `--verbose` | Show detailed progress |

**Examples:**

```bash
mdq index
mdq index --path ~/docs/wiki
mdq index --path ~/docs --verbose
```

**Output:**

```
Indexing markdown files...
  Found 142 files
  Connecting to Meilisearch...

Indexed 142 documents in 1.2s
```

**Exclusions:** Dot files/folders, `node_modules/`, `AGENTS.md`, `CLAUDE.md`, and patterns in `.mdignore` are automatically excluded.

### mdq embed

Generate vector embeddings for semantic search.

```
mdq embed [options]
mdq embed status    Check LLM and Meilisearch connectivity
```

**Options:**

| Option | Description |
|--------|-------------|
| `--path <dir>` | Directory to process (default: current directory) |
| `--batch-size <n>` | Max documents to process per run |
| `--time-limit <min>` | Max time to run in minutes |
| `--reset` | Reset and reprocess all documents |
| `--dry-run` | Preview what would be processed |
| `--verbose` | Show detailed progress |

**Examples:**

```bash
# Process all documents
mdq embed --path ~/docs --verbose

# Process in batches
mdq embed --path ~/docs --batch-size 50 --verbose

# Time-limited processing
mdq embed --path ~/docs --time-limit 10 --verbose

# Reset and reprocess
mdq embed --path ~/docs --reset --verbose

# Check status
mdq embed status
```

**Output (verbose):**

```
Processing documents...
  [1/142] Authentication Guide - chunking and embedding...
  [2/142] API Security - chunking and embedding...
  ...

Processed 142 documents
```

### mdq source

Manage registered sources for the MCP server. Sources are stored in `~/.config/mdq/sources.json` (or `$XDG_CONFIG_HOME/mdq/sources.json`).

```
mdq source add -s <path> [-d <desc>]       Add a source directory
mdq source add -s name:path [-d <desc>]    Add with explicit name
mdq source list                            List all registered sources
mdq source remove <name>                   Remove a source by name
```

**Options (for add):**

| Option | Description |
|--------|-------------|
| `-s <path>` | Source path (required) |
| `-d <description>` | Description of the source |

**Examples:**

```bash
# Add a source (name derived from directory)
mdq source add -s ~/docs

# Add with description
mdq source add -s ~/docs -d "Documentation"

# Add with explicit name
mdq source add -s kb:~/docs -d "Knowledge base"

# List registered sources
mdq source list

# Remove a source
mdq source remove kb
```

**Output (list):**

```
NAME  PATH              DESCRIPTION
----  ----              -----------
docs  /Users/me/docs    Documentation
kb    /Users/me/kb      Knowledge base
```

### mdq mcp

Launch an MCP server for AI assistant integration.

```
mdq mcp [sources...] [options]
```

**Source Resolution:**

1. If CLI sources are provided, use those (ignores registered sources)
2. If no CLI sources, use registered sources from `mdq source add`
3. If no registered sources, show helpful error

**Source Formats (CLI):**

| Format | Description |
|--------|-------------|
| `~/docs` | Single directory |
| `~/docs ~/wiki` | Multiple directories |
| `-s <path> -d <desc>` | Directory with description |
| `name:~/path` | Named directory |

**Options:**

| Option | Description |
|--------|-------------|
| `-s, --source <path>` | Add source directory |
| `-d, --desc <text>` | Description for preceding source |
| `--print-config` | Output Claude Desktop JSON config and exit |

**HTTP Mode Options:**

| Option | Description |
|--------|-------------|
| `--http` | Enable HTTP transport |
| `--port <number>` | Port to bind (default: 3000) |
| `--host <string>` | Host to bind (default: 127.0.0.1) |
| `--api-key <string>` | API key (or set MDQ_MCP_API_KEY) |
| `--no-auth` | Disable authentication (testing only) |

**Examples:**

```bash
# Use registered sources (recommended)
mdq source add -s ~/docs -d "Documentation"
mdq mcp

# CLI override with descriptions
mdq mcp -s ~/notes -d "Personal journal" -s ~/wiki -d "Team docs"

# HTTP mode
export MDQ_MCP_API_KEY="$(openssl rand -hex 32)"
mdq mcp --http -s ~/docs -d "Documentation"
```

**Startup (stderr):**

```
mdq mcp: serving 2 sources
  - notes: /Users/me/notes (Personal journal)
  - wiki: /Users/me/wiki (Team docs)
mdq mcp: Meilisearch connected
mdq mcp: MCP server running on stdio
```

See [mcp.md](mcp.md) for full MCP tool specifications.

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 6 | Invalid arguments |
| 9 | Meilisearch not available |
| 10 | Search index not found |
