export interface LLMConfig {
	endpoint: string;
	model: string;
	apiKey?: string;
}

export interface EmbeddingConfig {
	endpoint: string;
	model: string;
	dimensions: number;
	apiKey?: string;
}

const DEFAULT_ENDPOINT = 'http://localhost:11434/v1';
const DEFAULT_MODEL = 'qwen2.5:7b';
const DEFAULT_EMBEDDING_ENDPOINT = 'http://localhost:11434';
const DEFAULT_EMBEDDING_MODEL = 'nomic-embed-text:latest';
const DEFAULT_EMBEDDING_DIMENSIONS = 768;

export function loadLLMConfig(): LLMConfig {
	return {
		endpoint: process.env.MD_LLM_ENDPOINT ?? DEFAULT_ENDPOINT,
		model: process.env.MD_LLM_MODEL ?? DEFAULT_MODEL,
		apiKey: process.env.MD_LLM_API_KEY,
	};
}

export function loadEmbeddingConfig(): EmbeddingConfig {
	let dimensions = DEFAULT_EMBEDDING_DIMENSIONS;
	if (process.env.MD_EMBEDDING_DIMENSIONS) {
		const parsed = Number.parseInt(process.env.MD_EMBEDDING_DIMENSIONS, 10);
		if (Number.isNaN(parsed) || parsed <= 0) {
			throw new Error(
				`Invalid MD_EMBEDDING_DIMENSIONS: "${process.env.MD_EMBEDDING_DIMENSIONS}" (must be a positive integer)`,
			);
		}
		dimensions = parsed;
	}

	return {
		endpoint: process.env.MD_EMBEDDING_ENDPOINT ?? DEFAULT_EMBEDDING_ENDPOINT,
		model: process.env.MD_EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL,
		dimensions,
		// Use embedding-specific key, or fall back to LLM key for convenience
		apiKey: process.env.MD_EMBEDDING_API_KEY ?? process.env.MD_LLM_API_KEY,
	};
}

export function isOllamaEmbeddingEndpoint(endpoint: string): boolean {
	return endpoint.includes('localhost:11434') || endpoint.includes('127.0.0.1:11434');
}

export function isClaudeEndpoint(endpoint: string): boolean {
	return endpoint.includes('anthropic.com');
}

export function isOpenAIEndpoint(endpoint: string): boolean {
	return endpoint.includes('openai.com');
}

export function isOllamaEndpoint(endpoint: string): boolean {
	return endpoint.includes('localhost:11434') || endpoint.includes('127.0.0.1:11434');
}
