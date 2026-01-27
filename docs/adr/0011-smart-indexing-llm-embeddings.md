# ADR 0011: Smart Indexing with LLM Summaries and Embeddings

## Status

Accepted

## Context

Keyword search has limitations:

1. **Vocabulary mismatch** - User searches "auth" but document says "login credentials"
2. **Context loss** - Keywords don't capture document meaning or relationships
3. **Long documents** - Important information buried in lengthy content

Users want semantic search that understands document meaning, not just keyword matching.

Options evaluated:

| Option | Pros | Cons |
|--------|------|------|
| **Ollama (local LLM)** | Free, private, offline | Slower, requires local GPU/CPU |
| **OpenAI API** | Fast, high quality | Cost per document, requires internet |
| **Anthropic API** | Fast, high quality | Cost per document, requires internet |
| **Hybrid approach** | Flexibility | More configuration |

## Decision

Implement **smart indexing** via `md embed` command that:

1. **Generates summaries** using a configurable LLM (default: Ollama with qwen2.5:7b)
2. **Generates embeddings** using a configurable embedding model (default: Ollama with nomic-embed-text)
3. **Stores in Meilisearch** alongside existing document content
4. **Enables hybrid search** automatically when embeddings exist

```bash
# Index documents
md index --path ~/docs

# Add summaries and embeddings
md embed --path ~/docs --verbose

# Search uses hybrid mode automatically
md search "authentication concepts"
```

## Rationale

### Why separate command (not part of `md index`)

1. **Optional enhancement** - Not all users need or want AI features
2. **Long-running operation** - LLM calls take seconds per document
3. **Different requirements** - Needs Ollama/API keys, separate from Meilisearch
4. **Incremental processing** - Can process in batches over time

### Why Ollama as default

1. **Local-first** - No API costs, works offline
2. **Privacy** - Documents stay on user's machine
3. **Free** - No per-document charges
4. **Good quality** - Modern small models produce useful summaries

### Why configurable providers

1. **Flexibility** - Users can use Claude, GPT-4, etc. for higher quality
2. **Speed** - Cloud APIs faster than local models
3. **Enterprise** - Organizations may prefer their existing AI infrastructure

### Why summaries + embeddings (not just embeddings)

1. **Search display** - Summaries provide useful preview in results
2. **Better embeddings** - Embed summary (meaning) rather than raw content (noise)
3. **Debugging** - Human-readable summaries help verify quality

## Consequences

### Positive

- Semantic search finds documents by meaning
- Summaries improve search result previews
- Works with any LLM provider (local or cloud)
- Hybrid search combines keyword + semantic ranking

### Negative

- Requires additional setup (Ollama or API keys)
- Processing time for large document sets
- Storage overhead for embeddings

### Mitigations

- `md embed status` verifies LLM/embedding connectivity
- Batch processing with `--batch-size` and `--time-limit`
- Incremental updates (only processes changed documents)
- `--reset` flag to reprocess everything if needed

## Implementation Notes

### Document fields

```typescript
interface SmartDocument extends SearchDocument {
  summary: string | null           // AI-generated summary
  _vectors: {                      // Meilisearch vector format
    default: number[]              // Embedding vector
  } | null
  smart_indexed_at: number | null  // Timestamp of last processing
}
```

### Configuration

```bash
# LLM for summaries
export MD_LLM_ENDPOINT="http://localhost:11434/v1"
export MD_LLM_MODEL="qwen2.5:7b"
export MD_LLM_API_KEY=""  # Only for cloud providers

# Embedding model
export MD_EMBEDDING_ENDPOINT="http://localhost:11434"
export MD_EMBEDDING_MODEL="nomic-embed-text:latest"
export MD_EMBEDDING_DIMENSIONS="768"
```

### Processing flow

1. Find documents needing work (no summary or `updated_at > smart_indexed_at`)
2. For each document:
   - Generate summary via LLM
   - Generate embedding from title + summary
   - Update document in Meilisearch
3. Meilisearch automatically uses hybrid search when `_vectors` exists

## References

- [Meilisearch Vector Search](https://www.meilisearch.com/docs/learn/experimental/vector_search)
- [Ollama](https://ollama.ai/)
- [nomic-embed-text embedding model](https://ollama.ai/library/nomic-embed-text)
