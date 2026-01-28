# ADR 0011: Chunked Embeddings for Semantic Search

## Status

Accepted (Updated)

## Context

Keyword search has limitations:

1. **Vocabulary mismatch** - User searches "auth" but document says "login credentials"
2. **Context loss** - Keywords don't capture document meaning or relationships
3. **Long documents** - Important information buried in lengthy content

Users want semantic search that understands document meaning, not just keyword matching.

### Previous Approach (Superseded)

Initially planned to generate AI summaries for each document, then embed the summaries. This was abandoned because:

1. Summary generation was slow (LLM call per document)
2. Summaries lost important details from the original content
3. Required both LLM model and embedding model

### Current Approach

Chunk documents and embed each chunk directly. This provides:

1. **Better coverage** - All content is embedded, not just a summary
2. **Faster processing** - Only embedding model needed, no LLM generation
3. **Finer granularity** - Search can match specific sections within documents

## Decision

Implement **chunked embeddings** via `mdq embed` command that:

1. **Chunks documents** into smaller pieces (respecting paragraph/sentence boundaries)
2. **Generates embeddings** for each chunk using configurable embedding model (default: Ollama with nomic-embed-text)
3. **Stores chunks in separate index** (`{indexName}-chunks`) with vector embeddings
4. **Enables hybrid search** automatically when embeddings exist

```bash
# Index documents
mdq index --path ~/docs

# Generate embeddings
mdq embed --path ~/docs --verbose

# Search uses hybrid mode automatically
mdq search "authentication concepts"
```

## Rationale

### Why chunking (not whole document embeddings)

1. **Long document problem** - Embedding models have token limits; long docs get truncated
2. **Better precision** - Chunks allow matching specific sections, not just whole docs
3. **Deduplication** - Similar content in different docs shares embedding space efficiently

### Why separate chunks index

1. **Clean separation** - Documents and chunks have different schemas
2. **Independent updates** - Can regenerate embeddings without touching source index
3. **Query flexibility** - Can search chunks or documents independently

### Why Ollama as default

1. **Local-first** - No API costs, works offline
2. **Privacy** - Documents stay on user's machine
3. **Free** - No per-document charges
4. **Quality** - nomic-embed-text provides good semantic matching

### Why configurable providers

1. **Flexibility** - Users can use OpenAI, etc. for different quality/speed tradeoffs
2. **Enterprise** - Organizations may prefer their existing embedding infrastructure

## Consequences

### Positive

- Semantic search finds documents by meaning
- All content is searchable (not just summaries)
- Faster than LLM-based summary generation
- Works with any embedding provider (local or cloud)
- Hybrid search combines keyword + semantic ranking

### Negative

- Requires additional setup (Ollama or API keys)
- Processing time for large document sets
- Storage overhead for chunk embeddings

### Mitigations

- `mdq embed status` verifies embedding service connectivity
- Batch processing with `--batch-size` and `--time-limit`
- Incremental updates (only processes changed documents)
- `--reset` flag to reprocess everything if needed

## Implementation Notes

### Chunk schema

```typescript
interface ChunkDocument {
  id: string              // "{docId}-chunk-{index}"
  doc_id: string          // Parent document ID
  chunk_index: number     // Position in document
  content: string         // Chunk text
  _vectors: {
    default: number[]     // Embedding vector
  }
}
```

### Document tracking

```typescript
interface SearchDocument {
  // ... existing fields ...
  embedded_at: number | null  // Timestamp when embeddings were generated
}
```

### Configuration

```bash
# Embedding model (Ollama - default)
export MD_EMBEDDING_ENDPOINT="http://localhost:11434"
export MD_EMBEDDING_MODEL="nomic-embed-text:latest"
export MD_EMBEDDING_DIMENSIONS="768"

# OpenAI
export MD_EMBEDDING_ENDPOINT="https://api.openai.com/v1"
export MD_EMBEDDING_MODEL="text-embedding-3-small"
export MD_EMBEDDING_DIMENSIONS="1536"
export MD_EMBEDDING_API_KEY="sk-..."
```

### Processing flow

1. Find documents needing embedding (`embedded_at` is null or `updated_at > embedded_at`)
2. For each document:
   - Chunk content into ~500 token pieces
   - Generate embeddings for all chunks in batch
   - Store chunks in `{indexName}-chunks` index
   - Update document's `embedded_at` timestamp
3. Meilisearch uses hybrid search when chunks index has vectors

## References

- [Meilisearch Vector Search](https://www.meilisearch.com/docs/learn/experimental/vector_search)
- [Ollama](https://ollama.ai/)
- [nomic-embed-text embedding model](https://ollama.ai/library/nomic-embed-text)
