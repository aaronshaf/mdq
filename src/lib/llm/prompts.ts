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
