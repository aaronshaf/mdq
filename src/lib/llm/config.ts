export interface LLMConfig {
	endpoint: string;
	model: string;
	apiKey?: string;
}

const DEFAULT_ENDPOINT = 'http://localhost:11434/v1';
const DEFAULT_MODEL = 'qwen2.5:7b';

export function loadLLMConfig(): LLMConfig {
	return {
		endpoint: process.env.MD_LLM_ENDPOINT ?? DEFAULT_ENDPOINT,
		model: process.env.MD_LLM_MODEL ?? DEFAULT_MODEL,
		apiKey: process.env.MD_LLM_API_KEY,
	};
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
