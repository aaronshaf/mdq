import chalk from 'chalk';

export interface Formatter {
	format(data: unknown): string;
	formatError(error: Error | { message: string }): string;
}

export class HumanFormatter implements Formatter {
	format(data: unknown): string {
		if (Array.isArray(data)) {
			return data.map((item) => this.formatItem(item)).join('\n\n');
		}
		return this.formatItem(data);
	}

	private formatSearchResult(obj: Record<string, unknown>): string {
		const lines: string[] = [chalk.bold(String(obj.title)), chalk.dim(String(obj.path))];

		if (obj.snippet) {
			lines.push(String(obj.snippet));
		}

		if (obj.labels && Array.isArray(obj.labels) && obj.labels.length > 0) {
			lines.push(chalk.cyan(`Labels: ${obj.labels.join(', ')}`));
		}

		return lines.join('\n');
	}

	private formatStatus(obj: Record<string, unknown>): string {
		const status = obj.status === 'ok' ? chalk.green('✓') : chalk.red('✗');
		const lines = [`${status} ${obj.message || obj.status}`];

		if (obj.indexName) {
			lines.push(`  Index: ${obj.indexName}`);
		}
		if (obj.documentCount !== undefined) {
			lines.push(`  Documents: ${obj.documentCount}`);
		}

		return lines.join('\n');
	}

	private formatObject(obj: Record<string, unknown>): string {
		if ('title' in obj && 'path' in obj) {
			return this.formatSearchResult(obj);
		}

		if ('status' in obj) {
			return this.formatStatus(obj);
		}

		if ('indexed' in obj && 'total' in obj) {
			return `Indexed ${obj.indexed}/${obj.total} files`;
		}

		return Object.entries(obj)
			.map(([key, value]) => `${chalk.bold(key)}: ${value}`)
			.join('\n');
	}

	private formatItem(item: unknown): string {
		if (item === null || item === undefined) {
			return '';
		}

		if (typeof item === 'string') {
			return item;
		}

		if (typeof item === 'object') {
			return this.formatObject(item as Record<string, unknown>);
		}

		return String(item);
	}

	formatError(error: Error | { message: string }): string {
		return chalk.red(`Error: ${error.message}`);
	}
}

export class JsonFormatter implements Formatter {
	format(data: unknown): string {
		return JSON.stringify(data, null, 2);
	}

	formatError(error: Error | { message: string }): string {
		return JSON.stringify({ error: error.message }, null, 2);
	}
}

export class XmlFormatter implements Formatter {
	format(data: unknown): string {
		return this.toXml(data, 'result');
	}

	private toXml(data: unknown, rootName: string): string {
		if (data === null || data === undefined) {
			return `<${rootName}/>`;
		}

		if (Array.isArray(data)) {
			const items = data.map((item) => this.toXml(item, 'item')).join('\n');
			return `<${rootName}>\n${items}\n</${rootName}>`;
		}

		if (typeof data === 'object') {
			const obj = data as Record<string, unknown>;
			const children = Object.entries(obj)
				.map(([key, value]) => {
					if (Array.isArray(value)) {
						const items = value.map((v) => `<item>${this.escapeXml(String(v))}</item>`).join('');
						return `<${key}>${items}</${key}>`;
					}
					if (typeof value === 'object' && value !== null) {
						return this.toXml(value, key);
					}
					return `<${key}>${this.escapeXml(String(value))}</${key}>`;
				})
				.join('\n');
			return `<${rootName}>\n${children}\n</${rootName}>`;
		}

		return `<${rootName}>${this.escapeXml(String(data))}</${rootName}>`;
	}

	private escapeXml(str: string): string {
		return str
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&apos;');
	}

	formatError(error: Error | { message: string }): string {
		return `<error>${this.escapeXml(error.message)}</error>`;
	}
}

export function getFormatter(format: 'human' | 'json' | 'xml'): Formatter {
	switch (format) {
		case 'json':
			return new JsonFormatter();
		case 'xml':
			return new XmlFormatter();
		default:
			return new HumanFormatter();
	}
}
