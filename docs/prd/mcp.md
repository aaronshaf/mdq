# md mcp - Product Requirements Document

## Problem Statement

Users working with AI assistants (Claude Code, Claude Desktop, VS Code Copilot) cannot easily search their local markdown documentation from within their AI workflow. Current options are inadequate:

1. **Copy/paste content** - Manual, breaks flow, limited context window
2. **Ask AI to read files** - AI must guess paths, no search capability, slow for large collections
3. **Switch to terminal** - Run `md search`, copy results back, context switching overhead

Users need a way to expose their indexed markdown content directly to AI assistants via the Model Context Protocol (MCP), enabling seamless documentation lookup within their existing AI workflows.

## Goals

| Goal | Metric | Target |
|------|--------|--------|
| Seamless AI integration | Works with any MCP client | Claude Code, Desktop, VS Code |
| Fast search | Query response time | < 100ms (leverages Meilisearch) |
| Zero config for users | Setup complexity | Single command to start |
| Full search parity | Feature coverage | All `md search` filters supported |
| Multiple sources | Index multiple directories | Supported with descriptions |
| Registered sources | Persist source config | Store in `~/.config/md/sources.json` |
| Remote access | HTTP transport | Supported for Claude web UI |

## Non-Goals

- MCP Resources (tools only)
- Fallback to grep-style search (Meilisearch required)
- Writing or modifying files

## Solution Overview

`md mcp` command launches an MCP server over stdio or HTTP transport. The server exposes two tools (`search` and `read_page`) that allow MCP clients to query the local Meilisearch index and read file content.

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   MCP Client    │────▶│     md mcp       │────▶│   Meilisearch   │
│ (Claude Code)   │stdio│  (MCP Server)    │     │  (localhost)    │
└─────────────────┘  or └──────────────────┘     └─────────────────┘
                    HTTP        │
                               ▼
                        ┌──────────────────┐
                        │  Local Markdown  │
                        │     Files        │
                        └──────────────────┘
```

## Prerequisites

1. **Meilisearch running** - Same requirement as `md search`
2. **Index exists** - User must run `md index` first

## Registered Sources

Sources can be registered persistently using `md source` commands, eliminating the need to specify them on each `md mcp` invocation.

```bash
# Register sources once
md source add -s ~/docs -d "Documentation"
md source add -s ~/wiki -d "Team wiki"
md source list

# Start MCP server (uses registered sources)
md mcp
```

**Source resolution order:**
1. If CLI sources provided → use those (registered sources ignored)
2. If no CLI sources → use registered sources
3. If no registered sources → error with helpful message

**Storage:** `~/.config/md/sources.json` (or `$XDG_CONFIG_HOME/md/sources.json`)

## Multiple Sources (CLI)

Sources can also be provided directly on the command line (overrides registered sources):

```bash
# Multiple sources with descriptions
md mcp -s ~/notes -d "Personal journal" -s ~/wiki -d "Team docs"

# Explicit names to avoid collisions
md mcp -s work:~/work/docs -d "Work docs" -s personal:~/docs -d "Personal notes"
```

**Name derivation:**
- Derived from directory basename (e.g., `~/docs/wiki` → `wiki`)
- Collisions auto-resolve by adding parent path segments
- Explicit names (e.g., `wiki:~/path`) error on collision

## MCP Tools

### search

Search indexed markdown content across one or more sources.

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "Search query (supports typo tolerance)"
    },
    "source": {
      "type": "string",
      "description": "Source name to search (optional, searches all if omitted)"
    },
    "limit": {
      "type": "integer",
      "description": "Maximum results to return",
      "default": 10,
      "minimum": 1,
      "maximum": 100
    },
    "labels": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Filter by labels (OR logic)"
    },
    "author": {
      "type": "string",
      "description": "Filter by author email"
    },
    "created_after": {
      "type": "string",
      "format": "date",
      "description": "Filter: created after date (YYYY-MM-DD)"
    },
    "created_before": {
      "type": "string",
      "format": "date",
      "description": "Filter: created before date (YYYY-MM-DD)"
    },
    "updated_after": {
      "type": "string",
      "format": "date",
      "description": "Filter: updated after date (YYYY-MM-DD)"
    },
    "updated_before": {
      "type": "string",
      "format": "date",
      "description": "Filter: updated before date (YYYY-MM-DD)"
    },
    "created_within": {
      "type": "string",
      "description": "Filter: created within duration (e.g., 30d, 2w, 3m, 1y)"
    },
    "updated_within": {
      "type": "string",
      "description": "Filter: updated within duration (e.g., 7d, 2w)"
    },
    "stale": {
      "type": "string",
      "description": "Filter: NOT updated within duration (e.g., 90d, 6m)"
    },
    "sort": {
      "type": "string",
      "enum": ["created_at", "-created_at", "updated_at", "-updated_at"],
      "description": "Sort order (prefix with - for descending)"
    }
  },
  "required": ["query"]
}
```

**Output:**

Search results include a 200-character snippet of matching content.

```json
{
  "results": [
    {
      "id": "docs-api-auth",
      "title": "Authentication Guide",
      "path": "docs/api/auth.md",
      "source": "wiki",
      "snippet": "...handles OAuth2 authentication flows for the API...",
      "labels": ["documentation", "security"],
      "author": "john.doe@example.com",
      "created_at": "2024-01-10T10:00:00Z",
      "updated_at": "2024-06-15T14:30:00Z"
    }
  ],
  "total": 3,
  "query": "authentication"
}
```

### read_page

Read the full content of a specific file.

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "path": {
      "type": "string",
      "description": "Relative path to the markdown file"
    },
    "id": {
      "type": "string",
      "description": "Document ID from search results"
    },
    "source": {
      "type": "string",
      "description": "Source name (required when using path with multiple sources)"
    }
  },
  "oneOf": [
    { "required": ["path"] },
    { "required": ["id"] }
  ]
}
```

**Output:**

```json
{
  "id": "docs-api-auth",
  "title": "Authentication Guide",
  "path": "docs/api/auth.md",
  "source": "wiki",
  "content": "# Authentication Guide\n\nThis guide covers...",
  "metadata": {
    "labels": ["documentation", "security"],
    "author": "john.doe@example.com",
    "created_at": "2024-01-10T10:00:00Z",
    "updated_at": "2024-06-15T14:30:00Z"
  }
}
```

## Transport Modes

### stdio (default)

For local MCP clients like Claude Code and Claude Desktop:

```bash
md mcp -s ~/docs -d "Documentation"
```

### HTTP

For remote access from Claude web UI or other HTTP clients:

```bash
export MD_MCP_API_KEY="$(openssl rand -hex 32)"
md mcp --http -s ~/docs -d "Documentation"
md mcp --http --port 8080 --host 0.0.0.0 ~/docs
```

**Configuration:**

| Option | Environment | Default | Description |
|--------|-------------|---------|-------------|
| `--port` | `MD_MCP_PORT` | 3000 | Port to bind |
| `--host` | `MD_MCP_HOST` | 127.0.0.1 | Host to bind |
| `--api-key` | `MD_MCP_API_KEY` | (required) | Authentication key |
| `--no-auth` | - | false | Disable auth (testing only) |

**Exposing to internet:**

```bash
# Cloudflare Tunnel (recommended)
cloudflared tunnel --url http://localhost:3000

# Or ngrok
ngrok http 3000
```

**Connect from Claude web UI:**
1. Settings > Connectors > "Add custom connector"
2. URL: `https://your-tunnel-url.com/mcp`
3. Provide API key when prompted

## Configuration

### Claude Code

```bash
# Register sources first (one-time setup)
md source add -s ~/notes -d "Personal journal"
md source add -s ~/wiki -d "Team docs"

# Add MCP server (uses registered sources)
claude mcp add kb -- md mcp
```

Or add to `~/.claude/mcp.json`:

```json
{
  "mcpServers": {
    "kb": {
      "command": "md",
      "args": ["mcp"]
    }
  }
}
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
      "args": ["run", "/Users/YOU/.bun/bin/md", "mcp"]
    }
  }
}
```

**Important:** Claude Desktop doesn't inherit your shell PATH. Run `which bun` and `which md` to find the full paths for your system.

Note: Register sources first with `md source add -s <path> -d <description>`.

### VS Code (Copilot)

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "kb": {
      "command": "md",
      "args": ["mcp", "${workspaceFolder}/docs"]
    }
  }
}
```

Note: VS Code typically uses workspace-relative paths, so CLI sources are often preferred here.

## Error Handling

### Startup Errors

| Condition | Exit Code | stderr Message |
|-----------|-----------|----------------|
| No sources (CLI or registered) | 6 | `Error: No sources provided and no sources registered` |
| Registered source path missing | 6 | `Error: Some registered source paths no longer exist` |
| Meilisearch unavailable | 9 | `Error: Meilisearch not available` |
| Index not found | 10 | `Error: No search index found` |
| No API key (HTTP mode) | 6 | `Error: API key required for HTTP mode` |

### Tool Errors

Return MCP error responses:

| Condition | Error Code | Message |
|-----------|------------|---------|
| Invalid query params | -32602 | `Invalid params: {details}` |
| File not found | -32602 | `File not found: {path}` |
| Search failed | -32603 | `Search error: {details}` |

## Architecture

### Files

```
src/
├── lib/
│   ├── config/
│   │   └── sources.ts         # Registered sources config (~/.config/md/sources.json)
│   ├── path-utils.ts          # Shared path utilities (tilde expansion)
│   └── mcp/
│       ├── index.ts           # MCP module exports
│       ├── server.ts          # McpServer setup and transport
│       ├── http.ts            # HTTP transport implementation
│       ├── handlers.ts        # Tool implementations
│       ├── tools.ts           # Tool schemas
│       ├── sources.ts         # Multi-source handling (CLI parsing)
│       └── types.ts           # MCP-specific types
└── cli/
    └── commands/
        ├── mcp.ts             # md mcp command
        └── source.ts          # md source command
```

### Dependencies

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.25.0"
  }
}
```

## Security Considerations

1. **stdio mode**: Cannot be accessed remotely
2. **HTTP mode**: Requires API key authentication (unless `--no-auth`)
3. **Read-only**: No tools modify files
4. **Path validation**: `read_page` validates paths are within indexed directories
5. **CORS**: Configurable via `MD_MCP_CORS_ORIGIN` (default: `https://claude.ai`)

## References

- [Model Context Protocol Specification](https://modelcontextprotocol.io/specification/2025-11-25)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [md search PRD](./search.md)
