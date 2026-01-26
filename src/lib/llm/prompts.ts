// Content truncation limits
const SUMMARY_CONTENT_LIMIT = 4000;
const ATOMS_CONTENT_LIMIT = 8000;

const SUMMARY_SYSTEM =
	'You are a technical documentation assistant. Generate concise, informative summaries that capture the key purpose and content of documents. Focus on what the document teaches, explains, or documents.';

const ATOMS_SYSTEM =
	'You are a knowledge extraction assistant. Extract atomic facts from documents. Each fact must be a grammatically correct English sentence with proper capitalization and punctuation. Use standard English sentence capitalization rules. Return ONLY a valid JSON array of strings.';

const RELATIONSHIPS_SYSTEM =
	'You are a document relationship analyst. Given a source document and candidate related documents, identify which candidates are semantically related to the source. Consider topical overlap, shared concepts, and complementary information. Return ONLY a valid JSON array of document IDs.';

export function buildSummaryPrompt(
	title: string,
	content: string,
): {
	system: string;
	user: string;
} {
	const truncatedContent = content.slice(0, SUMMARY_CONTENT_LIMIT);

	return {
		system: SUMMARY_SYSTEM,
		user: `Summarize this document in 1-2 sentences. Focus on what it teaches or explains.

Title: ${title}
Content:
${truncatedContent}${content.length > SUMMARY_CONTENT_LIMIT ? '\n[Content truncated...]' : ''}`,
	};
}

export function buildAtomsPrompt(
	title: string,
	content: string,
): {
	system: string;
	user: string;
} {
	const truncatedContent = content.slice(0, ATOMS_CONTENT_LIMIT);

	return {
		system: ATOMS_SYSTEM,
		user: `Extract 3-10 atomic facts from this document. Format each as a proper English sentence.

FORMATTING RULES:
1. Start sentence with capital letter
2. End sentence with period
3. Capitalize proper nouns (Commons, Canvas, React, DynamoDB)
4. Write acronyms in ALL CAPS (LTI, API, S3, SQS, HTML, CSS)
5. Keep common words lowercase (is, the, and, for, with, that)

EXAMPLES OF CORRECT FORMAT:
- "Commons is an LTI application that helps teachers find resources."
- "The tech stack includes React, Node.js, DynamoDB, and S3."
- "Lorcrux is the main Commons application."

Title: ${title}
Content:
${truncatedContent}${content.length > ATOMS_CONTENT_LIMIT ? '\n[Content truncated...]' : ''}

Return JSON array of properly formatted sentences:`,
	};
}

export interface RelationshipCandidate {
	id: string;
	title: string;
	summary: string;
}

export function buildRelationshipsPrompt(
	sourceTitle: string,
	sourceSummary: string,
	candidates: RelationshipCandidate[],
): {
	system: string;
	user: string;
} {
	const candidatesList = candidates
		.map((c) => `- ID: ${c.id}, Title: ${c.title}, Summary: ${c.summary}`)
		.join('\n');

	return {
		system: RELATIONSHIPS_SYSTEM,
		user: `Given this document and candidate related documents, identify which are semantically related.
Consider: topical overlap, shared concepts, complementary information.
Only include documents that are meaningfully related, not just superficially similar.

Source Document:
Title: ${sourceTitle}
Summary: ${sourceSummary}

Candidate Documents:
${candidatesList}

Return related document IDs as JSON array: ["id1", "id3"]
If no documents are related, return an empty array: []`,
	};
}

/**
 * Find the first balanced JSON array in the response text.
 * Handles nested arrays and escaped characters properly.
 */
function findBalancedJsonArray(text: string): string | null {
	const startIndex = text.indexOf('[');
	if (startIndex === -1) {
		return null;
	}

	let depth = 0;
	let inString = false;
	let escapeNext = false;

	for (let i = startIndex; i < text.length; i++) {
		const char = text[i];

		if (escapeNext) {
			escapeNext = false;
			continue;
		}

		if (char === '\\' && inString) {
			escapeNext = true;
			continue;
		}

		if (char === '"' && !escapeNext) {
			inString = !inString;
			continue;
		}

		if (!inString) {
			if (char === '[') {
				depth++;
			} else if (char === ']') {
				depth--;
				if (depth === 0) {
					return text.slice(startIndex, i + 1);
				}
			}
		}
	}

	return null;
}

export function parseJsonArray(response: string): string[] {
	// Try to extract balanced JSON array from response
	const arrayString = findBalancedJsonArray(response);
	if (!arrayString) {
		return [];
	}

	try {
		const parsed = JSON.parse(arrayString);
		if (Array.isArray(parsed)) {
			return parsed.filter((item) => typeof item === 'string');
		}
	} catch {
		// If parsing fails, return empty array
	}

	return [];
}
