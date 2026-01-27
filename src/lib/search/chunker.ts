/**
 * Text chunking for embedding-based semantic search.
 *
 * Strategy:
 * - Target chunk size: 400-512 tokens (~1600-2048 chars)
 * - Overlap: 64 tokens (~256 chars) to preserve context across boundaries
 * - Prefer natural break points: \n\n > ". " > whitespace
 * - Title prepended to each chunk for better embedding context
 */

// Token estimation: ~4 chars per token (reasonable for English text)
const CHARS_PER_TOKEN = 4;
const TARGET_TOKENS = 450; // Middle of 400-512 range
const MAX_TOKENS = 512;
const OVERLAP_TOKENS = 64;

const BASE_TARGET_CHARS = TARGET_TOKENS * CHARS_PER_TOKEN;
const BASE_MAX_CHARS = MAX_TOKENS * CHARS_PER_TOKEN;
const OVERLAP_CHARS = OVERLAP_TOKENS * CHARS_PER_TOKEN;

// Title prefix overhead: "\n\n" between title and content
const TITLE_PREFIX_OVERHEAD = 2;

export interface Chunk {
	index: number;
	content: string;
	// Content with title prepended for embedding
	embeddingContent: string;
}

export interface ChunkOptions {
	title: string;
	content: string;
}

/**
 * Find the best split point near the target position.
 * Prefers: paragraph break > sentence end > word boundary
 */
function findSplitPoint(text: string, targetPos: number, maxPos: number): number {
	const textLen = text.length;
	// Don't search past the max position, and leave room for lookahead
	const searchEnd = Math.min(targetPos + 200, maxPos, textLen - 1);
	const searchStart = Math.max(targetPos - 200, 0);
	// For backward loops, ensure we don't start where i+1 would be out of bounds
	const safeTargetPos = Math.min(targetPos, textLen - 2);

	// Look for paragraph break (\n\n) near target
	for (let i = targetPos; i < searchEnd; i++) {
		if (text[i] === '\n' && text[i + 1] === '\n') {
			return Math.min(i + 2, textLen);
		}
	}
	for (let i = safeTargetPos; i > searchStart; i--) {
		if (text[i] === '\n' && text[i + 1] === '\n') {
			return Math.min(i + 2, textLen);
		}
	}

	// Look for sentence end (". " or ".\n") near target
	for (let i = targetPos; i < searchEnd; i++) {
		if (text[i] === '.' && (text[i + 1] === ' ' || text[i + 1] === '\n')) {
			return Math.min(i + 2, textLen);
		}
	}
	for (let i = safeTargetPos; i > searchStart; i--) {
		if (text[i] === '.' && (text[i + 1] === ' ' || text[i + 1] === '\n')) {
			return Math.min(i + 2, textLen);
		}
	}

	// Look for word boundary (space or newline) near target
	for (let i = targetPos; i < searchEnd; i++) {
		if (text[i] === ' ' || text[i] === '\n') {
			return i + 1;
		}
	}
	for (let i = targetPos; i > searchStart; i--) {
		if (text[i] === ' ' || text[i] === '\n') {
			return i + 1;
		}
	}

	// Fallback: split at max position
	return Math.min(maxPos, textLen);
}

/**
 * Chunk text into overlapping segments suitable for embedding.
 *
 * @param options - Title and content to chunk
 * @returns Array of chunks with index, content, and embedding-ready content
 */
export function chunkText(options: ChunkOptions): Chunk[] {
	const { title, content } = options;
	const trimmedContent = content.trim();

	// Empty content gets no chunks
	if (!trimmedContent) {
		return [];
	}

	// Account for title length in embedding content: "title\n\ncontent"
	const titleOverhead = title.length + TITLE_PREFIX_OVERHEAD;
	const maxChars = Math.max(BASE_MAX_CHARS - titleOverhead, 256); // Minimum 256 chars for content
	const targetChars = Math.max(BASE_TARGET_CHARS - titleOverhead, 200);

	// Small documents: single chunk
	if (trimmedContent.length <= maxChars) {
		return [
			{
				index: 0,
				content: trimmedContent,
				embeddingContent: `${title}\n\n${trimmedContent}`,
			},
		];
	}

	const chunks: Chunk[] = [];
	let position = 0;
	let index = 0;

	while (position < trimmedContent.length) {
		// Calculate target end position
		const targetEnd = position + targetChars;
		const maxEnd = position + maxChars;

		// Find the best split point
		let endPos: number;
		if (targetEnd >= trimmedContent.length) {
			// Last chunk: take everything remaining
			endPos = trimmedContent.length;
		} else {
			endPos = findSplitPoint(trimmedContent, targetEnd, maxEnd);
		}

		// Extract chunk content
		const chunkContent = trimmedContent.slice(position, endPos).trim();

		if (chunkContent) {
			chunks.push({
				index,
				content: chunkContent,
				embeddingContent: `${title}\n\n${chunkContent}`,
			});
			index++;
		}

		// Move position forward, accounting for overlap
		// Don't overlap if this was the last chunk
		if (endPos >= trimmedContent.length) {
			break;
		}

		const prevPosition = position;
		position = endPos - OVERLAP_CHARS;
		// Ensure we always make progress
		if (position <= prevPosition) {
			position = endPos;
		}
	}

	return chunks;
}

/**
 * Estimate token count for a text string.
 * Uses simple character-based estimation (~4 chars per token).
 */
export function estimateTokens(text: string): number {
	return Math.ceil(text.length / CHARS_PER_TOKEN);
}
