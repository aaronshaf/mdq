import crypto from 'node:crypto';
import type { Atom, SearchDocument } from './types.js';

/**
 * Generate a unique ID for an atom based on document ID and content hash
 * Uses underscore instead of colon to comply with Meilisearch ID requirements
 */
export function generateAtomId(docId: string, content: string): string {
	const hash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 8);
	return `${docId}_${hash}`;
}

/**
 * Create Atom objects from extracted content strings
 */
export function createAtoms(
	doc: Pick<SearchDocument, 'id' | 'path' | 'title'>,
	contents: string[],
	confidence?: number,
): Atom[] {
	const now = Date.now();

	return contents.map((content) => ({
		id: generateAtomId(doc.id, content),
		content,
		doc_id: doc.id,
		doc_path: doc.path,
		doc_title: doc.title,
		confidence,
		created_at: now,
	}));
}

/**
 * Get the atoms index name from a documents index name
 */
export function getAtomsIndexName(indexName: string): string {
	return `${indexName}-atoms`;
}

/**
 * Deduplicate atoms by content, preferring higher confidence scores
 */
export function deduplicateAtoms(atoms: Atom[]): Atom[] {
	const contentMap = new Map<string, Atom>();

	for (const atom of atoms) {
		const normalizedContent = atom.content.toLowerCase().trim();
		const existing = contentMap.get(normalizedContent);

		if (!existing) {
			contentMap.set(normalizedContent, atom);
		} else if (
			atom.confidence !== undefined &&
			(existing.confidence === undefined || atom.confidence > existing.confidence)
		) {
			contentMap.set(normalizedContent, atom);
		}
	}

	return Array.from(contentMap.values());
}

/**
 * Group atoms by their parent document ID
 */
export function groupAtomsByDocument(atoms: Atom[]): Map<string, Atom[]> {
	const groups = new Map<string, Atom[]>();

	for (const atom of atoms) {
		const existing = groups.get(atom.doc_id);
		if (existing) {
			existing.push(atom);
		} else {
			groups.set(atom.doc_id, [atom]);
		}
	}

	return groups;
}
