# ADR 0004: LLM-Friendly XML Output

## Status

Accepted

## Context

CLI tools are increasingly used with LLMs (piping output to Claude, GPT, etc.). Structured output improves LLM parsing accuracy.

Options:
1. **Human-only output** - Just pretty text
2. **JSON output** - Machine-readable but verbose
3. **XML output** - Structured, LLM-friendly, matches cn pattern

## Decision

Support `--xml` flag for structured XML output on relevant commands.

## Rationale

- **LLM parsing**: XML tags are well-understood by LLMs
- **Structured data**: Clear boundaries between fields
- **cn pattern**: Proven useful in cn project
- **Optional**: Default remains human-friendly

## Implementation

### Global Flag
```
--xml    Output in XML format for LLM consumption
```

### Commands with XML Support
- `md search` - Search results
- `md search status` - Index status

### Output Examples

#### md search --xml
```xml
<search-results query="authentication" count="3">
  <result rank="1">
    <title>Authentication Guide</title>
    <path>getting-started/authentication.md</path>
    <labels>
      <label>documentation</label>
      <label>security</label>
    </labels>
    <snippet>...handles OAuth2 authentication flows for the API...</snippet>
  </result>
  <!-- ... -->
</search-results>
```

#### md search status --xml
```xml
<search-status>
  <meilisearch status="connected" url="http://localhost:7700"/>
  <index name="md-wiki" documents="142"/>
  <directory>/Users/me/docs/wiki</directory>
</search-status>
```

### Formatter Pattern
```typescript
interface OutputFormatter {
  formatSearchResults(results: SearchResponse): string;
  formatStatus(status: IndexStatus): string;
}

class HumanFormatter implements OutputFormatter { ... }
class XmlFormatter implements OutputFormatter { ... }
class JsonFormatter implements OutputFormatter { ... }

function getFormatter(options: { xml?: boolean; json?: boolean }): OutputFormatter {
  if (options.xml) return new XmlFormatter();
  if (options.json) return new JsonFormatter();
  return new HumanFormatter();
}
```

## Consequences

### Positive
- Better LLM integration
- Scriptable output
- Clear data structure
- No breaking change (opt-in)

### Negative
- Multiple output formats to maintain
- XML is verbose
- Must ensure proper escaping

## XML Escaping
```typescript
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
```
