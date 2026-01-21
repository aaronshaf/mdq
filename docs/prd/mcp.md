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

## Non-Goals

- HTTP/SSE transport (stdio only for v1)
- Remote/networked access (local only)
- MCP Resources (tools only for v1)
- Fallback to grep-style search (Meilisearch required)
- Writing or modifying files

## Solution Overview

`md mcp` command launches an MCP server over stdio transport. The server exposes two tools (`search` and `read`) that allow MCP clients to query the local Meilisearch index and read file content.

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   MCP Client    │────▶│     md mcp       │────▶│   Meilisearch   │
│ (Claude Code)   │stdio│  (MCP Server)    │     │  (localhost)    │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌──────────────────┐
                        │  Local Markdown  │
                        │     Files        │
                        └──────────────────┘
```

## Prerequisites

1. **Meilisearch running** - Same requirement as `md search`
2. **Index exists** - User must run `md search index` first

## MCP Tools

### search

Search indexed markdown content.

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "Search query (supports typo tolerance)"
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
      "snippet": "...handles OAuth2 authentication flows for the API...",
      "labels": ["documentation", "security"],
      "author": "john.doe@example.com",
      "created_at": "2024-01-10T10:00:00Z",
      "updated_at": "2024-06-15T14:30:00Z",
      "url": "https://example.com/docs/auth"
    }
  ],
  "total": 3,
  "query": "authentication"
}
```

### read

Read the full content of a specific file.

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "path": {
      "type": "string",
      "description": "Relative path to the markdown file (e.g., 'docs/api/auth.md')"
    },
    "id": {
      "type": "string",
      "description": "Document ID from search results"
    }
  },
  "oneOf": [
    { "required": ["path"] },
    { "required": ["id"] }
  ]
}
```

**ID Resolution:** When `id` is provided instead of `path`, the tool queries Meilisearch to look up the document's `local_path` field. This adds one extra query but keeps the tool flexible.

**Output:**

```json
{
  "id": "docs-api-auth",
  "title": "Authentication Guide",
  "path": "docs/api/auth.md",
  "content": "# Authentication Guide\n\nThis guide covers...",
  "metadata": {
    "labels": ["documentation", "security"],
    "author": "john.doe@example.com",
    "created_at": "2024-01-10T10:00:00Z",
    "updated_at": "2024-06-15T14:30:00Z",
    "url": "https://example.com/docs/auth"
  }
}
```

## Configuration

### Claude Code

Add to `~/.claude/mcp.json` or project `.claude/mcp.json`:

```json
{
  "mcpServers": {
    "my-docs": {
      "command": "md",
      "args": ["mcp", "/path/to/docs"]
    }
  }
}
```

With custom Meilisearch URL:

```json
{
  "mcpServers": {
    "my-docs": {
      "command": "md",
      "args": ["mcp", "/path/to/docs"],
      "env": {
        "MEILISEARCH_URL": "http://localhost:8080"
      }
    }
  }
}
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "my-docs": {
      "command": "md",
      "args": ["mcp", "/path/to/docs"]
    }
  }
}
```

### VS Code (Copilot)

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "my-docs": {
      "command": "md",
      "args": ["mcp", "${workspaceFolder}/docs"]
    }
  }
}
```

## Error Handling

### Startup Errors

| Condition | Exit Code | stderr Message |
|-----------|-----------|----------------|
| Meilisearch unavailable | 9 | `Error: Meilisearch not available at http://localhost:7700. Start it with: docker run -d -p 7700:7700 getmeili/meilisearch:latest` |
| Index not found | 10 | `Error: No search index found. Run 'md search index' first.` |

### Tool Errors

Return MCP error responses (not exit codes):

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
│   └── mcp/
│       ├── index.ts           # MCP module exports
│       ├── server.ts          # McpServer setup and transport
│       ├── handlers.ts        # Tool implementations
│       ├── tools.ts           # Tool schemas
│       └── types.ts           # MCP-specific types
└── cli/
    └── commands/
        └── mcp.ts             # md mcp command
```

### Dependencies

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0"
  }
}
```

### Key Implementation Details

1. **stdio transport**: Use `StdioServerTransport` from SDK
2. **Logging**: All logs to stderr (stdout reserved for JSON-RPC)
3. **Graceful shutdown**: Handle SIGINT/SIGTERM to close connections
4. **Error responses**: Return MCP-compliant error objects

## Security Considerations

1. **Local only**: stdio transport cannot be accessed remotely
2. **Read-only**: No tools modify files
3. **Path validation**: `read` validates paths are within the indexed directory
4. **No credentials exposed**: MCP responses never include sensitive data

## Testing Strategy

### Unit Tests

- `mcp/server.test.ts` - Server initialization, tool registration
- `mcp/handlers.test.ts` - Tool input validation, output formatting

### Integration Tests

- End-to-end MCP message flow (mock stdio)
- Real Meilisearch queries
- Error handling paths

### Manual Testing

```bash
# Test with MCP Inspector
npx @anthropic-ai/mcp-inspector md mcp

# Test with Claude Code
claude --mcp-config test-mcp.json
```

## References

- [Model Context Protocol Specification](https://modelcontextprotocol.io/specification/2025-11-25)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [MCP Servers Repository](https://github.com/modelcontextprotocol/servers)
- [md search PRD](./search.md)
