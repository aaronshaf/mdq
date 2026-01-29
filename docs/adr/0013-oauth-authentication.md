# ADR 0013: OAuth 2.1 Authentication for MCP HTTP Transport

## Status

Accepted

## Context

The MCP HTTP transport currently uses simple Bearer token authentication (`MDQ_MCP_API_KEY`). While functional, this approach has limitations for production deployments:

1. **Static credentials** - API keys don't expire, increasing security risk
2. **No user consent flow** - Users can't approve/deny access per session
3. **Manual credential distribution** - Users must copy/paste API keys into Claude web UI
4. **No standard discovery** - Clients must be pre-configured with authentication details

Claude web UI and other modern MCP clients support OAuth 2.1 for more secure authentication. Adding OAuth support enables:
- **User consent flow** - Users approve each authorization in browser
- **Short-lived tokens** - Access tokens expire after 1 hour
- **Standard discovery** - OAuth metadata auto-discovered via `.well-known` endpoints
- **Better UX** - Claude can guide users through authorization flow

## Decision

Implement **OAuth 2.1 Authorization Code Flow with PKCE** alongside existing Bearer token authentication:

```bash
# 1. Setup OAuth client
mdq oauth setup --client-id claude --name "Claude"

# 2. Start HTTPS server with OAuth
mdq mcp --http --oauth --cert ./cert.pem --key ./key.pem ~/docs
```

**Keep Bearer token authentication** for backward compatibility and simple use cases.

## OAuth 2.1 Flow

```
┌─────────────┐                                           ┌─────────────┐
│   Claude    │                                           │  mdq server │
│   Web UI    │                                           │  (OAuth AS) │
└──────┬──────┘                                           └──────┬──────┘
       │                                                          │
       │ 1. Discover OAuth metadata                              │
       ├─────────────────────────────────────────────────────────▶
       │    GET /.well-known/oauth-protected-resource            │
       │    GET /.well-known/oauth-authorization-server          │
       │◀─────────────────────────────────────────────────────────┤
       │                                                          │
       │ 2. Start authorization (generate PKCE challenge)        │
       ├─────────────────────────────────────────────────────────▶
       │    GET /oauth/authorize                                 │
       │    ?client_id=claude                                    │
       │    &redirect_uri=https://claude.ai/oauth/callback       │
       │    &code_challenge=xxx                                  │
       │    &code_challenge_method=S256                          │
       │◀─────────────────────────────────────────────────────────┤
       │    200 OK (HTML authorization page)                     │
       │                                                          │
       │ 3. User approves in browser                             │
┌──────┴──────┐                                                  │
│   Browser   │                                                  │
└──────┬──────┘                                                  │
       │ POST /oauth/authorize (approve)                         │
       ├─────────────────────────────────────────────────────────▶
       │◀─────────────────────────────────────────────────────────┤
       │    302 Redirect                                         │
       │    https://claude.ai/oauth/callback?code=xxx&state=yyy  │
       │                                                          │
┌──────┴──────┐                                                  │
│   Claude    │                                                  │
│   Web UI    │                                                  │
└──────┬──────┘                                                  │
       │                                                          │
       │ 4. Exchange code for token (with PKCE verifier)         │
       ├─────────────────────────────────────────────────────────▶
       │    POST /oauth/token                                    │
       │    grant_type=authorization_code                        │
       │    code=xxx                                             │
       │    code_verifier=zzz                                    │
       │    client_id=claude                                     │
       │    client_secret=secret                                 │
       │◀─────────────────────────────────────────────────────────┤
       │    { access_token, refresh_token, expires_in }          │
       │                                                          │
       │ 5. Use access token for MCP requests                    │
       ├─────────────────────────────────────────────────────────▶
       │    POST /mcp                                            │
       │    Authorization: Bearer <access_token>                 │
       │◀─────────────────────────────────────────────────────────┤
       │    {MCP response}                                       │
       │                                                          │
```

### Refresh Token Flow

When the access token expires (after 1 hour), the client can use the refresh token to obtain a new access token without requiring user re-authorization:

```
┌──────┴──────┐                                            ┌─────────┐
│   Claude    │                                            │   mdq   │
│   Web UI    │                                            │ server  │
└──────┬──────┘                                            └────┬────┘
       │                                                        │
       │ POST /oauth/token                                      │
       ├───────────────────────────────────────────────────────▶
       │    grant_type=refresh_token                           │
       │    refresh_token=xxx                                  │
       │    client_id=claude                                   │
       │    client_secret=secret                               │
       │◀───────────────────────────────────────────────────────┤
       │    { access_token, expires_in, scope }                │
       │                                                        │
```

**Notes:**
- Refresh tokens expire after 30 days (configurable via `MDQ_OAUTH_REFRESH_TOKEN_EXPIRY`)
- Refresh tokens can be reused until they expire
- Refresh tokens are revocable via `/oauth/revoke`

### Token Revocation (RFC 7009)

Clients can explicitly revoke tokens when they're no longer needed:

```
┌──────┴──────┐                                            ┌─────────┐
│   Claude    │                                            │   mdq   │
│   Web UI    │                                            │ server  │
└──────┬──────┘                                            └────┬────┘
       │                                                        │
       │ POST /oauth/revoke                                     │
       ├───────────────────────────────────────────────────────▶
       │    token=xxx                                          │
       │    token_type_hint=access_token                       │
       │    client_id=claude                                   │
       │    client_secret=secret                               │
       │◀───────────────────────────────────────────────────────┤
       │    200 OK                                             │
       │                                                        │
```

**Notes:**
- Both access tokens and refresh tokens can be revoked
- `token_type_hint` is optional but improves performance
- Per RFC 7009, always returns 200 OK (even if token doesn't exist)

## Implementation Details

### OAuth Modules

```
src/lib/oauth/
├── types.ts           # TypeScript interfaces and Zod schemas
├── config.ts          # OAuth client configuration management
├── tokens.ts          # Token lifecycle (auth codes, access tokens, refresh tokens)
├── pkce.ts            # PKCE code challenge validation
├── metadata.ts        # .well-known endpoint generators
└── authorization.ts   # HTML authorization page renderer
```

### Security Features

1. **PKCE with S256** - Prevents authorization code interception
2. **Constant-time comparison** - Prevents timing attacks on secrets
3. **CSRF protection** - CSRF tokens for authorization form
4. **Rate limiting** - 5 failed token attempts = 5 min cooldown
5. **HTTPS required** - Enforced when OAuth enabled
6. **Short-lived tokens** - Auth codes: 5 min, access tokens: 1 hour, refresh tokens: 30 days
7. **File permissions** - 0600 for config and token storage
8. **Single-use codes** - Authorization codes deleted after exchange
9. **Token revocation** - Explicit revoke endpoint for access and refresh tokens

### Storage

- **OAuth clients**: `~/.config/mdq/oauth.json` (chmod 0600)
- **OAuth tokens**: `~/.config/mdq/oauth-tokens.json` (chmod 0600)

### CLI Commands

```bash
mdq oauth setup [--client-id <id>] [--name <name>]
mdq oauth list
mdq oauth status
mdq oauth remove <client-id>
```

### OAuth Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/.well-known/oauth-protected-resource` | GET | Protected resource metadata (RFC 8414) |
| `/.well-known/oauth-authorization-server` | GET | Authorization server metadata (RFC 8414) |
| `/oauth/authorize` | GET | Authorization page (user consent UI) |
| `/oauth/authorize` | POST | Process approval/denial |
| `/oauth/token` | POST | Token exchange (authorization_code + refresh_token grants) |
| `/oauth/revoke` | POST | Token revocation (RFC 7009) |

### Server Flags

```bash
mdq mcp --http --oauth --cert ./cert.pem --key ./key.pem
```

### Configuration

| Option | Environment | Default | Description |
|--------|-------------|---------|-------------|
| `--oauth` | - | false | Enable OAuth |
| `--cert` | - | (required) | TLS certificate |
| `--key` | - | (required) | TLS private key |
| - | `MDQ_OAUTH_TOKEN_EXPIRY` | 3600 | Access token lifetime (seconds) |
| - | `MDQ_OAUTH_REFRESH_TOKEN_EXPIRY` | 2592000 | Refresh token lifetime (seconds, default 30 days) |

## Rationale

### Why OAuth 2.1 (not OAuth 2.0)

OAuth 2.1 is the modern consolidated spec that:
- **Requires PKCE** - Security by default
- **Simplifies flows** - Removes deprecated grant types
- **Best practices** - Incorporates security best practices from RFC 8252, 8628, etc.

### Why PKCE is required

1. **Prevents authorization code interception** - Even if code is stolen, attacker can't exchange it without verifier
2. **No client secret exposure** - Public clients (like web apps) don't need to store secrets
3. **Standard practice** - OAuth 2.1 mandates PKCE for all clients

### Why S256 only (not plain)

1. **Security** - SHA256 hash prevents verifier from being derived from challenge
2. **Standard** - All modern clients support S256
3. **Simplicity** - No need to support weaker method

### Why short token expiry

1. **Security** - Limits exposure window if token is compromised
2. **User experience** - 1 hour sufficient for typical session
3. **Refresh tokens** - Use refresh tokens for long-lived access without re-authorization

### Why include refresh tokens

1. **Better UX** - Avoid frequent re-authorization for long-lived sessions
2. **Standard practice** - OAuth 2.1 includes refresh tokens for confidential clients
3. **Configurable expiry** - 30 day default, adjustable via env var
4. **Revocable** - Can be revoked via `/oauth/revoke` endpoint

### Why include revoke endpoint (RFC 7009)

1. **Security** - Allows clients to explicitly invalidate tokens
2. **Best practice** - Standard OAuth feature for token lifecycle management
3. **User control** - Users can revoke access when removing clients

### Why keep Bearer token authentication

1. **Backward compatibility** - Existing deployments continue working
2. **Simple use cases** - Quick testing, personal use
3. **Flexibility** - Both auth methods work simultaneously

## Consequences

### Positive

- Claude web UI users get standard OAuth flow with approval screen
- Short-lived tokens reduce security risk
- Auto-discovery via `.well-known` endpoints improves UX
- User consent flow is more transparent
- Backward compatible with existing Bearer token auth

### Negative

- HTTPS infrastructure required (certificate management)
- More complex setup than simple API key
- Token expiry requires re-authorization (by design)
- Additional storage for OAuth state (clients, codes, tokens)

### Mitigations

- **Self-signed certs** - Document generation for testing
- **Clear documentation** - Step-by-step OAuth setup guide
- **Bearer token fallback** - Simple auth still available
- **Auto-cleanup** - Expired tokens automatically removed

## Alternatives Considered

### 1. API Key only (status quo)

**Pros:**
- Simple setup
- No certificate management
- Works over HTTP

**Cons:**
- No token expiry
- No user consent flow
- Manual credential distribution
- Less secure

**Decision:** Rejected. OAuth provides better security and UX for production deployments.

### 2. OAuth 2.0 without PKCE

**Pros:**
- Simpler implementation
- Fewer moving parts

**Cons:**
- Vulnerable to authorization code interception
- Not recommended by modern standards
- OAuth 2.1 requires PKCE

**Decision:** Rejected. Security best practices mandate PKCE.

### 3. Client credentials flow

**Pros:**
- Simpler (no user approval)
- Machine-to-machine auth

**Cons:**
- No user consent
- Long-lived credentials
- Not suitable for web clients

**Decision:** Rejected. Authorization code flow is standard for web applications.

### 4. JWT tokens instead of opaque tokens

**Pros:**
- Stateless validation
- Can include claims

**Cons:**
- More complex implementation
- Can't revoke without additional infrastructure
- Overkill for single-user deployments

**Decision:** Rejected. Opaque tokens with server-side validation are simpler and sufficient.

## Testing Strategy

### Unit Tests

```bash
# PKCE validation
src/test/oauth-pkce.test.ts

# Config load/save
src/test/oauth-config.test.ts

# Token lifecycle
src/test/oauth-tokens.test.ts
```

### Integration Test

```bash
# 1. Setup
mdq oauth setup --client-id test --name "Test"
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes

# 2. Start server
mdq mcp --http --oauth --cert ./cert.pem --key ./key.pem --port 3000

# 3. Test discovery
curl https://localhost:3000/.well-known/oauth-protected-resource

# 4. Test authorization flow (with PKCE)
code_verifier=$(openssl rand -base64 32 | tr -d '=' | tr '+/' '-_')
code_challenge=$(echo -n "$code_verifier" | openssl dgst -sha256 -binary | base64 | tr -d '=' | tr '+/' '-_')
open "https://localhost:3000/oauth/authorize?client_id=test&redirect_uri=http://localhost:8080&state=test123&code_challenge=$code_challenge&code_challenge_method=S256"

# 5. Exchange code for token
curl -X POST https://localhost:3000/oauth/token \
  -d "grant_type=authorization_code&code=<CODE>&client_id=test&client_secret=<SECRET>&code_verifier=$code_verifier&redirect_uri=http://localhost:8080"

# 6. Use token for MCP
curl https://localhost:3000/mcp \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

## References

- [OAuth 2.1 Specification (Draft)](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1-11)
- [RFC 7636: PKCE](https://datatracker.ietf.org/doc/html/rfc7636)
- [RFC 8414: OAuth 2.0 Authorization Server Metadata](https://datatracker.ietf.org/doc/html/rfc8414)
- [OAuth 2.0 Security Best Current Practice](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-security-topics)
- [MCP HTTP Transport Specification](https://modelcontextprotocol.io/specification/2025-11-25/transports)
