import { type LLMError, createLLMError } from '../errors.js';
import { type LLMConfig, isClaudeEndpoint, isOllamaEndpoint, loadLLMConfig } from './config.js';

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

	constructor(config?: LLMConfig) {
		this.config = config ?? loadLLMConfig();
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
}

export function createLLMClient(config?: LLMConfig): LLMClient {
	return new LLMClient(config);
}
