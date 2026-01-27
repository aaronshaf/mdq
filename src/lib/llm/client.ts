import { type LLMError, createLLMError } from '../errors.js';
import {
	type EmbeddingConfig,
	type LLMConfig,
	isClaudeEndpoint,
	isOllamaEmbeddingEndpoint,
	isOllamaEndpoint,
	loadEmbeddingConfig,
	loadLLMConfig,
} from './config.js';

interface ChatMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

interface ChatCompletionChoice {
	index: number;
	message: {
		role: string;
		content: string;
	};
	finish_reason: string;
}

interface ChatCompletionResponse {
	id: string;
	object: string;
	created: number;
	model: string;
	choices: ChatCompletionChoice[];
	usage?: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
	};
}

interface AnthropicMessage {
	id: string;
	type: string;
	role: string;
	content: Array<{ type: string; text: string }>;
	model: string;
	stop_reason: string;
	usage: {
		input_tokens: number;
		output_tokens: number;
	};
}

export interface LLMCompletionOptions {
	maxTokens?: number;
	temperature?: number;
}

export class LLMClient {
	private config: LLMConfig;
	private embeddingConfig: EmbeddingConfig;

	constructor(config?: LLMConfig, embeddingConfig?: EmbeddingConfig) {
		this.config = config ?? loadLLMConfig();
		this.embeddingConfig = embeddingConfig ?? loadEmbeddingConfig();
	}

	async complete(
		systemPrompt: string,
		userPrompt: string,
		options: LLMCompletionOptions = {},
	): Promise<string> {
		const { maxTokens = 1024, temperature = 0.3 } = options;

		try {
			if (isClaudeEndpoint(this.config.endpoint)) {
				return await this.completeClaude(systemPrompt, userPrompt, maxTokens, temperature);
			}

			return await this.completeOpenAI(systemPrompt, userPrompt, maxTokens, temperature);
		} catch (error) {
			// Enhance model-not-found errors with helpful guidance
			if (error && typeof error === 'object' && '_tag' in error && error._tag === 'LLMError') {
				const llmError = error as LLMError;
				const message = llmError.message.toLowerCase();

				// Detect "model not found" errors
				if (
					message.includes('model') &&
					(message.includes('not found') || message.includes('does not exist'))
				) {
					const isOllama = isOllamaEndpoint(this.config.endpoint);
					const helpText = isOllama
						? `\n\nTo fix this:\n  1. List available models: ollama list\n  2. Pull the model: ollama pull ${this.config.model}\n  3. Or use a different model: export MD_LLM_MODEL="qwen2.5:7b"`
						: `\n\nSpecify a valid model using: export MD_LLM_MODEL="your-model-name"`;

					throw createLLMError(llmError.message + helpText, llmError.endpoint, llmError.model);
				}
			}

			// Re-throw original error if not model-not-found
			throw error;
		}
	}

	private async completeOpenAI(
		systemPrompt: string,
		userPrompt: string,
		maxTokens: number,
		temperature: number,
	): Promise<string> {
		const messages: ChatMessage[] = [
			{ role: 'system', content: systemPrompt },
			{ role: 'user', content: userPrompt },
		];

		const url = `${this.config.endpoint}/chat/completions`;
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
		};

		if (this.config.apiKey) {
			headers.Authorization = `Bearer ${this.config.apiKey}`;
		}

		const response = await fetch(url, {
			method: 'POST',
			headers,
			body: JSON.stringify({
				model: this.config.model,
				messages,
				max_tokens: maxTokens,
				temperature,
			}),
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw createLLMError(
				`LLM API error (${response.status}): ${errorText}`,
				this.config.endpoint,
				this.config.model,
			);
		}

		const data = (await response.json()) as ChatCompletionResponse;

		if (!data.choices || data.choices.length === 0) {
			throw createLLMError('LLM returned no choices', this.config.endpoint, this.config.model);
		}

		return data.choices[0]!.message.content;
	}

	private async completeClaude(
		systemPrompt: string,
		userPrompt: string,
		maxTokens: number,
		temperature: number,
	): Promise<string> {
		if (!this.config.apiKey) {
			throw createLLMError(
				'API key required for Claude API',
				this.config.endpoint,
				this.config.model,
			);
		}

		const url = `${this.config.endpoint}/messages`;
		const response = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': this.config.apiKey,
				'anthropic-version': '2023-06-01',
			},
			body: JSON.stringify({
				model: this.config.model,
				max_tokens: maxTokens,
				temperature,
				system: systemPrompt,
				messages: [{ role: 'user', content: userPrompt }],
			}),
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw createLLMError(
				`Claude API error (${response.status}): ${errorText}`,
				this.config.endpoint,
				this.config.model,
			);
		}

		const data = (await response.json()) as AnthropicMessage;

		if (!data.content || data.content.length === 0) {
			throw createLLMError('Claude returned no content', this.config.endpoint, this.config.model);
		}

		const textContent = data.content.find((c) => c.type === 'text');
		if (!textContent) {
			throw createLLMError(
				'Claude returned no text content',
				this.config.endpoint,
				this.config.model,
			);
		}

		return textContent.text;
	}

	async checkHealth(): Promise<{ healthy: boolean; message: string }> {
		try {
			// For Ollama, check the models endpoint
			if (isOllamaEndpoint(this.config.endpoint)) {
				const baseUrl = this.config.endpoint.replace('/v1', '');
				const response = await fetch(`${baseUrl}/api/tags`);
				if (response.ok) {
					return { healthy: true, message: 'Ollama is running' };
				}
				return { healthy: false, message: 'Ollama is not responding' };
			}

			// For OpenAI-compatible endpoints, just check if we can list models
			const url = `${this.config.endpoint}/models`;
			const headers: Record<string, string> = {};
			if (this.config.apiKey) {
				headers.Authorization = `Bearer ${this.config.apiKey}`;
			}

			const response = await fetch(url, { headers });
			if (response.ok) {
				return { healthy: true, message: 'LLM endpoint is reachable' };
			}

			return { healthy: false, message: `LLM endpoint returned ${response.status}` };
		} catch (error) {
			return {
				healthy: false,
				message: `Cannot connect to LLM: ${error instanceof Error ? error.message : 'Unknown error'}`,
			};
		}
	}

	getConfig(): LLMConfig {
		return { ...this.config };
	}

	getEmbeddingConfig(): EmbeddingConfig {
		return { ...this.embeddingConfig };
	}

	async embed(text: string): Promise<number[]> {
		// Truncate text to fit within model context window
		// all-minilm: ~256 tokens, roughly 1000 chars
		// nomic-embed-text: ~8192 tokens
		// text-embedding-3-small: ~8192 tokens
		const maxChars = this.getMaxEmbeddingChars();
		const truncatedText = text.length > maxChars ? text.slice(0, maxChars) : text;

		// Use embedding endpoint, not LLM endpoint
		if (isOllamaEmbeddingEndpoint(this.embeddingConfig.endpoint)) {
			return this.embedOllama(truncatedText);
		}

		// OpenAI-compatible embedding endpoint
		return this.embedOpenAI(truncatedText);
	}

	private getMaxEmbeddingChars(): number {
		const model = this.embeddingConfig.model.toLowerCase();
		// all-minilm has 256 token max sequence length
		// Tokenization varies by content, so be very conservative
		if (model.includes('minilm') || model.includes('all-minilm')) {
			return 200;
		}
		// Larger models with 8k context
		if (
			model.includes('nomic') ||
			model.includes('mxbai') ||
			model.includes('text-embedding-3') ||
			model.includes('ada')
		) {
			return 30000; // ~8k tokens
		}
		// Default conservative limit
		return 4000;
	}

	async embedBatch(texts: string[]): Promise<number[][]> {
		if (texts.length === 0) {
			return [];
		}

		// Truncate all texts to fit within model context window
		const maxChars = this.getMaxEmbeddingChars();
		const truncatedTexts = texts.map((text) =>
			text.length > maxChars ? text.slice(0, maxChars) : text,
		);

		// Use embedding endpoint, not LLM endpoint
		if (isOllamaEmbeddingEndpoint(this.embeddingConfig.endpoint)) {
			// Ollama doesn't support batching, process with limited concurrency
			return this.embedOllamaBatch(truncatedTexts);
		}

		// OpenAI-compatible embedding endpoint supports batching
		return this.embedOpenAIBatch(truncatedTexts);
	}

	private async embedOllamaBatch(texts: string[]): Promise<number[][]> {
		const CONCURRENCY_LIMIT = 5;
		const results: number[][] = new Array(texts.length);
		let currentIndex = 0;

		const worker = async (): Promise<void> => {
			while (currentIndex < texts.length) {
				const index = currentIndex++;
				results[index] = await this.embedOllama(texts[index]!);
			}
		};

		// Start workers up to concurrency limit
		const workers = Array.from({ length: Math.min(CONCURRENCY_LIMIT, texts.length) }, () =>
			worker(),
		);
		await Promise.all(workers);

		return results;
	}

	private async embedOllama(text: string): Promise<number[]> {
		// Ollama embedding endpoint is /api/embeddings
		const url = `${this.embeddingConfig.endpoint}/api/embeddings`;

		const response = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				model: this.embeddingConfig.model,
				prompt: text,
			}),
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw createLLMError(
				`Ollama embedding error (${response.status}): ${errorText}`,
				this.embeddingConfig.endpoint,
				this.embeddingConfig.model,
			);
		}

		const data = (await response.json()) as { embedding: number[] };
		return data.embedding;
	}

	private async embedOpenAI(text: string): Promise<number[]> {
		const url = `${this.embeddingConfig.endpoint}/embeddings`;
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
		};

		if (this.embeddingConfig.apiKey) {
			headers.Authorization = `Bearer ${this.embeddingConfig.apiKey}`;
		}

		const response = await fetch(url, {
			method: 'POST',
			headers,
			body: JSON.stringify({
				model: this.embeddingConfig.model,
				input: text,
			}),
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw createLLMError(
				`Embedding API error (${response.status}): ${errorText}`,
				this.embeddingConfig.endpoint,
				this.embeddingConfig.model,
			);
		}

		const data = (await response.json()) as {
			data: Array<{ embedding: number[] }>;
		};

		if (!data.data || data.data.length === 0) {
			throw createLLMError(
				'Embedding API returned no data',
				this.embeddingConfig.endpoint,
				this.embeddingConfig.model,
			);
		}

		return data.data[0]!.embedding;
	}

	private async embedOpenAIBatch(texts: string[]): Promise<number[][]> {
		const url = `${this.embeddingConfig.endpoint}/embeddings`;
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
		};

		if (this.embeddingConfig.apiKey) {
			headers.Authorization = `Bearer ${this.embeddingConfig.apiKey}`;
		}

		const response = await fetch(url, {
			method: 'POST',
			headers,
			body: JSON.stringify({
				model: this.embeddingConfig.model,
				input: texts,
			}),
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw createLLMError(
				`Embedding API error (${response.status}): ${errorText}`,
				this.embeddingConfig.endpoint,
				this.embeddingConfig.model,
			);
		}

		const data = (await response.json()) as {
			data: Array<{ index: number; embedding: number[] }>;
		};

		if (!data.data || data.data.length === 0) {
			throw createLLMError(
				'Embedding API returned no data',
				this.embeddingConfig.endpoint,
				this.embeddingConfig.model,
			);
		}

		// Sort by index to ensure correct order (OpenAI may return out of order)
		const sorted = data.data.sort((a, b) => a.index - b.index);
		return sorted.map((item) => item.embedding);
	}

	async checkEmbeddingHealth(): Promise<{ healthy: boolean; message: string }> {
		try {
			if (isOllamaEmbeddingEndpoint(this.embeddingConfig.endpoint)) {
				// Check if Ollama has the embedding model
				const response = await fetch(`${this.embeddingConfig.endpoint}/api/tags`);
				if (!response.ok) {
					return { healthy: false, message: 'Ollama is not responding' };
				}
				const data = (await response.json()) as { models: Array<{ name: string }> };
				const modelNames = data.models?.map((m) => m.name) ?? [];
				const hasModel = modelNames.some(
					(name) =>
						name === this.embeddingConfig.model ||
						name.startsWith(`${this.embeddingConfig.model}:`),
				);
				if (!hasModel) {
					return {
						healthy: false,
						message: `Embedding model "${this.embeddingConfig.model}" not found. Run: ollama pull ${this.embeddingConfig.model}`,
					};
				}
				return {
					healthy: true,
					message: `Embedding model "${this.embeddingConfig.model}" available`,
				};
			}

			// For OpenAI-compatible, just check the endpoint is reachable
			return { healthy: true, message: 'Embedding endpoint configured' };
		} catch (error) {
			const isConnectionError =
				error instanceof Error &&
				(error.message.includes('ECONNREFUSED') || error.message.includes('fetch failed'));

			if (isConnectionError && isOllamaEmbeddingEndpoint(this.embeddingConfig.endpoint)) {
				return {
					healthy: false,
					message: `Cannot connect to Ollama. Is it running?\n\n  Start Ollama:  ollama serve\n  Pull a model:  ollama pull ${this.embeddingConfig.model}`,
				};
			}

			return {
				healthy: false,
				message: `Cannot connect to embedding service: ${error instanceof Error ? error.message : 'Unknown error'}`,
			};
		}
	}
}

export function createLLMClient(config?: LLMConfig): LLMClient {
	return new LLMClient(config);
}
