# ADR 0012: MCP HTTP Transport for Remote Access

## Status

Accepted

## Context

The initial MCP implementation used stdio transport only, which works for local clients (Claude Code, Claude Desktop). However, users want to access their indexed markdown from:

1. **Claude web UI** (claude.ai) - Requires HTTP endpoint
2. **Remote machines** - Accessing home server documentation
3. **Team sharing** - Multiple users accessing shared knowledge base

Stdio transport cannot serve these use cases as it requires the MCP server to run as a subprocess of the client.

## Decision

Add **HTTP transport** as an optional mode for the MCP server:

```bash
# Generate API key
export MD_MCP_API_KEY="$(openssl rand -hex 32)"

# Start HTTP server
md mcp --http -s ~/docs -d "Documentation"

# Custom port/host
md mcp --http --port 8080 --host 0.0.0.0 -s ~/docs -d "Documentation"
```

Users expose the server via tunnel (Cloudflare Tunnel, ngrok) to connect from Claude web UI.

## Rationale

### Why HTTP in addition to stdio (not replacing)

1. **Backwards compatible** - Existing Claude Code/Desktop configs continue to work
2. **Security** - stdio remains default for local-only use (no network exposure)
3. **Simplicity** - Local users don't need to manage API keys

### Why API key authentication

1. **Security** - Prevents unauthorized access to user's documents
2. **Simple** - Single key, no user management
3. **Standard** - Bearer token authentication widely supported

### Why tunnel approach (not direct exposure)

1. **HTTPS** - Tunnels provide SSL termination (required by Claude web UI)
2. **No port forwarding** - Works behind NAT/firewall
3. **Dynamic DNS** - No need for static IP
4. **Free options** - Cloudflare Tunnel and ngrok free tiers sufficient

### Why configurable CORS

1. **Default to claude.ai** - Most common use case
2. **Configurable** - Support other clients if needed
3. **Security** - Explicit allowlist prevents unauthorized origins

## Consequences

### Positive

- Access markdown search from Claude web UI anywhere
- Team members can share a knowledge base server
- Works with any MCP-compatible HTTP client

### Negative

- Security responsibility on user (API key management)
- Additional infrastructure (tunnel service)
- Potential latency for remote access

### Mitigations

- Strong default: localhost-only binding (`127.0.0.1`)
- Clear documentation on API key generation
- `--no-auth` flag explicitly labeled "for testing only"
- CORS restricted to `claude.ai` by default

## Implementation Notes

### Options

| Flag | Environment | Default | Description |
|------|-------------|---------|-------------|
| `--http` | - | false | Enable HTTP transport |
| `--port` | `MD_MCP_PORT` | 3000 | Port to bind |
| `--host` | `MD_MCP_HOST` | 127.0.0.1 | Host to bind |
| `--api-key` | `MD_MCP_API_KEY` | (required) | Authentication key |
| `--no-auth` | - | false | Disable auth (testing) |
| - | `MD_MCP_CORS_ORIGIN` | `https://claude.ai` | Allowed CORS origin |

### Endpoint

```
POST /mcp
Authorization: Bearer <api-key>
Content-Type: application/json

{JSON-RPC message}
```

### Security considerations

1. **Localhost by default** - Must explicitly bind to `0.0.0.0` for network access
2. **No auth = error** - HTTP mode requires API key unless `--no-auth` explicitly set
3. **CORS restricted** - Only `claude.ai` by default
4. **Read-only** - MCP tools cannot modify files

## References

- [MCP Specification - HTTP Transport](https://modelcontextprotocol.io/specification/2025-11-25/transports)
- [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
- [ngrok](https://ngrok.com/)
