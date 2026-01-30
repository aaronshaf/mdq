/**
 * Render the OAuth authorization page HTML.
 * Displays a simple approval form for the user to authorize the client.
 *
 * @param params - Authorization parameters
 * @returns HTML string
 */
export function renderAuthorizationPage(params: {
	clientName: string;
	clientId: string;
	redirectUri: string;
	state: string;
	code: string;
	csrfToken: string;
	scope?: string;
}): string {
	const { clientName, clientId, redirectUri, state, code, csrfToken, scope } = params;

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Authorization Request - mdq</title>
	<style>
		* {
			margin: 0;
			padding: 0;
			box-sizing: border-box;
		}
		body {
			font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
			background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
			min-height: 100vh;
			display: flex;
			align-items: center;
			justify-content: center;
			padding: 20px;
		}
		.container {
			background: white;
			border-radius: 12px;
			box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
			max-width: 480px;
			width: 100%;
			padding: 40px;
		}
		h1 {
			font-size: 24px;
			color: #1a202c;
			margin-bottom: 12px;
			text-align: center;
		}
		.client-info {
			background: #f7fafc;
			border-left: 4px solid #667eea;
			padding: 16px;
			margin: 24px 0;
			border-radius: 4px;
		}
		.client-info p {
			margin: 8px 0;
			color: #2d3748;
			font-size: 14px;
		}
		.client-info strong {
			color: #1a202c;
			font-weight: 600;
		}
		.warning {
			background: #fffbeb;
			border-left: 4px solid #f59e0b;
			padding: 16px;
			margin: 24px 0;
			border-radius: 4px;
		}
		.warning p {
			color: #78350f;
			font-size: 14px;
			line-height: 1.6;
		}
		.actions {
			display: flex;
			gap: 12px;
			margin-top: 32px;
		}
		button {
			flex: 1;
			padding: 14px 24px;
			border: none;
			border-radius: 8px;
			font-size: 16px;
			font-weight: 600;
			cursor: pointer;
			transition: all 0.2s;
		}
		.approve {
			background: #667eea;
			color: white;
		}
		.approve:hover {
			background: #5568d3;
			transform: translateY(-1px);
			box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
		}
		.deny {
			background: #e2e8f0;
			color: #4a5568;
		}
		.deny:hover {
			background: #cbd5e0;
			transform: translateY(-1px);
		}
		.footer {
			margin-top: 32px;
			padding-top: 24px;
			border-top: 1px solid #e2e8f0;
			text-align: center;
		}
		.footer p {
			color: #718096;
			font-size: 13px;
		}
		.footer a {
			color: #667eea;
			text-decoration: none;
		}
		.footer a:hover {
			text-decoration: underline;
		}
	</style>
</head>
<body>
	<div class="container">
		<h1>Authorization Request</h1>

		<div class="client-info">
			<p><strong>Client:</strong> ${escapeHtml(clientName)}</p>
			<p><strong>Client ID:</strong> <code>${escapeHtml(clientId)}</code></p>
			<p><strong>Redirect URI:</strong> ${escapeHtml(redirectUri)}</p>
			${scope ? `<p><strong>Scope:</strong> ${escapeHtml(scope)}</p>` : ''}
		</div>

		<div class="warning">
			<p>
				<strong>${escapeHtml(clientName)}</strong> wants to access your mdq server.
				This will allow the application to search your markdown content through the MCP protocol.
			</p>
		</div>

		<form method="POST" action="/oauth/authorize">
			<input type="hidden" name="code" value="${escapeHtml(code)}">
			<input type="hidden" name="state" value="${escapeHtml(state)}">
			<input type="hidden" name="redirect_uri" value="${escapeHtml(redirectUri)}">
			<input type="hidden" name="csrf_token" value="${escapeHtml(csrfToken)}">

			<div class="actions">
				<button type="submit" name="action" value="approve" class="approve">
					Approve
				</button>
				<button type="submit" name="action" value="deny" class="deny">
					Deny
				</button>
			</div>
		</form>

		<div class="footer">
			<p>Powered by <a href="https://github.com/aaronshaf/mdq" target="_blank">mdq</a></p>
		</div>
	</div>
</body>
</html>`;
}

/**
 * Escape HTML special characters to prevent XSS.
 */
function escapeHtml(str: string): string {
	const htmlEscapes: Record<string, string> = {
		'&': '&amp;',
		'<': '&lt;',
		'>': '&gt;',
		'"': '&quot;',
		"'": '&#39;',
	};
	return str.replace(/[&<>"']/g, (char) => htmlEscapes[char] ?? char);
}
