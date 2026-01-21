export interface MarkdownFrontmatter {
	title?: string;
	page_id?: string;
	labels?: string[];
	author_email?: string;
	created_at?: string;
	updated_at?: string;
	[key: string]: unknown;
}

export interface ParsedMarkdown {
	id: string;
	title: string;
	content: string;
	frontmatter: MarkdownFrontmatter;
	path: string;
}
