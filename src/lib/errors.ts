export const EXIT_CODES = {
	SUCCESS: 0,
	GENERAL_ERROR: 1,
	INVALID_ARGS: 2,
	NOT_FOUND: 3,
	CONNECTION_ERROR: 4,
	PARSE_ERROR: 5,
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

export interface BaseError {
	readonly _tag: string;
	readonly message: string;
}

export interface ConnectionError extends BaseError {
	readonly _tag: 'ConnectionError';
	readonly url?: string;
}

export interface NotFoundError extends BaseError {
	readonly _tag: 'NotFoundError';
	readonly resource: string;
}

export interface ParseError extends BaseError {
	readonly _tag: 'ParseError';
	readonly path?: string;
}

export interface InvalidArgsError extends BaseError {
	readonly _tag: 'InvalidArgsError';
	readonly arg?: string;
}

export interface IndexError extends BaseError {
	readonly _tag: 'IndexError';
	readonly indexName?: string;
}

export interface FileSystemError extends BaseError {
	readonly _tag: 'FileSystemError';
	readonly path?: string;
}

export interface LLMError extends BaseError {
	readonly _tag: 'LLMError';
	readonly endpoint?: string;
	readonly model?: string;
}

export type MdError =
	| ConnectionError
	| NotFoundError
	| ParseError
	| InvalidArgsError
	| IndexError
	| FileSystemError
	| LLMError;

export function createConnectionError(message: string, url?: string): ConnectionError {
	return { _tag: 'ConnectionError', message, url };
}

export function createNotFoundError(message: string, resource: string): NotFoundError {
	return { _tag: 'NotFoundError', message, resource };
}

export function createParseError(message: string, path?: string): ParseError {
	return { _tag: 'ParseError', message, path };
}

export function createInvalidArgsError(message: string, arg?: string): InvalidArgsError {
	return { _tag: 'InvalidArgsError', message, arg };
}

export function createIndexError(message: string, indexName?: string): IndexError {
	return { _tag: 'IndexError', message, indexName };
}

export function createFileSystemError(message: string, path?: string): FileSystemError {
	return { _tag: 'FileSystemError', message, path };
}

export function createLLMError(message: string, endpoint?: string, model?: string): LLMError {
	return { _tag: 'LLMError', message, endpoint, model };
}

export function getExitCode(error: MdError): ExitCode {
	switch (error._tag) {
		case 'ConnectionError':
			return EXIT_CODES.CONNECTION_ERROR;
		case 'NotFoundError':
			return EXIT_CODES.NOT_FOUND;
		case 'ParseError':
			return EXIT_CODES.PARSE_ERROR;
		case 'InvalidArgsError':
			return EXIT_CODES.INVALID_ARGS;
		case 'IndexError':
			return EXIT_CODES.GENERAL_ERROR;
		case 'FileSystemError':
			return EXIT_CODES.GENERAL_ERROR;
		case 'LLMError':
			return EXIT_CODES.CONNECTION_ERROR;
	}
}

/**
 * Format any error into a readable string message
 */
export function formatError(error: unknown): string {
	// Handle standard Error objects
	if (error instanceof Error) {
		return error.message;
	}

	// Handle our custom MdError objects
	if (error && typeof error === 'object' && '_tag' in error) {
		const mdError = error as MdError;
		return mdError.message;
	}

	// Handle plain objects
	if (error && typeof error === 'object') {
		// Try to extract useful information
		if ('message' in error && typeof error.message === 'string') {
			return error.message;
		}
		// Fallback to JSON representation
		try {
			return JSON.stringify(error);
		} catch {
			return String(error);
		}
	}

	// Fallback for primitives
	return String(error);
}
