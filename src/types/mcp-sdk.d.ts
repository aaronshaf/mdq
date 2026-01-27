// Type declarations for MCP SDK modules not exposed in package.json exports
declare module '@modelcontextprotocol/sdk/dist/esm/server/webStandardStreamableHttp' {
	export * from '@modelcontextprotocol/sdk/dist/esm/server/webStandardStreamableHttp.js';
}

declare module '@modelcontextprotocol/sdk/dist/esm/server/webStandardStreamableHttp.js' {
	import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
	import type {
		JSONRPCMessage,
		MessageExtraInfo,
		RequestId,
	} from '@modelcontextprotocol/sdk/types.js';

	export interface WebStandardStreamableHTTPServerTransportOptions {
		sessionIdGenerator?: () => string;
		onsessioninitialized?: (sessionId: string) => void | Promise<void>;
		onsessionclosed?: (sessionId: string) => void | Promise<void>;
		enableJsonResponse?: boolean;
		retryInterval?: number;
	}

	export class WebStandardStreamableHTTPServerTransport implements Transport {
		sessionId?: string;
		onclose?: () => void;
		onerror?: (error: Error) => void;
		onmessage?: (message: JSONRPCMessage, extra?: MessageExtraInfo) => void;

		constructor(options?: WebStandardStreamableHTTPServerTransportOptions);
		start(): Promise<void>;
		close(): Promise<void>;
		send(message: JSONRPCMessage, options?: { relatedRequestId?: RequestId }): Promise<void>;
		handleRequest(request: Request): Promise<Response>;
	}
}

// Export types for internal use
export type { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/dist/esm/server/webStandardStreamableHttp.js';
