# ADR 0009: Dual Async/Effect API Pattern

## Status

Accepted

## Context

We're using Effect for error handling, but some consumers may prefer simple async/await. Need to decide on API design.

## Decision

Provide both async and Effect-based methods for public APIs, with Effect as the primary implementation.

## Rationale

- **Flexibility**: Users can choose their preferred style
- **Gradual adoption**: Start with async, migrate to Effect over time
- **cn pattern**: Proven approach in cn project
- **Internal consistency**: Effect internally, async for convenience

## Implementation

### Pattern

```typescript
class SearchClient {
  // Effect-based (primary implementation)
  searchEffect(query: string): Effect.Effect<SearchResponse, SearchError> {
    return pipe(
      Effect.tryPromise({
        try: () => this.client.search(query),
        catch: (e) => new SearchError(`Search failed: ${e}`)
      }),
      Effect.map(this.formatResults)
    );
  }

  // Async wrapper (convenience)
  async search(query: string): Promise<SearchResponse> {
    return Effect.runPromise(this.searchEffect(query));
  }
}
```

### Naming Convention

| Style | Method Name | Return Type |
|-------|-------------|-------------|
| Effect | `searchEffect` | `Effect<SearchResponse, SearchError>` |
| Async | `search` | `Promise<SearchResponse>` |

The `Effect` suffix clearly indicates the Effect-based version.

### When to Use Each

**Use Effect methods when:**
- Composing multiple operations
- Need fine-grained error handling
- Building pipelines with retry/timeout
- Writing library code

**Use async methods when:**
- Simple one-off calls
- CLI command handlers
- Quick scripts
- Familiar async/await is sufficient

## Example Usage

### Effect Style
```typescript
const result = await Effect.runPromise(
  pipe(
    client.searchEffect(query),
    Effect.flatMap(response =>
      client.readDocumentEffect(response.results[0].path)
    ),
    Effect.retry(retrySchedule),
    Effect.timeout('30 seconds')
  )
);
```

### Async Style
```typescript
try {
  const response = await client.search(query);
  const document = await client.readDocument(response.results[0].path);
} catch (error) {
  console.error('Failed:', error.message);
}
```

## Consequences

### Positive
- Supports both programming styles
- Effect benefits available when needed
- Simple async for straightforward cases
- Easier onboarding for Effect newcomers

### Negative
- Two methods per operation (more code)
- Must keep both in sync
- Potential confusion about which to use

## Guidelines

1. Implement Effect version first (primary)
2. Async is thin wrapper calling Effect
3. Document both in JSDoc
4. Tests should cover both APIs
