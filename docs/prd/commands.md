# md CLI Commands

## Global Options

| Option | Description |
|--------|-------------|
| `--help, -h` | Show help |
| `--version, -v` | Show version |
| `--verbose` | Enable debug output |
| `--path <dir>` | Target directory (default: current directory) |

## Commands

### md search

Search indexed markdown content.

```
md search <query> [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--labels <label>` | Filter by label (repeatable) |
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
| `--json` | Output as JSON |
| `--xml` | Output as XML |

**Examples:**

```bash
# Basic search
md search "authentication"

# Search with typo (still finds "authentication")
md search "authentcation"

# Filter by label
md search "api" --labels documentation

# Multiple filters
md search "config" --labels api --labels internal

# Date filtering
md search "api" --updated-within 30d

# Find stale content (empty query returns all docs, filters apply)
md search "" --stale 90d --labels documentation

# Browse all docs with a label
md search "" --labels api

# Sort by most recently updated
md search "security" --sort -updated_at --limit 10

# JSON output for scripting
md search "error handling" --json

# Search in specific directory
md search "setup" --path ~/docs/wiki
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

3. SSO Configuration
   admin/sso-config.md
   ...SAML authentication setup for enterprise...
```

**Output (XML):**

```xml
<result>
  <item>
    <id>getting-started-authentication</id>
    <title>Authentication Guide</title>
    <path>getting-started/authentication.md</path>
    <snippet>...handles OAuth2 authentication flows for the API...</snippet>
    <labels>
      <item>documentation</item>
      <item>security</item>
    </labels>
    <author_email>user@example.com</author_email>
    <created_at>1769018471085</created_at>
    <updated_at>1769018471085</updated_at>
  </item>
</result>
```

### md search index

Build the search index. Always performs a full reindex (deletes existing index, recreates from current files).

```
md search index [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--path <dir>` | Directory to index (default: current directory) |

**Examples:**

```bash
# Build index for current directory
md search index

# Index specific directory
md search index --path ~/docs/wiki
```

**Output:**

```
Indexing markdown files...
  Scanning for .md files...
  Found 142 files

  Connecting to Meilisearch (http://localhost:7700)...
  Indexing documents...

✓ Indexed 142 documents in 1.2s
```

**Exclusions:** Dot files/folders, `node_modules/`, `AGENTS.md`, and `CLAUDE.md` are automatically excluded.

### md search status

Check Meilisearch connection and index status.

```
md search status [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--path <dir>` | Directory to check (default: current directory) |
| `--xml` | Output as XML |

**Output (connected):**

```
Search Status
  Meilisearch: ✓ Connected (http://localhost:7700)
  Index: md-wiki (142 documents)
  Directory: /Users/me/docs/wiki
```

**Output (not connected):**

```
Search Status
  Meilisearch: ✗ Not connected

  To start Meilisearch:
    docker run -d -p 7700:7700 getmeili/meilisearch:latest
```

### md mcp

Launch an MCP server for AI assistant integration.

```
md mcp [path] [options]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `[path]` | Path to markdown directory (default: current directory) |

**Examples:**

```bash
# Start MCP server for current directory
md mcp

# Start MCP server for specific directory
md mcp ~/docs/wiki
```

**Startup (stderr):**

```
md mcp: serving directory /Users/me/docs/wiki
md mcp: Meilisearch connected at http://localhost:7700
md mcp: index "md-wiki" ready (142 documents)
md mcp: MCP server running on stdio
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
